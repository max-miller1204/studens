import { afterEach, beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { classroomActivity } from "../src/server/activity.ts";
import { ClassroomBridge } from "../src/bridge.ts";
import { TeacherService } from "../src/teacher-service.ts";
import { readTeacherState, saveTeacherState } from "../src/service-state.ts";
import { makeFixture, seedClassroom, type Fixture } from "./helpers.ts";
import * as server from "../src/server.ts";
import * as store from "../src/store.ts";
let f: Fixture;
const hooks = { onAsk() {}, onFollowUp() {}, onQuizSubmit() {}, onReflect() {} };
beforeEach(() => {
  f = makeFixture();
  seedClassroom(f);
});
afterEach(async () => {
  await server.close();
  f.cleanup();
});
it("projects all request families, prioritizes actual work, and excludes private fields", () => {
  const kinds = ["ask", "follow-up", "quiz", "reflect", "chat", "review", "resume", "refill"];
  const rows = kinds.map((kind, i) => ({
    id: `${kind}:${i}`,
    lesson: "001-ownership",
    kind,
    target: "card",
    status: i === 0 ? "failed" : i === 2 ? "running" : "queued",
    error: "Specific validation failure",
    prompt: "PRIVATE PROMPT",
    plan: "PRIVATE PLAN",
    modelOutput: "PRIVATE OUTPUT",
  }));
  server.setHooks({ ...hooks, teacherState: () => ({ requests: rows }) });
  const state = classroomActivity("rust");
  expect(state.requests.map((r) => r.kind)).toEqual([
    "quiz",
    "follow-up",
    "reflect",
    "chat",
    "review",
    "resume",
    "refill",
    "ask",
  ]);
  expect(state.requests.at(-1)).toMatchObject({
    error: "Specific validation failure",
    retry: "teacher",
    url: "/c/rust/001-ownership#cl-question-card",
  });
  expect(JSON.stringify(state)).not.toContain("PRIVATE");
});
it("rejects malformed and unknown stored request states instead of claiming idle", () => {
  for (const request of [
    null,
    { id: "bad", status: "done" },
    { id: "bad", lesson: "001-ownership", kind: "quiz", status: "failed" },
    { id: "bad", lesson: "../private", kind: "quiz", status: "running" },
  ]) {
    server.setHooks({ ...hooks, teacherState: () => ({ requests: [request] }) });
    expect(() => classroomActivity("rust")).toThrow(/Invalid teacher activity request/);
  }
});
it("projects Pi's existing FIFO as running then queued and promotes once", () => {
  const sent: string[] = [];
  const bridge = new ClassroomBridge({ sendUserMessage: (text) => sent.push(text) });
  server.setHooks({ ...hooks, teacherState: (c, l) => bridge.panelState(c, l) });
  bridge.chat("rust", "001-ownership", "First", randomUUID());
  bridge.chat("rust", "001-ownership", "Second", randomUUID());
  expect(classroomActivity("rust").requests.map((r) => r.status)).toEqual(["running", "queued"]);
  bridge.onAgentEnd([{ role: "assistant", content: [{ type: "text", text: "First answer" }] }]);
  expect(classroomActivity("rust").requests.map((r) => r.status)).toEqual(["running"]);
  bridge.onAgentEnd([]);
  expect(classroomActivity("rust").requests[0].status).toBe("failed");
  expect(sent).toHaveLength(2);
});
it("retains service interruption and explicit retry without leaking plans or duplicating turns", async () => {
  const id = randomUUID();
  saveTeacherState("rust", {
    version: 1,
    identity: { backend: "codex" },
    messages: [],
    requests: [
      {
        id,
        classroom: "rust",
        lesson: "001-ownership",
        kind: "chat",
        target: id,
        prompt: "PRIVATE",
        at: 1,
        status: "running",
      },
    ],
  });
  let turns = 0;
  const teacher = new TeacherService(async () => {
    turns++;
    return { calls: [], message: "One reply", learning_record: "", notes_markdown: "" };
  });
  teacher.connect();
  teacher.attach("rust", "codex");
  await teacher.idle();
  expect(classroomActivity("rust").requests[0]).toMatchObject({
    status: "failed",
    error: "Service stopped during teacher work. Retry this request.",
  });
  expect(turns).toBe(0);
  teacher.retry("rust", id);
  expect(() => teacher.retry("rust", id)).toThrow();
  await teacher.idle();
  expect(turns).toBe(1);
  expect(classroomActivity("rust").requests).toEqual([]);
  expect(readTeacherState("rust")!.requests).toHaveLength(1);
  await teacher.stop();
});
it("invalidates only classroom subscribers even when no lesson subscriber exists", async () => {
  seedClassroom(f, { classroom: "other" });
  server.setHooks(hooks);
  const base = await server.start(0);
  const controller = new AbortController();
  const read = async (classroom: string) => {
    const response = await fetch(`${base}/api/events?scope=classroom&classroom=${classroom}`, {
      signal: controller.signal,
    });
    const reader = response.body!.getReader();
    await reader.read();
    return reader;
  };
  const rust = await read("rust"),
    other = await read("other");
  server.pushEvent("rust", "001-ownership", "teacher", { private: "not forwarded" });
  expect(new TextDecoder().decode((await rust.read()).value)).toBe("event: activity\ndata: {}\n\n");
  server.pushEvent("other", "001-ownership", "reload", {});
  expect(new TextDecoder().decode((await other.read()).value)).toBe(
    "event: activity\ndata: {}\n\n",
  );
  controller.abort();
  const missing = await fetch(`${base}/api/activity?classroom=missing`);
  expect(missing.status).toBe(404);
  expect(store.listGrades("rust", "001-ownership")).toHaveLength(0);
});

it("uses saved review publication state once and keeps unpublished links on the classroom", async () => {
  const { seedPreparedReviewSource, writeGradedAttempt, termAnswer } = await import("./helpers.ts");
  const { startReview, updateReview, completePreparedReview } =
    await import("../src/review-session.ts");
  seedPreparedReviewSource(f.root);
  writeGradedAttempt({
    at: Date.now() - 2 * 86400000,
    answers: [termAnswer("q1", "owner")],
    correct: { q1: true },
  });
  const review = startReview("rust", randomUUID(), "pi").session;
  server.setHooks({
    ...hooks,
    teacherState: () => ({
      requests: [
        {
          id: `review:${review.id}`,
          kind: "review",
          status: "running",
          lesson: review.lesson,
          prompt: "PRIVATE",
        },
      ],
    }),
  });
  updateReview(review, "failed", "Publication conflict: lesson directory already exists.");
  expect(classroomActivity("rust").requests).toEqual([
    expect.objectContaining({
      id: `review:${review.id}`,
      status: "failed",
      error: "Publication conflict: lesson directory already exists.",
      url: "/c/rust#cl-review",
      retry: "review",
    }),
  ]);
  completePreparedReview({ ...review, status: "failed" });
  expect(classroomActivity("rust").requests).toEqual([]);
});

it("reports a stale request whose original lesson is missing", () => {
  server.setHooks({
    ...hooks,
    teacherState: () => ({
      requests: [{ id: "chat:stale", lesson: "999-missing", kind: "chat", status: "running" }],
    }),
  });
  expect(() => classroomActivity("rust")).toThrow(
    "The lesson 999-missing for teacher request chat:stale no longer exists.",
  );
});
