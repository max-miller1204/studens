import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { passageAnswerPlan, PASSAGE_ANSWER_SCHEMA } from "../src/passage-answer.ts";
import { parseModelPlan, planSchema } from "../src/teacher.ts";
import { TeacherService } from "../src/teacher-service.ts";
import { readTeacherState, saveTeacherState } from "../src/service-state.ts";
import * as store from "../src/store.ts";
import { makeFixture, seedClassroom, type Fixture } from "./helpers.ts";

const markdown = 'One "owner" uses C:\\notes\\λ.\n\n```rust\nlet café = "🦀";\n```\n';
let f: Fixture;
beforeEach(() => {
  f = makeFixture();
  seedClassroom(f);
});
afterEach(() => f.cleanup());
const annotation = () =>
  store.createAnnotation({
    classroom: "rust",
    lesson: "001-ownership",
    question: "Why?",
    selection: "Some lesson prose",
    anchor: { exact: "Some lesson prose", prefix: "", suffix: "", occurrence: 0 },
  });

it("selects typed passage transport only by the explicit current request contract", () => {
  expect(
    planSchema({
      operations: ["answer_lesson_question"],
      required: true,
      response: "passage-answer",
    }),
  ).toEqual(PASSAGE_ANSWER_SCHEMA);
  expect(planSchema({ operations: ["answer_lesson_question"], required: true })).toHaveProperty(
    "properties.calls",
  );
  expect(() => parseModelPlan({ annotation_id: "a", answer_markdown: markdown })).toThrow();
  const plan = passageAnswerPlan({ answer_markdown: markdown, annotation_id: "a" });
  expect(plan.calls).toHaveLength(1);
  expect(plan.calls[0].arguments_json).toBe(
    JSON.stringify({ annotation_id: "a", answer_markdown: markdown }),
  );
  expect(JSON.parse(plan.calls[0].arguments_json).answer_markdown).toBe(markdown);
});
it.each([
  null,
  [],
  {},
  { annotation_id: "a" },
  { answer_markdown: markdown },
  { annotation_id: 1, answer_markdown: markdown },
  { annotation_id: "a", answer_markdown: null },
  { annotation_id: "", answer_markdown: markdown },
  { annotation_id: "a", answer_markdown: " \n" },
  { annotation_id: "a", answer_markdown: markdown, calls: [] },
  { annotation_id: "a", answer_markdown: markdown, learning_record: null },
  {
    calls: [{ name: "answer_lesson_question", arguments_json: "{}" }],
    message: "",
    learning_record: null,
    notes_markdown: "",
  },
])("rejects missing, wrong or extra typed fields without repairing them: %j", (value) => {
  expect(() => passageAnswerPlan(value)).toThrow();
});
it("keeps FIFO, validates before writes, saves the canonical plan, and recovers a lost answer receipt once", async () => {
  const a = annotation();
  let runs = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const teacher = new TeacherService(
    async (_id, prompt, _cwd, _save, _signal, contract, saveOutput) => {
      expect(contract.response).toBe("passage-answer");
      expect(prompt).not.toContain("arguments_json contains");
      const state = readTeacherState("rust")!;
      const active = state.requests.find((r) => r.status === "running")!;
      if (++runs === 1) await held;
      else expect(store.findAnnotation(a.id)!.answerMarkdown).toBe(markdown);
      const raw = {
        annotation_id: a.id,
        answer_markdown: active.kind === "ask" ? markdown : "Follow-up\n" + markdown,
      };
      saveOutput!(raw);
      expect(
        readTeacherState("rust")!.requests.find((r) => r.id === active.id)!.plan,
      ).toBeUndefined();
      return passageAnswerPlan(raw);
    },
  );
  teacher.attach("rust", "codex");
  teacher.question(a);
  const follow = store.addFollowUp(a.id, "And then?")!;
  teacher.followUp(follow.annotation, follow.followUp);
  release();
  await teacher.idle();
  await teacher.stop();
  const state = readTeacherState("rust")!;
  expect(state.requests.map((r) => [r.kind, r.status, r.applied, r.planValidated])).toEqual([
    ["ask", "done", 1, true],
    ["follow-up", "done", 1, true],
  ]);
  const before = store.findAnnotation(a.id)!;
  expect(before.answerMarkdown).toBe(markdown);
  expect(before.followUps![0].answerMarkdown).toBe("Follow-up\n" + markdown);
  expect(before.answerHtml).toContain("café");
  // A process can stop after saving the answer but before its applied receipt.
  for (const r of state.requests) {
    r.status = "planned";
    r.applied = 0;
  }
  saveTeacherState("rust", state);
  const recovered = new TeacherService(async () => {
    throw new Error("Saved plans must not infer again");
  });
  recovered.attach("rust", "codex");
  await recovered.idle();
  await recovered.stop();
  expect(store.findAnnotation(a.id)).toEqual(before);
  expect(
    readTeacherState("rust")!.requests.every((r) => r.status === "done" && r.applied === 1),
  ).toBe(true);
  expect(store.listGrades("rust", "001-ownership")).toEqual([]);
  expect(store.listRetrievalChecks("rust")).toEqual([]);
  expect(store.readLearningRecords("rust")).toEqual([]);
});
it.each(["foreign", "extra-call", "empty"])(
  "rejects %s before applying any answer",
  async (mode) => {
    const a = annotation();
    seedClassroom(f, { classroom: "foreign" });
    const other = store.createAnnotation({ ...a, classroom: "foreign" });
    const teacher = new TeacherService(async () => {
      const p = passageAnswerPlan({
        annotation_id: mode === "foreign" ? other.id : a.id,
        answer_markdown: markdown,
      });
      if (mode === "extra-call") p.calls.push({ ...p.calls[0] });
      if (mode === "empty")
        p.calls[0].arguments_json = JSON.stringify({ annotation_id: a.id, answer_markdown: "" });
      return p;
    });
    teacher.attach("rust", "codex");
    teacher.question(a);
    await teacher.idle();
    await teacher.stop();
    const r = readTeacherState("rust")!.requests[0];
    expect(r.status).toBe("failed");
    expect(r.planValidated).toBe(false);
    expect(r.applied ?? 0).toBe(0);
    expect(store.findAnnotation(a.id)!.answerMarkdown).toBeNull();
    expect(store.findAnnotation(other.id)!.answerMarkdown).toBeNull();
  },
);
it("retains malformed historical canonical JSON as failed until explicit retry asks for new typed data", async () => {
  const a = annotation();
  const teacher = new TeacherService(async () => ({
    calls: [
      {
        name: "answer_lesson_question",
        arguments_json: '{"annotation_id":"' + a.id + '","answer_markdown":"first\nsecond"}',
      },
    ],
    message: "",
    learning_record: "",
    notes_markdown: "",
  }));
  teacher.attach("rust", "codex");
  teacher.question(a);
  await teacher.idle();
  await teacher.stop();
  const original = readTeacherState("rust")!;
  expect(original.requests[0].status).toBe("failed");
  expect(original.requests[0].planValidated).toBe(false);
  let runs = 0;
  const fresh = new TeacherService(
    async (_id, prompt, _cwd, _save, _signal, contract, saveOutput) => {
      runs++;
      expect(contract.response).toBe("passage-answer");
      expect(prompt).not.toContain("When you have the answer, call");
      const raw = { annotation_id: a.id, answer_markdown: markdown };
      saveOutput!(raw);
      return passageAnswerPlan(raw);
    },
  );
  fresh.attach("rust", "codex");
  await fresh.idle();
  expect(runs).toBe(0);
  expect(readTeacherState("rust")!.requests).toEqual(original.requests);
  fresh.retry("rust", original.requests[0].id);
  await fresh.idle();
  expect(runs).toBe(1);
  expect(store.findAnnotation(a.id)!.answerMarkdown).toBe(markdown);
  expect(() => fresh.retry("rust", original.requests[0].id)).toThrow("cannot be retried");
  await fresh.stop();
});

