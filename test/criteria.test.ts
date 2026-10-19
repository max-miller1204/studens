import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { parseRubric } from "../src/rubric.ts";
import { allocateCriteria, validateCriterionGrade } from "../src/criteria.ts";
import { applyGrade, completeClosedSubmission } from "../src/quiz-grading.ts";
import { classroomTools, PI_HOST, isFailure } from "../src/tools.ts";
import { TeacherService } from "../src/teacher-service.ts";
import { readTeacherState, saveTeacherState } from "../src/service-state.ts";
import * as store from "../src/store.ts";
import * as server from "../src/server.ts";
import { makeFixture, seedClassroom, type Fixture } from "./helpers.ts";

const location = { classroom: "rust", lesson: "001-ownership" };
const definitions = [
  { id: "sum", description: "Square and sum", points: 2 },
  { id: "mean", description: "Average the squared residuals", points: 2 },
];
const entry = {
  expected: "5 / 2 = 2.5",
  points: 4,
  full: "Both steps",
  partial: "2 for sum",
  criteria: definitions,
};
const html =
  '<form class="cl-quiz" data-quiz-id="check"><li class="cl-q" data-question-id="q" data-type="short"></li></form>';
const raw = () => [
  { criterion_id: "sum", points_earned: 2, feedback: "The squares sum to 5." },
  { criterion_id: "mean", points_earned: 0, feedback: "Divide by the two residuals." },
];
let f: Fixture;
let key: string;
beforeEach(() => {
  f = makeFixture();
  seedClassroom(f);
  f.write(
    "rust/001-ownership/lesson.json",
    JSON.stringify({ title: "MSE", assessmentContract: 1, criterionContract: 1 }),
  );
  f.write("rust/001-ownership/lesson.html", html);
  key = JSON.stringify({ check: { q: entry } });
  f.write("rust/001-ownership/quiz/key.json", key);
});
afterEach(async () => {
  await server.close();
  f.cleanup();
});
const submit = () =>
  store.createSubmission({
    ...location,
    quizId: "check",
    quizTitle: "MSE",
    kind: "check",
    answers: [
      {
        questionId: "q",
        type: "short",
        value: "The squared sum is 5; MSE is 5.",
        confidence: "unsure",
        assistance: "hint",
      },
    ],
  });
const args = (id: string) => ({
  submission_id: id,
  score: 50,
  feedback_markdown: "Average after summing.",
  questions: [
    {
      question_id: "q",
      correct: false,
      points_earned: 2,
      points_possible: 4,
      feedback: "The mean requires division.",
      criteria: raw(),
    },
  ],
});
const tool = () => classroomTools(PI_HOST).find((t) => t.name === "grade_lesson_quiz")!;

it("requires new declared weights before submission while preserving old rubric schemas", () => {
  const legacy = JSON.stringify({ check: { q: { ...entry, criteria: undefined } } });
  expect(parseRubric(legacy, html).check.q.criteria).toBeUndefined();
  expect(() => parseRubric(legacy, html, "machine", true)).toThrow(/criteria array/);
  f.write("rust/001-ownership/quiz/key.json", legacy);
  expect(submit).toThrow(/criteria array/);
  expect(store.listSubmissions(location.classroom, location.lesson)).toHaveLength(0);
});

it.each(
  [
    [],
    [{ ...definitions[0], id: "bad/id" }],
    [definitions[0], definitions[0]],
    [{ ...definitions[0], points: 0 }],
    [{ ...definitions[0], points: Infinity }],
    [{ ...definitions[0], description: " " }],
    [{ ...definitions[0], points: 5 }],
  ].map((criteria) => [criteria]),
)("rejects invalid predeclared criterion data %j", (criteria) => {
  expect(() => parseRubric(JSON.stringify({ check: { q: { ...entry, criteria } } }), html)).toThrow(
    /criterion|criteria/,
  );
});

