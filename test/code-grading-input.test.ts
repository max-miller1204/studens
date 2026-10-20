import { afterEach, expect, it } from "vitest";
import { makeFixture, seedClassroom } from "./helpers.ts";
import { codeForm, codeRubric, exercise, source } from "./code-fixture.ts";
import * as store from "../src/store.ts";
import { TeacherService } from "../src/teacher-service.ts";
import { parseModelPlan } from "../src/teacher.ts";
import { readTeacherState } from "../src/service-state.ts";

let f: ReturnType<typeof makeFixture>, teacher: TeacherService;
afterEach(async () => {
  await teacher?.stop();
  f?.cleanup();
});
function setup(type: "code" | "short" = "code") {
  f = makeFixture();
  seedClassroom(f);
  f.write(
    "rust/001-ownership/lesson.json",
    JSON.stringify({ title: "Code", assessmentContract: 1, criterionContract: 1 }),
  );
  f.write(
    "rust/001-ownership/lesson.html",
    type === "code"
      ? codeForm()
      : '<form class="cl-quiz" data-quiz-id="check"><li class="cl-q" data-question-id="sum" data-type="short"><p class="cl-q-prompt">Explain sum.</p><textarea></textarea></li></form>',
  );
  f.write("rust/001-ownership/quiz/key.json", JSON.stringify({ check: { sum: codeRubric } }));
  return store.createSubmission({
    classroom: "rust",
    lesson: "001-ownership",
    quizId: "check",
    quizTitle: "Code",
    kind: "check",
    answers: [
      {
        questionId: "sum",
        type,
        value: source,
        ...(type === "code" ? { code: { exercise } } : {}),
      },
    ],
  });
}
function response(id: string, record: string | null, correct = true) {
  return parseModelPlan({
    calls: [
      {
        name: "grade_quiz_answers",
        arguments_json: JSON.stringify({
          submission_id: id,
          feedback_markdown: "Source assessment.",
          questions: [
            {
              question_id: "sum",
              correct,
              points_earned: correct ? 2 : 0,
              points_possible: 2,
              feedback: "Saved source assessed.",
              criteria: codeRubric.criteria.map((c) => ({
                criterion_id: c.id,
                points_earned: correct ? 1 : 0,
                feedback: "Source evidence.",
              })),
            },
          ],
        }),
      },
    ],
    message: "Feedback about your saved source.",
    learning_record: record === null ? null : { markdown: record },
    notes_markdown: "",
  });
}
it.each([
  ["missing citation", "Correct source.", true, false],
  ["wrong citation", "Evidence: wrong/sum.", true, false],
  ["uncredited citation", "Evidence: check/sum.", false, false],
  ["optional null", null, true, true],
  [
    "supported citation",
    "Evidence: check/sum. The source accumulates inputs from zero; assistance unknown.",
    true,
    true,
  ],
] as const)(
  "keeps existing code record validation for %s",
  async (_name, record, correct, valid) => {
    const s = setup();
    teacher = new TeacherService(async (_identity, prompt) => {
      expect(prompt).toContain('["check/sum"]');
      return response(s.id, record, correct);
    });
    teacher.attach("rust", "claude");
    await teacher.idle();
    const r = readTeacherState("rust")!.requests[0];
    expect(r.status).toBe(valid ? "done" : "failed");
    expect(store.listGrades("rust", "001-ownership")).toHaveLength(valid ? 1 : 0);
    expect(store.listLearningRecords("rust")).toHaveLength(valid && record !== null ? 1 : 0);
  },
);
it("recomputes code reference forms on explicit retry without changing the attempt or granting evidence", async () => {
  const s = setup(),
    snapshot = JSON.stringify(store.findSubmission(s.id));
  let calls = 0;
  teacher = new TeacherService(async (_identity, prompt) => {
    calls++;
    expect(prompt).toContain('["check/sum"]');
    return response(s.id, calls === 1 ? "Uncited optional record." : null);
  });
  teacher.attach("rust", "claude");
  await teacher.idle();
  const rejected = readTeacherState("rust")!.requests[0];
  expect(rejected.status).toBe("failed");
  expect(rejected.planValidated).toBe(false);
  expect(calls).toBe(1);
  teacher.retry("rust", rejected.id);
  await teacher.idle();
  expect(calls).toBe(2);
  expect(readTeacherState("rust")!.requests[0].status).toBe("done");
  expect(store.listGrades("rust", "001-ownership")).toHaveLength(1);
  expect(JSON.stringify(store.findSubmission(s.id))).toBe(snapshot);
  expect(store.listLearningRecords("rust")).toHaveLength(0);
});
it("does not append code reference forms to ordinary noncode grading input", async () => {
  const s = setup("short");
  teacher = new TeacherService(async (_identity, prompt) => {
    expect(prompt).not.toContain('["check/sum"]');
    return response(s.id, null);
  });
  teacher.attach("rust", "claude");
  await teacher.idle();
  expect(readTeacherState("rust")!.requests[0].status).toBe("done");
});
