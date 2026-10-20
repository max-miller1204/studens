import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { makeFixture, seedClassroom, seedPreparedReviewSource } from "./helpers.ts";
import type { Fixture } from "./helpers.ts";
import { nextLessonDocument, nextLessonReceipt } from "./next-lesson-fixture.ts";
import {
  completeLessonRequest,
  startLessonRequest,
  lessonRequests,
  requireLessonOwner,
  saveLessonDocument,
  updateLessonRequest,
  publicLessonRequest,
  piLessonArguments,
  validateLessonDocument,
} from "../src/next-lesson.ts";
import { TeacherService } from "../src/teacher-service.ts";
import { readTeacherState, saveTeacherState } from "../src/service-state.ts";
import { ClassroomBridge } from "../src/bridge.ts";
import * as store from "../src/store.ts";
import { assetsDir, docsDir, templatesDir } from "../src/paths.ts";
import { lessonOutput } from "./lesson-output-fixture.ts";
import { lessonModelPlan } from "../src/lesson-output.ts";
import type { RunTeacher } from "../src/teacher.ts";
function lessonSender(send: (...args: any[]) => void) {
  let tools = [
    "bash",
    "read",
    "custom_tool",
    "grade_lesson_quiz",
    "publish_lesson",
    "read_lesson_source",
  ];
  return {
    sendUserMessage: send,
    getActiveTools: () => [...tools],
    setActiveTools: (names: string[]) => {
      tools = [...names];
    },
  };
}
let fixture: Fixture;
beforeEach(() => {
  fixture = makeFixture();
  seedClassroom(fixture);
  seedPreparedReviewSource(fixture.root);
});
afterEach(() => fixture.cleanup());
it.each(["pi", "claude", "codex"] as const)(
  "assembles inline contracts and service capabilities for the actual %s producer request",
  async (backend) => {
    let prompt = "";
    const service = new TeacherService(
      async (_identity, assembled, _cwd, _save, _signal, contract) => {
        prompt = assembled;
        expect(contract).toMatchObject({
          operations: ["publish_lesson"],
          research: true,
          required: true,
        });
        throw new Error("Controlled producer stop before publication");
      },
    );
    try {
      service.attach("rust", backend);
      const request = startLessonRequest("rust", randomUUID(), "Borrowing", backend, "service");
      service.nextLesson(request);
      await service.idle();
      // Full source contracts remain available, including their examples and limits.
      for (const name of ["TEACHING.md", "TEACHING-PLAN.md", "CODE-EXERCISES.md"])
        expect(prompt).toContain(fs.readFileSync(path.join(docsDir(), name), "utf8"));
      for (const name of ["quiz.html", "lesson.html", "faded.html", "stepper.html"])
        expect(prompt).toContain(fs.readFileSync(path.join(templatesDir(), name), "utf8"));
      expect(prompt).toContain("Classroom resources:");
      expect(prompt).toContain("Borrowing");
      expect(prompt).toContain("no local-file, shell or browser access");
      expect(prompt).toContain("host or filesystem authoring sessions");
      expect(prompt).not.toContain(templatesDir());
      expect(prompt).not.toContain(path.join(assetsDir(), "playwright-headless.json"));
      expect(prompt).not.toContain("For every page, run node");
      expect(prompt).not.toContain("For playwright-cli");
      expect(prompt).not.toContain(`${request.lesson}/quiz/key.json`);
      expect(prompt).not.toContain(`${request.lesson}/quiz/plan.json`);
      expect(prompt).toContain("Return typed lesson data:");
      const failed = readTeacherState("rust")!.requests[0];
      expect(failed.status).toBe("failed");
      expect(failed.applied ?? 0).toBe(0);
      expect(fs.existsSync(path.join(fixture.root, "rust", request.lesson))).toBe(false);
    } finally {
      await service.stop();
    }
  },
);
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
it.each(["visible", "private variant"])(
  "requires declared criteria on every new %s question before saving",
  (where) => {
    const request = startLessonRequest("rust", randomUUID(), "", "pi");
    const document = nextLessonDocument(fixture.root);
    const key = JSON.parse(document.rubric_json);
    const entry = where === "visible" ? key["pretest-1"].p1 : key["check-1"].q1.variants[0].rubric;
    delete entry.criteria;
    document.rubric_json = JSON.stringify(key);
    expect(() => validateLessonDocument(document)).toThrow(/criteria/);
    expect(() => saveLessonDocument(request, document)).toThrow(/criteria/);
    expect(lessonRequests("rust")[0].document).toBeUndefined();
    expect(fs.existsSync(path.join(fixture.root, "rust", request.lesson))).toBe(false);
  },
);
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
it.each(["pi", "codex"] as const)(
  "saves decoder-rejected %s lesson output before failure and retains raw output on explicit retry",
  async (backend) => {
    const raw = lessonOutput(nextLessonDocument(fixture.root));
    raw.variants[0].quiz = "unknown-quiz";
    let turns = 0;
    const run: RunTeacher = async (...args) => {
      turns++;
      args[6]?.(raw);
      return lessonModelPlan(raw);
    };
    const service = new TeacherService(run);
    service.attach("rust", backend);
    const request = startLessonRequest("rust", randomUUID(), "next", backend, "service");
    service.nextLesson(request);
    await service.idle();
    expect(turns).toBe(1);
    const failed = lessonRequests("rust")[0];
    expect(failed.error).toContain("Private variant names an unknown quiz or question");
    expect(failed.modelOutput).toEqual(raw);
    expect(readTeacherState("rust")!.requests[0].modelOutput).toEqual(raw);
    expect(failed.document).toBeUndefined();
    expect(publicLessonRequest(failed)).not.toHaveProperty("modelOutput");
    expect(fs.existsSync(path.join(fixture.root, "rust", request.lesson))).toBe(false);
    await service.stop();
    // An earlier release saved this decoder failure only in .teacher.json.
    updateLessonRequest(failed, { modelOutput: undefined });
    const restarted = new TeacherService(run);
    restarted.attach("rust", backend);
    await restarted.idle();
    expect(turns).toBe(1);
    restarted.retry("rust", `lesson:${request.id}`);
    await restarted.idle();
    expect(turns).toBe(2);
    const retried = lessonRequests("rust")[0];
    expect(retried.failedAttempts).toEqual([
      { at: expect.any(Number), error: failed.error, output: raw },
    ]);
    expect(retried.status).toBe("failed");
    expect(retried.modelOutput).toEqual(raw);
    expect(fs.existsSync(path.join(fixture.root, "rust", request.lesson))).toBe(false);
    await restarted.stop();
  },
);
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
  const bridge = new ClassroomBridge(lessonSender(send));
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
  const bridge = new ClassroomBridge(lessonSender(() => {}));
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