it("keeps definitions and answers private until grading, then persists the original allocation", async () => {
  const s = submit();
  expect(s.rubricCriteria).toEqual({ q: definitions });
  expect(store.publicSubmission(s)).not.toHaveProperty("rubricCriteria");
  const result = await tool().execute(args(s.id));
  expect(isFailure(result)).toBe(false);
  const grade = store.latestGrades(location.classroom, location.lesson)[0];
  expect(grade.score).toBe(50);
  expect(grade.questions[0].criteria).toMatchObject(
    definitions.map((c, i) => ({
      criterionId: c.id,
      description: c.description,
      pointsPossible: c.points,
      pointsEarned: i === 0 ? 2 : 0,
    })),
  );
  expect(store.findSubmission(s.id)).toEqual(s);
  expect(store.latestQuizStates(location.classroom, location.lesson)[0].grade).toEqual(grade);
});

it.each([
  ["missing", undefined],
  ["incomplete", [raw()[0]]],
  ["duplicate", [raw()[0], raw()[0]]],
  ["unknown", [raw()[0], { ...raw()[1], criterion_id: "other" }]],
  ["overcounted", [raw()[0], { ...raw()[1], points_earned: 3 }]],
  ["negative", [{ ...raw()[0], points_earned: -1 }, raw()[1]]],
  ["mismatched sum", [raw()[0], { ...raw()[1], points_earned: 1 }]],
  ["empty explanation", [{ ...raw()[0], feedback: " " }, raw()[1]]],
  ["teacher weight", [{ ...raw()[0], points_possible: 2 }, raw()[1]]],
  ["teacher description", [{ ...raw()[0], description: "Changed" }, raw()[1]]],
])("rejects %s allocations without writing a grade", async (_name, criteria) => {
  const s = submit(),
    input = args(s.id);
  input.questions[0].criteria = criteria as never;
  const result = await tool().execute(input);
  expect(isFailure(result)).toBe(true);
  expect(result.content[0].text).toMatch(/criteri|points|reasoning/);
  expect(store.listGrades(location.classroom, location.lesson)).toHaveLength(0);
});

it("protects direct persistence and preserves explicit revisions and earlier attempts", async () => {
  const s = submit();
  const criteria = allocateCriteria(s, "q", raw())!;
  expect(() =>
    applyGrade(s, {
      score: 50,
      feedbackMarkdown: "",
      questions: [
        {
          questionId: "q",
          correct: false,
          pointsEarned: 2,
          pointsPossible: 4,
          feedback: "",
          criteria: criteria.map((c) => ({ ...c, description: "tampered" })),
        },
      ],
    }),
  ).toThrow(/saved criterion/);
  await tool().execute(args(s.id));
  const original = store.listGrades(location.classroom, location.lesson)[0];
  await new Promise((resolve) => setTimeout(resolve, 2));
  const revised = args(s.id);
  revised.score = 100;
  revised.questions[0].correct = true;
  revised.questions[0].points_earned = 4;
  revised.questions[0].criteria[1].points_earned = 2;
  expect(isFailure(await tool().execute(revised))).toBe(false);
  expect(store.listGrades(location.classroom, location.lesson)).toHaveLength(2);
  expect(store.listGrades(location.classroom, location.lesson)[0]).toEqual(original);
  expect(store.latestQuizStates(location.classroom, location.lesson)[0].grade?.score).toBe(100);
  const second = submit();
  await tool().execute(args(second.id));
  expect(store.latestQuizStates(location.classroom, location.lesson)[0].attempts).toBe(2);
  expect(store.listGrades(location.classroom, location.lesson)[0]).toEqual(original);
});

it("does not fabricate criteria on an old pending attempt, even if the rubric now contains them", async () => {
  const s = submit();
  delete s.rubricCriteria;
  f.write(`rust/001-ownership/quiz/submissions/${s.submittedAt}-${s.id}.json`, JSON.stringify(s));
  expect(isFailure(await tool().execute(args(s.id)))).toBe(true);
  const input = args(s.id);
  delete (input.questions[0] as { criteria?: unknown }).criteria;
  expect(isFailure(await tool().execute(input))).toBe(false);
  expect(
    store.latestGrades(location.classroom, location.lesson)[0].questions[0].criteria,
  ).toBeUndefined();
});

