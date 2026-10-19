import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { makeFixture, seedClassroom, seedPreparedReviewSource } from "./helpers.ts";
import type { Fixture } from "./helpers.ts";
import { nextLessonDocument } from "./next-lesson-fixture.ts";
import {
  startLessonRequest,
  lessonRequests,
  requireLessonOwner,
  saveLessonDocument,
  updateLessonRequest,
  publicLessonRequest,
  piLessonArguments,
} from "../src/next-lesson.ts";
import { TeacherService } from "../src/teacher-service.ts";
import { readTeacherState, saveTeacherState } from "../src/service-state.ts";
import { ClassroomBridge } from "../src/bridge.ts";
import * as store from "../src/store.ts";
let fixture: Fixture;
beforeEach(() => {
  fixture = makeFixture();
  seedClassroom(fixture);
  seedPreparedReviewSource(fixture.root);
});
afterEach(() => fixture.cleanup());
it("deduplicates unfinished work across tabs and protects the actual host", () => {
  const r = startLessonRequest("rust", randomUUID(), "Borrowing", "claude");
  expect(startLessonRequest("rust", randomUUID(), "different", "claude").id).toBe(r.id);
  expect(() => startLessonRequest("rust", randomUUID(), "", "codex")).toThrow("belongs to claude");
  expect(() => requireLessonOwner(r, "pi")).toThrow("belongs to claude");
  updateLessonRequest(r, { status: "failed", error: "Provider rejected request" });
  expect(startLessonRequest("rust", randomUUID(), "", "claude").status).toBe("failed");
  expect(lessonRequests("rust")).toHaveLength(1);
});
it("validates the entire plan before writes and keeps partial output off discovery", () => {
  const r = startLessonRequest("rust", randomUUID(), "", "pi"),
    document = nextLessonDocument(fixture.root);
  expect(() => saveLessonDocument(r, { ...document, teaching_plan_json: "{}" })).toThrow();
  expect(fs.existsSync(path.join(fixture.root, "rust", r.lesson))).toBe(false);
  saveLessonDocument(r, document);
  fixture.write(`rust/${r.lesson}/lesson.html`, document.lesson_html);
  expect(store.listLessons("rust").map((l) => l.name)).not.toContain(r.lesson);
  expect(store.readLesson("rust", r.lesson)).toBeNull();
  expect(publicLessonRequest(lessonRequests("rust")[0])).not.toHaveProperty("document");
  expect(() => saveLessonDocument(r, { ...document, title: "Changed" })).toThrow("already saved");
});
it("preserves rejected raw output and requires explicit retry before another model turn", async () => {
  let turns = 0;
  const service = new TeacherService(async () => {
    turns++;
    return {
      calls: [{ name: "publish_lesson", arguments_json: "{}" }],
      message: "Ready",
      learning_record: "",
      notes_markdown: "",
    };
  });
  service.attach("rust", "codex");
  const r = startLessonRequest("rust", randomUUID(), "", "codex");
  service.nextLesson(r);
  await service.idle();
  expect(turns).toBe(1);
  expect(lessonRequests("rust")[0].status).toBe("failed");
  await service.stop();
  const again = new TeacherService(async () => {
    throw new Error("Must not run");
  });
  again.attach("rust", "codex");
  await again.idle();
  expect(turns).toBe(1);
  expect(lessonRequests("rust")[0].status).toBe("failed");
  await again.stop();
});
it("keeps authoring sequential after the actual learner reply and scopes research to authoring", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const kinds: string[] = [];
  const models: unknown[] = [];
  const service = new TeacherService(async (_identity, _prompt, _cwd, _save, _signal, contract) => {
    kinds.push(contract.research ? "lesson" : "chat");
    models.push(_identity.requestedModel);
    if (!contract.research) {
      await gate;
      return { calls: [], message: "Reply on the page", learning_record: "", notes_markdown: "" };
    }
    throw new Error("Explicit authoring provider failure");
  });
  service.attach("rust", "claude");
  service.setModel("rust", "first-model", 0);
  service.chat("rust", "001-ownership", "My actual reply", randomUUID());
  service.nextLesson(startLessonRequest("rust", randomUUID(), "next", "claude"));
  await Promise.resolve();
  expect(kinds).toEqual(["chat"]);
  service.setModel("rust", "selected-lesson-model", 1);
  release();
  await service.idle();
  expect(kinds).toEqual(["chat", "lesson"]);
  expect(models).toEqual(["first-model", "selected-lesson-model"]);
  expect(readTeacherState("rust")!.messages.map((m) => m.text)).toEqual([
    "My actual reply",
    "Reply on the page",
  ]);
  await service.stop();
});
it("keeps live Pi authoring behind the preceding origin and restricts writes", () => {
  const send = vi.fn();
  const bridge = new ClassroomBridge({ sendUserMessage: send });
  bridge.noteForeignTurn();
  const r = startLessonRequest("rust", randomUUID(), "next", "pi");
  bridge.nextLesson(r);
  expect(send).not.toHaveBeenCalled();
  expect(lessonRequests("rust")[0].status).toBe("queued");
  bridge.onAgentEnd([]);
  expect(send).toHaveBeenCalledTimes(1);
  expect(lessonRequests("rust")[0].status).toBe("running");
  expect(() => bridge.assertLessonTool("write")).toThrow("cannot use write");
  expect(() => bridge.assertCanWrite("grade_lesson_quiz")).toThrow();
  bridge.onAgentEnd([]);
  expect(lessonRequests("rust")[0].error).toContain("without publishing");
  bridge.reset();
});