it.each(["pi", "claude", "codex"] as const)(
  "recovers a saved validated %s plan without another model turn or duplicate publication",
  async (backend) => {
    const { createHash } = await import("node:crypto");
    const document = nextLessonDocument(fixture.root),
      r = startLessonRequest("rust", randomUUID(), "", backend, "service");
    updateLessonRequest(saveLessonDocument(r, document), {
      status: "running",
      pageCheck: {
        hash: createHash("sha256").update(JSON.stringify(document)).digest("hex"),
        report: nextLessonReceipt(r, document),
      },
    });
    saveTeacherState("rust", {
      version: 1,
      identity: { backend, sessionId: "existing-conversation" },
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
    service.attach("rust", backend);
    await service.idle();
    expect(run).not.toHaveBeenCalled();
    expect(lessonRequests("rust")[0].status).toBe("done");
    expect(readTeacherState("rust")!.identity.sessionId).toBe("existing-conversation");
    expect(store.listLessons("rust").filter((l) => l.name === r.lesson)).toHaveLength(1);
    expect(store.listSubmissions("rust", r.lesson)).toEqual([]);
    expect(store.listGrades("rust", r.lesson)).toEqual([]);
    expect(store.readLesson("rust", r.lesson)?.criterionContract).toBe(1);
    expect(
      JSON.parse(
        fs.readFileSync(path.join(fixture.root, "rust", r.lesson, "quiz/key.json"), "utf8"),
      ),
    ).toEqual(JSON.parse(document.rubric_json));
    await service.stop();
    const again = new TeacherService(run);
    again.attach("rust", backend);
    await again.idle();
    expect(run).not.toHaveBeenCalled();
    expect(store.listLessons("rust").filter((l) => l.name === r.lesson)).toHaveLength(1);
    await again.stop();
  },
);

it("queues explicit Pi retry until the failed turn ends and rejects same-turn reauthoring", async () => {
  const send = vi.fn();
  const bridge = new ClassroomBridge(lessonSender(send));
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

it("acknowledges only an identical completed Pi publication in its owning origin without writes", async () => {
  const { createHash } = await import("node:crypto");
  const bridge = new ClassroomBridge(lessonSender(() => {}));
  const request = startLessonRequest("rust", randomUUID(), "", "pi");
  bridge.nextLesson(request);
  const document = nextLessonDocument(fixture.root);
  updateLessonRequest(saveLessonDocument(request, document), {
    pageCheck: {
      hash: createHash("sha256").update(JSON.stringify(document)).digest("hex"),
      report: nextLessonReceipt(request, document),
    },
  });
  const first = await bridge.lessonTool().execute(piLessonArguments(document));
  const statePath = path.join(fixture.root, "rust/.lesson-requests.json");
  const before = fs.readFileSync(statePath, "utf8");
  expect(await bridge.lessonTool().execute(piLessonArguments(document))).toEqual(first);
  expect(fs.readFileSync(statePath, "utf8")).toBe(before);
  await expect(
    bridge.lessonTool().execute(piLessonArguments({ ...document, title: "Changed" })),
  ).rejects.toThrow("cannot be changed");
  expect(fs.readFileSync(statePath, "utf8")).toBe(before);
  expect(store.listLessons("rust").filter((l) => l.name === request.lesson)).toHaveLength(1);
  expect(store.listSubmissions("rust", request.lesson)).toEqual([]);
  expect(store.listGrades("rust", request.lesson)).toEqual([]);
  bridge.onAgentEnd([]);
  await expect(bridge.lessonTool().execute(piLessonArguments(document))).rejects.toThrow(
    "No explicit lesson request",
  );
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

it("advertises only explicit lesson tools and restores the exact previous set after failed origin and shutdown", () => {
  const pi = lessonSender(vi.fn());
  const prior = ["custom_tool", "bash"];
  pi.setActiveTools(prior);
  const bridge = new ClassroomBridge(pi);
  bridge.nextLesson(startLessonRequest("rust", randomUUID(), "", "pi"));
  expect(pi.getActiveTools()).toEqual(["publish_lesson", "read_lesson_source"]);
  expect(() => bridge.assertLessonTool("bash")).toThrow("cannot use bash");
  bridge.onAgentEnd([]);
  expect(pi.getActiveTools()).toEqual(prior);
  bridge.retryNextLesson(lessonRequests("rust")[0]);
  expect(pi.getActiveTools()).toEqual(["publish_lesson", "read_lesson_source"]);
  bridge.reset();
  expect(pi.getActiveTools()).toEqual(prior);
  expect(lessonRequests("rust")[0].status).toBe("failed");
});
it("restores tools after send failure and refuses missing activation controls without a model turn", () => {
  const send = vi.fn(() => {
    throw new Error("Explicit send failure");
  });
  const pi = lessonSender(send),
    prior = pi.getActiveTools(),
    bridge = new ClassroomBridge(pi);
  bridge.nextLesson(startLessonRequest("rust", randomUUID(), "", "pi"));
  expect(pi.getActiveTools()).toEqual(prior);
  expect(lessonRequests("rust")[0].error).toContain("Explicit send failure");
  bridge.reset();
  const absent = vi.fn();
  const missing = new ClassroomBridge({ sendUserMessage: absent });
  missing.retryNextLesson(lessonRequests("rust")[0]);
  expect(absent).not.toHaveBeenCalled();
  expect(lessonRequests("rust")[0].error).toContain("controls are unavailable");
  missing.reset();
});
it("restores tools even when reading failed authoring state throws during origin completion", () => {
  const pi = lessonSender(vi.fn()),
    prior = pi.getActiveTools(),
    bridge = new ClassroomBridge(pi);
  bridge.nextLesson(startLessonRequest("rust", randomUUID(), "", "pi"));
  fixture.write("rust/.lesson-requests.json", "invalid state");
  expect(() => bridge.onAgentEnd([])).toThrow();
  expect(pi.getActiveTools()).toEqual(prior);
});
it("does not run a model if Pi ignores a required lesson tool activation", () => {
  const send = vi.fn();
  let active = ["bash", "read"];
  const prior = [...active];
  const bridge = new ClassroomBridge({
    sendUserMessage: send,
    getActiveTools: () => [...active],
    setActiveTools: (names) => {
      active = names.filter((n) => n !== "publish_lesson");
    },
  });
  bridge.nextLesson(startLessonRequest("rust", randomUUID(), "", "pi"));
  expect(send).not.toHaveBeenCalled();
  expect(active).toEqual(prior);
  expect(lessonRequests("rust")[0].status).toBe("failed");
  expect(lessonRequests("rust")[0].error).toContain("exact explicit-lesson tool set");
  bridge.reset();
});

it("queues learner turns arriving during Pi authoring until exact tools are restored, preserving order", () => {
  const seen: string[][] = [];
  const send = vi.fn(() => {
    seen.push(pi.getActiveTools());
  });
  const pi = lessonSender(send),
    prior = pi.getActiveTools(),
    bridge = new ClassroomBridge(pi);
  bridge.nextLesson(startLessonRequest("rust", randomUUID(), "", "pi"));
  bridge.chat("rust", "001-ownership", "First learner reply", randomUUID());
  bridge.chat("rust", "001-ownership", "Second learner reply", randomUUID());
  expect(send).toHaveBeenCalledTimes(1);
  bridge.onAgentEnd([]);
  expect(send).toHaveBeenCalledTimes(2);
  expect(seen[1]).toEqual(prior);
  bridge.onAgentEnd([
    { role: "assistant", content: [{ type: "text", text: "First teacher reply" }] },
  ]);
  expect(send).toHaveBeenCalledTimes(3);
  expect(seen[2]).toEqual(prior);
  bridge.onAgentEnd([
    { role: "assistant", content: [{ type: "text", text: "Second teacher reply" }] },
  ]);
  expect(
    store
      .listPanelMessages("rust", "001-ownership")
      .filter((m) => m.role === "teacher")
      .map((m) => m.text),
  ).toEqual(["First teacher reply", "Second teacher reply"]);
  bridge.reset();
});
it("keeps a queued Pi send failure explicit and does not retry it automatically", () => {
  const send = vi.fn(() => {
    if (send.mock.calls.length === 2) throw new Error("Queued transport unavailable");
  });
  const pi = lessonSender(send),
    prior = pi.getActiveTools(),
    bridge = new ClassroomBridge(pi);
  bridge.nextLesson(startLessonRequest("rust", randomUUID(), "", "pi"));
  bridge.chat("rust", "001-ownership", "Actual learner reply", randomUUID());
  bridge.onAgentEnd([]);
  expect(send).toHaveBeenCalledTimes(2);
  expect(pi.getActiveTools()).toEqual(prior);
  expect((bridge.panelState("rust", "001-ownership") as any).requests[0]).toMatchObject({
    status: "failed",
    error: expect.stringContaining("Queued transport unavailable"),
  });
  bridge.onAgentEnd([]);
  expect(send).toHaveBeenCalledTimes(2);
  bridge.reset();
});

it("supplies Pi the actual lazy record listing before the panel reply without creating records", () => {
  const send = vi.fn(),
    bridge = new ClassroomBridge(lessonSender(send));
  bridge.chat("rust", "001-ownership", "My actual answer without help", randomUUID());
  expect(send.mock.calls[0][0]).toContain("Host-checked existing learning record files (data): []");
  expect(send.mock.calls[0][0]).toContain("learning-records/0001-<slug>.md");
  expect(fs.existsSync(path.join(fixture.root, "rust/learning-records"))).toBe(false);
  bridge.onAgentEnd([
    { role: "assistant", content: [{ type: "text", text: "A response on the page" }] },
  ]);
  fixture.write("rust/learning-records/0003-owner.md", "# Existing demonstrated evidence");
  bridge.chat("rust", "001-ownership", "Another actual answer", randomUUID());
  expect(send.mock.calls[1][0]).toContain(
    'Host-checked existing learning record files (data): ["0003-owner.md"]',
  );
  expect(store.listLearningRecords("rust")).toEqual(["0003-owner.md"]);
  bridge.reset();
});

it("refuses unfinished legacy Pi authoring before changing teacher identity or saved output", async () => {
  const request = startLessonRequest("rust", randomUUID(), "legacy", "pi");
  saveLessonDocument(request, nextLessonDocument(fixture.root));
  const before = fs.readFileSync(path.join(fixture.root, "rust/.lesson-requests.json"));
  const service = new TeacherService(async () => {
    throw new Error("Must not infer");
  });
  expect(() => service.attach("rust", "pi")).toThrow("unfinished legacy Pi lesson request");
  expect(readTeacherState("rust")).toBeNull();
  expect(fs.readFileSync(path.join(fixture.root, "rust/.lesson-requests.json"))).toEqual(before);
  await service.stop();
});

it("recovers persistent Pi lesson failure in the same service queue without another model turn", async () => {
  let turns = 0;
  const run: RunTeacher = async (_identity, _prompt, _cwd, save) => {
    turns++;
    save("same-pi-session.jsonl");
    return lessonModelPlan(lessonOutput(nextLessonDocument(fixture.root)));
  };
  const service = new TeacherService(run);
  service.attach("rust", "pi");
  const request = startLessonRequest("rust", randomUUID(), "next", "pi", "service");
  // A saved checked document may fail publication; restart never adopts a live origin.
  const document = nextLessonDocument(fixture.root);
  saveLessonDocument(request, document);
  updateLessonRequest(request, { status: "failed", error: "Retained publication failure" });
  service.nextLesson(lessonRequests("rust")[0]);
  await service.idle();
  await service.stop();
  const restarted = new TeacherService(run);
  restarted.attach("rust", "pi");
  await restarted.idle();
  expect(turns).toBe(0);
  expect(lessonRequests("rust")[0].status).toBe("failed");
  expect(readTeacherState("rust")!.identity.backend).toBe("pi");
  await restarted.stop();
});

it("refuses a corrupt saved page-check receipt before publication writes", async () => {
  const { createHash } = await import("node:crypto");
  const request = startLessonRequest("rust", randomUUID(), "", "pi", "service");
  const document = nextLessonDocument(fixture.root);
  const saved = updateLessonRequest(saveLessonDocument(request, document), {
    pageCheck: {
      hash: createHash("sha256").update(JSON.stringify(document)).digest("hex"),
      report: "corrupt receipt",
    },
  });
  await expect(completeLessonRequest(saved)).rejects.toThrow("receipt is invalid JSON");
  expect(fs.existsSync(path.join(fixture.root, "rust", request.lesson))).toBe(false);
  expect(lessonRequests("rust")[0].document).toEqual(document);
});