it("rejects rubric changes while retaining the submitted criterion snapshot", async () => {
  const s = submit();
  f.write("rust/001-ownership/quiz/key.json", key.replace("Square and sum", "Changed"));
  expect(isFailure(await tool().execute(args(s.id)))).toBe(true);
  expect(store.findSubmission(s.id)?.rubricCriteria).toEqual({ q: definitions });
  expect(store.listGrades(location.classroom, location.lesson)).toHaveLength(0);
});

it("keeps exact criteria code-owned, binary, private and idempotent through startup", async () => {
  const closedHtml = html.replace('data-type="short"', 'data-type="choice"');
  const closedEntry = {
    ...entry,
    expected: "a",
    criteria: [{ id: "selection", description: "Choose the matching value", points: 4 }],
  };
  expect(() =>
    parseRubric(
      JSON.stringify({ check: { q: { ...closedEntry, criteria: definitions } } }),
      closedHtml,
    ),
  ).toThrow(/one all-or-zero/);
  f.write("rust/001-ownership/lesson.html", closedHtml);
  f.write("rust/001-ownership/quiz/key.json", JSON.stringify({ check: { q: closedEntry } }));
  const s = store.createSubmission({
    ...location,
    quizId: "check",
    quizTitle: "MSE",
    kind: "check",
    answers: [{ questionId: "q", type: "choice", value: "b", label: "wrong" }],
  });
  expect(completeClosedSubmission(s)).toBe(true);
  const grades = store.listGrades(location.classroom, location.lesson);
  expect(grades[0].questions[0].criteria?.[0].pointsEarned).toBe(0);
  expect(isFailure(await tool().execute(args(s.id)))).toBe(true);
  await server.start(0);
  completeClosedSubmission(s);
  expect(store.listGrades(location.classroom, location.lesson)).toEqual(grades);
});

it("applies an interrupted saved criterion plan once without another model turn", async () => {
  const s = submit();
  const input = args(s.id);
  delete (input as { score?: number }).score;
  saveTeacherState("rust", {
    version: 1,
    identity: { backend: "codex" },
    messages: [],
    requests: [
      {
        id: `quiz:${s.id}`,
        ...location,
        kind: "quiz",
        target: s.id,
        prompt: "saved",
        status: "planned",
        at: 1,
        applied: 0,
        planVersion: 2,
        planRubricDigest: createHash("sha256").update(key).digest("hex"),
        plan: {
          calls: [{ name: "grade_quiz_answers", arguments_json: JSON.stringify(input) }],
          message: "Divide your squared sum by two. What would you do for three residuals?",
          learning_record: "",
          notes_markdown: "",
        },
      },
    ],
  });
  for (let i = 0; i < 2; i++) {
    const teacher = new TeacherService(async () => {
      throw new Error("Unexpected model turn");
    });
    try {
      teacher.attach("rust", "codex");
      await teacher.idle();
    } finally {
      await teacher.stop();
    }
    expect(readTeacherState("rust")?.requests[0].status).toBe("done");
    expect(store.listGrades(location.classroom, location.lesson)).toHaveLength(1);
  }
  expect(
    store.latestGrades(location.classroom, location.lesson)[0].questions[0].criteria?.[0]
      .pointsEarned,
  ).toBe(2);
});

it("validates criterion sums against original definitions on every persistence path", () => {
  const s = submit();
  const criteria = allocateCriteria(s, "q", raw())!;
  expect(() =>
    validateCriterionGrade(s, {
      questionId: "q",
      correct: false,
      pointsEarned: 3,
      pointsPossible: 4,
      feedback: "",
      criteria,
    }),
  ).toThrow(/sum/);
});