it("persists raw output and the validated canonical plan before a refused answer write, then explicitly recovers without inference", async () => {
  const a = annotation();
  const file = path.join(f.root, "rust/001-ownership/annotations.json");
  fs.chmodSync(file, 0o400);
  let runs = 0;
  const teacher = new TeacherService(
    async (_id, _prompt, _cwd, _save, _signal, _contract, saveOutput) => {
      runs++;
      const raw = { annotation_id: a.id, answer_markdown: markdown };
      saveOutput!(raw);
      return passageAnswerPlan(raw);
    },
  );
  try {
    teacher.attach("rust", "codex");
    await teacher.idle();
    await teacher.stop();
    const failed = readTeacherState("rust")!.requests[0];
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("EACCES");
    expect(failed.planValidated).toBe(true);
    expect(failed.applied ?? 0).toBe(0);
    expect(failed.modelOutput).toEqual({ annotation_id: a.id, answer_markdown: markdown });
    expect(JSON.parse(failed.plan!.calls[0].arguments_json).answer_markdown).toBe(markdown);
    expect(store.findAnnotation(a.id)!.answerMarkdown).toBeNull();
    fs.chmodSync(file, 0o600);
    const recovered = new TeacherService(async () => {
      throw new Error("No new inference allowed");
    });
    recovered.attach("rust", "codex");
    await recovered.idle();
    expect(readTeacherState("rust")!.requests[0].status).toBe("failed");
    recovered.retry("rust", failed.id);
    await recovered.idle();
    await recovered.stop();
    expect(runs).toBe(1);
    expect(store.findAnnotation(a.id)!.answerMarkdown).toBe(markdown);
    expect(readTeacherState("rust")!.requests[0].plan).toEqual(failed.plan);
  } finally {
    fs.chmodSync(file, 0o600);
  }
});
