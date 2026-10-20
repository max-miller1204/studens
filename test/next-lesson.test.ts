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
  validateLessonDocument,
} from "../src/next-lesson.ts";
import { TeacherService } from "../src/teacher-service.ts";
import { readTeacherState, saveTeacherState } from "../src/service-state.ts";
import * as store from "../src/store.ts";
import { assetsDir, docsDir, templatesDir } from "../src/paths.ts";
import { lessonOutput } from "./lesson-output-fixture.ts";
import { lessonModelPlan } from "../src/lesson-output.ts";
import type { RunTeacher } from "../src/teacher.ts";
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
      const request = startLessonRequest("rust", randomUUID(), "Borrowing", backend);
      service.nextLesson(request);
      await service.idle();
      // Full source contracts remain available, including their examples and limits.
      for (const name of [
        "TEACHING.md",
        "TEACHING-PLAN.md",
        "CODE-EXERCISES.md",
        "SOURCE-LINKS.md",
      ])
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
    const request = startLessonRequest("rust", randomUUID(), "next", backend);
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

it.each(["pi", "claude", "codex"] as const)(
  "recovers a saved validated %s plan without another model turn or duplicate publication",
  async (backend) => {
    const { createHash } = await import("node:crypto");
    const document = nextLessonDocument(fixture.root),
      r = startLessonRequest("rust", randomUUID(), "", backend);
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

it("recovers persistent Pi lesson failure in the same service queue without another model turn", async () => {
  let turns = 0;
  const run: RunTeacher = async (_identity, _prompt, _cwd, save) => {
    turns++;
    save("same-pi-session.jsonl");
    return lessonModelPlan(lessonOutput(nextLessonDocument(fixture.root)));
  };
  const service = new TeacherService(run);
  service.attach("rust", "pi");
  const request = startLessonRequest("rust", randomUUID(), "next", "pi");
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
  const request = startLessonRequest("rust", randomUUID(), "", "pi");
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

it("keeps explicit teaching provenance through typed output and refuses unsafe origins before saved publication", () => {
  const original = nextLessonDocument(fixture.root);
  original.lesson_html = original.lesson_html.replace(
    '<section id="teaching-owner"',
    '<section data-cl-teaches="Ownership" id="teaching-owner"',
  );
  const plan = lessonModelPlan(lessonOutput(original));
  const call = plan.calls[0];
  expect(call.name).toBe("publish_lesson");
  const document = JSON.parse(call.arguments_json);
  validateLessonDocument(document);
  const request = startLessonRequest("rust", randomUUID(), "Teaching origin", "codex");
  expect(() =>
    saveLessonDocument(request, {
      ...document,
      lesson_html: document.lesson_html.replace('id="teaching-owner"', 'id="../quiz/key.json"'),
    }),
  ).toThrow("safe, stable section id");
  expect(lessonRequests("rust").find((r) => r.id === request.id)?.document).toBeUndefined();
  expect(fs.existsSync(path.join(fixture.root, "rust", request.lesson))).toBe(false);
  saveLessonDocument(request, document);
  expect(lessonRequests("rust").find((r) => r.id === request.id)?.document?.lesson_html).toContain(
    'data-cl-teaches="Ownership"',
  );
});