it("preserves same-millisecond grade revisions and rejects corrupted saved criterion allocations", async () => {
  const s = submit();
  const clock = vi.spyOn(Date, "now").mockReturnValue(s.submittedAt + 1);
  try {
    expect(isFailure(await tool().execute(args(s.id)))).toBe(false);
    expect(isFailure(await tool().execute(args(s.id)))).toBe(false);
  } finally {
    clock.mockRestore();
  }
  const grades = store.listGrades(location.classroom, location.lesson);
  expect(grades).toHaveLength(2);
  expect(grades[1].gradedAt).toBe(grades[0].gradedAt + 1);
  grades[1].questions[0].criteria![1].pointsEarned = 1;
  f.write(
    `rust/001-ownership/quiz/grades/${grades[1].gradedAt}-${s.id}.json`,
    JSON.stringify(grades[1]),
  );
  expect(() => store.latestQuizStates(location.classroom, location.lesson)).toThrow(
    /criterion allocations must sum/,
  );
});

it("rejects reallocated criteria on a later attempt while preserving the earlier saved grade", async () => {
  const first = submit();
  await tool().execute(args(first.id));
  const before = store.listGrades(location.classroom, location.lesson);
  const changed = {
    ...entry,
    criteria: definitions.map((c, i) => ({ ...c, points: i === 0 ? 1 : 3 })),
  };
  f.write("rust/001-ownership/quiz/key.json", JSON.stringify({ check: { q: changed } }));
  expect(submit).toThrow(/rubric changed after an earlier attempt/);
  expect(store.listSubmissions(location.classroom, location.lesson)).toHaveLength(1);
  expect(store.listGrades(location.classroom, location.lesson)).toEqual(before);
});

it("names invalid saved criterion identities instead of throwing a null dereference", () => {
  const s = submit();
  const criteria = allocateCriteria(s, "q", raw())!;
  expect(() =>
    validateCriterionGrade(s, {
      questionId: "q",
      correct: false,
      pointsEarned: 2,
      pointsPossible: 4,
      feedback: "",
      criteria: [null as never, criteria[1]],
    }),
  ).toThrow(/declared criterion ids/);
});

it("returns a specific HTTP error and preserves drafts when later weights change", async () => {
  const first = submit();
  await tool().execute(args(first.id));
  const draft = { q: { value: "Keep this work" } };
  store.saveDraft(location.classroom, location.lesson, "quiz:check", draft);
  f.write(
    "rust/001-ownership/quiz/key.json",
    JSON.stringify({
      check: {
        q: { ...entry, criteria: definitions.map((c, i) => ({ ...c, points: i === 0 ? 1 : 3 })) },
      },
    }),
  );
  const base = await server.start(0);
  const response = await fetch(base + "/api/quiz/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...location, quizId: "check", kind: "check", answers: first.answers }),
  });
  expect(response.status).toBe(400);
  expect((await response.json()).error).toMatch(/rubric changed after an earlier attempt/);
  expect(store.readDrafts(location.classroom, location.lesson)["quiz:check"]).toEqual(draft);
  expect(store.listSubmissions(location.classroom, location.lesson)).toHaveLength(1);
  expect(store.listGrades(location.classroom, location.lesson)).toHaveLength(1);
});

it("rejects tampered saved quiz totals or question identities when criterion evidence exists", async () => {
  const s = submit();
  await tool().execute(args(s.id));
  const grade = store.listGrades(location.classroom, location.lesson)[0];
  const file = `rust/001-ownership/quiz/grades/${grade.gradedAt}-${s.id}.json`;
  for (const changed of [
    { ...grade, score: 99 },
    { ...grade, questions: [] },
    { ...grade, questions: [...grade.questions, ...grade.questions] },
  ]) {
    f.write(file, JSON.stringify(changed));
    expect(() => store.latestQuizStates(location.classroom, location.lesson)).toThrow(
      /Score must match|every submitted question|exactly once/,
    );
  }
  f.write(file, JSON.stringify(grade));
  expect(store.latestQuizStates(location.classroom, location.lesson)[0].grade).toEqual(grade);
});