it("rejects symlinked lesson request storage without touching its target", () => {
  const target = path.join(fixture.root, "outside.json");
  fs.writeFileSync(target, "secret");
  fs.symlinkSync(target, path.join(fixture.root, "rust/.lesson-requests.json"));
  expect(() => lessonRequests("rust")).toThrow("symlink");
  expect(fs.readFileSync(target, "utf8")).toBe("secret");
});
it("retains rejected page code when explicit retry asks for a corrected authoring plan", async () => {
  const { prepareLessonRetry } = await import("../src/next-lesson.ts");
  const r = startLessonRequest("rust", randomUUID(), "", "codex");
  const document = nextLessonDocument(fixture.root);
  const failed = updateLessonRequest(saveLessonDocument(r, document), {
    status: "failed",
    pageCheckFailed: true,
    error: "Lesson headless page check failed: page error",
  });
  const retry = prepareLessonRetry(failed);
  expect(retry.document).toBeUndefined();
  expect(retry.rejectedDocuments).toEqual([document]);
});
it("limits Pi resource reading to the requested classroom and packaged guidance", async () => {
  const bridge = new ClassroomBridge({ sendUserMessage: () => {} });
  bridge.nextLesson(startLessonRequest("rust", randomUUID(), "", "pi"));
  expect(() =>
    bridge.assertLessonTool("read", { path: path.join(fixture.root, "rust/MISSION.md") }),
  ).not.toThrow();
  expect(() => bridge.assertLessonTool("read", { path: "/etc/passwd" })).toThrow("limited");
  await expect(bridge.researchTool().execute({ url: "http://127.0.0.1/" })).rejects.toThrow(
    "loopback",
  );
  bridge.reset();
});

it("recovers a saved validated service plan without another model turn or duplicate publication", async () => {
  const { createHash } = await import("node:crypto");
  const document = nextLessonDocument(fixture.root),
    r = startLessonRequest("rust", randomUUID(), "", "claude");
  updateLessonRequest(saveLessonDocument(r, document), {
    status: "running",
    pageCheck: {
      hash: createHash("sha256").update(JSON.stringify(document)).digest("hex"),
      report: "Fixture receipt at the production page-check recovery boundary.",
    },
  });
  saveTeacherState("rust", {
    version: 1,
    identity: { backend: "claude", sessionId: "existing-conversation" },
    requests: [
      {
        id: `lesson:${r.id}`,
        classroom: "rust",
        lesson: r.lesson,
        kind: "lesson",
        target: r.id,
        prompt: "Saved explicit request",
        at: r.at,
        status: "planned",
        planVersion: 2,
        planValidated: true,
        plan: {
          calls: [{ name: "publish_lesson", arguments_json: JSON.stringify(document) }],
          message: "Ready",
          learning_record: "",
          notes_markdown: "",
        },
      },
    ],
    messages: [],
  });
  const run = vi.fn(async () => {
    throw new Error("Unexpected second model turn");
  });
  const service = new TeacherService(run);
  service.attach("rust", "claude");
  await service.idle();
  expect(run).not.toHaveBeenCalled();
  expect(lessonRequests("rust")[0].status).toBe("done");
  expect(readTeacherState("rust")!.identity.sessionId).toBe("existing-conversation");
  expect(store.listLessons("rust").filter((l) => l.name === r.lesson)).toHaveLength(1);
  expect(store.listSubmissions("rust", r.lesson)).toEqual([]);
  expect(store.listGrades("rust", r.lesson)).toEqual([]);
  await service.stop();
  const again = new TeacherService(run);
  again.attach("rust", "claude");
  await again.idle();
  expect(run).not.toHaveBeenCalled();
  expect(store.listLessons("rust").filter((l) => l.name === r.lesson)).toHaveLength(1);
  await again.stop();
});

it("queues explicit Pi retry until the failed turn ends and rejects same-turn reauthoring", async () => {
  const send = vi.fn();
  const bridge = new ClassroomBridge({ sendUserMessage: send });
  const request = startLessonRequest("rust", randomUUID(), "", "pi");
  bridge.nextLesson(request);
  const document = nextLessonDocument(fixture.root);
  await expect(
    bridge.lessonTool().execute({ ...piLessonArguments(document), rubric: {} }),
  ).rejects.toThrow("missing quiz");
  await expect(bridge.lessonTool().execute(piLessonArguments(document))).rejects.toThrow(
    "explicit retry",
  );
  bridge.retryNextLesson(lessonRequests("rust")[0]);
  expect(send).toHaveBeenCalledTimes(1);
  expect(lessonRequests("rust")[0].status).toBe("queued");
  bridge.onAgentEnd([]);
  expect(send).toHaveBeenCalledTimes(2);
  expect(lessonRequests("rust")[0].status).toBe("running");
  expect(send.mock.calls[1][0]).toContain("Previous failure");
  bridge.reset();
});

it("rejects lesson publication from an ordinary panel reply before any authoring writes", async () => {
  const service = new TeacherService(async (_identity, _prompt, _cwd, _save, _signal, contract) => {
    expect(contract.research).toBeUndefined();
    expect(contract.operations).not.toContain("publish_lesson");
    return {
      calls: [
        {
          name: "publish_lesson",
          arguments_json: JSON.stringify(nextLessonDocument(fixture.root)),
        },
      ],
      message: "Ready",
      learning_record: "",
      notes_markdown: "",
    };
  });
  service.attach("rust", "claude");
  service.chat("rust", "001-ownership", "Start another lesson", randomUUID());
  await service.idle();
  expect(readTeacherState("rust")!.requests[0].error).toContain("not allowed");
  expect(lessonRequests("rust")).toEqual([]);
  expect(store.listLessons("rust")).toHaveLength(1);
  await service.stop();
});
