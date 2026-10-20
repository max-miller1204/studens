import { afterEach, beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { classroomActivity } from "../src/server/activity.ts";
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
  const review = startReview("rust", randomUUID(), "service").session;
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

it("projects next lesson checking before publication and retains the canonical retry after restart", async () => {
  const { startLessonRequest, updateLessonRequest } = await import("../src/next-lesson.ts");
  const request = startLessonRequest("rust", randomUUID(), "PRIVATE TOPIC", "pi");
  const mirror = {
    id: `lesson:${request.id}`,
    lesson: request.lesson,
    kind: "lesson",
    status: "planned",
    prompt: "PRIVATE PROMPT",
    plan: "PRIVATE PLAN",
  };
  server.setHooks({ ...hooks, teacherState: () => ({ requests: [mirror] }) });
  expect(classroomActivity("rust").requests).toEqual([
    expect.objectContaining({
      kind: "lesson",
      status: "planned",
      url: "/c/rust#cl-next-lesson",
      retry: "lesson",
      retryId: request.id,
    }),
  ]);
  updateLessonRequest(request, { status: "failed", error: "Publication target already exists." });
  expect(classroomActivity("rust").requests[0]).toMatchObject({
    status: "failed",
    error: "Publication target already exists.",
  });
  expect(JSON.stringify(classroomActivity("rust"))).not.toContain("PRIVATE");
  updateLessonRequest(request, { status: "done", error: undefined });
  expect(classroomActivity("rust").requests).toEqual([]);
});

it("projects disputes and re-teach by durable identity without exposing reasons or snapshots", () => {
  server.setHooks({
    ...hooks,
    teacherState: () => ({
      requests: [
        {
          id: "dispute:one",
          lesson: "001-ownership",
          kind: "dispute",
          status: "failed",
          error: "Original rubric changed.",
          dispute: { reason: "PRIVATE", rubric: "PRIVATE" },
        },
        {
          id: "chat:reteach:two",
          lesson: "001-ownership",
          kind: "chat",
          status: "queued",
          prompt: "PRIVATE",
        },
      ],
    }),
  });
  const result = classroomActivity("rust");
  expect(result.requests[0]).toMatchObject({ kind: "reteach", status: "queued" });
  expect(result.requests[1]).toMatchObject({
    kind: "dispute",
    url: "/c/rust/001-ownership#cl-dispute-dispute%3Aone",
    retryId: "dispute:one",
  });
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
});

it("uses the active daily group's existing recovery and never queues unstarted groups", async () => {
  const { seedPreparedReviewSource, writeGradedAttempt, termAnswer } = await import("./helpers.ts");
  const { startDailyReview, saveDailyReview } = await import("../src/store/daily-review.ts");
  seedPreparedReviewSource(f.root);
  writeGradedAttempt({
    at: Date.now() - 2 * 86400000,
    answers: [termAnswer("q1", "owner")],
    correct: { q1: true },
  });
  server.setHooks(hooks);
  const daily = startDailyReview(randomUUID(), "service");
  expect(classroomActivity("rust").requests).toEqual([]);
  daily.groups[0].error = "Daily publication lock is busy.";
  saveDailyReview(daily);
  const result = classroomActivity("rust");
  expect(result.requests).toEqual([
    expect.objectContaining({
      kind: "daily",
      status: "failed",
      error: "Daily publication lock is busy.",
      retry: "daily",
      retryId: daily.id,
      url: `/reviews/daily/${daily.id}`,
    }),
  ]);
  expect(JSON.stringify(result)).not.toContain("document");
  delete daily.groups[0].error;
  saveDailyReview(daily);
  expect(classroomActivity("rust").requests).toEqual([]);
  const { savePlannedReview, updateReview } = await import("../src/review-session.ts");
  const session = savePlannedReview(daily.groups[0].plan);
  updateReview(session, "failed", "Asynchronous publication failed.");
  expect(classroomActivity("rust").requests).toEqual([
    expect.objectContaining({
      id: `review:${session.id}`,
      kind: "daily",
      error: "Asynchronous publication failed.",
      retry: "daily",
      retryId: daily.id,
    }),
  ]);
});

it("rejects foreign and duplicate identities rather than presenting or retrying another classroom", () => {
  const r = {
    id: "chat:one",
    classroom: "other",
    lesson: "001-ownership",
    kind: "chat",
    status: "queued",
  };
  server.setHooks({ ...hooks, teacherState: () => ({ requests: [r] }) });
  expect(() => classroomActivity("rust")).toThrow("another classroom");
  r.classroom = "rust";
  server.setHooks({ ...hooks, teacherState: () => ({ requests: [r, r] }) });
  expect(() => classroomActivity("rust")).toThrow("Duplicate");
});

it.each([
  "ask",
  "follow-up",
  "quiz",
  "reflect",
  "chat",
  "review",
  "resume",
  "refill",
  "lesson",
  "dispute",
])("keeps %s statuses and exact errors source-bound", (kind) => {
  const r = {
    id: `${kind}:status`,
    classroom: "rust",
    lesson: "001-ownership",
    kind,
    target: "card",
    status: "queued",
    error: "Persisted diagnostic",
    prompt: "PRIVATE",
    plan: "PRIVATE",
    modelOutput: "PRIVATE",
  };
  server.setHooks({ ...hooks, teacherState: () => ({ requests: [r] }) });
  for (const status of ["queued", "running", "planned", "failed", "done"]) {
    r.status = status;
    const result = classroomActivity("rust");
    if (status === "done") expect(result.requests).toEqual([]);
    else {
      expect(result.requests[0]).toMatchObject({ id: r.id, kind, status, retryId: r.id });
      expect(result.requests[0].error).toBe(status === "failed" ? r.error : undefined);
    }
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  }
});
