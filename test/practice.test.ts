import { expect, it } from "vitest";
import { practiceEntry, practiceErrors, practiceFeedback } from "../assets/runtime/practice.mjs";
import {
  authoredQuestions,
  authoredQuizzes,
  authoredQuestionShapes,
} from "../src/quiz-authoring.ts";
import { parseRubric } from "../src/rubric.ts";
import type { QuestionShape } from "../assets/runtime/quiz.mjs";

const entry = (expected: unknown) => ({
  expected,
  correct: "Explain the principle.",
  incorrect: "Try the principle again.",
});
it("keeps practice out of graded identities, rubrics, and control shapes", () => {
  const graded =
    '<form class="cl-quiz" data-quiz-id="check"><li class="cl-q" data-question-id="q1" data-type="term"><input type="text"></li></form>';
  const practice =
    '<form class="cl-practice" data-practice-id="practice"><li class="cl-q" data-question-id="local" data-type="choice"><input type="radio" value="a"><input type="radio" value="b"></li></form>';
  expect(authoredQuestions(practice + graded)).toEqual(authoredQuestions(graded));
  expect(authoredQuizzes(practice + graded)).toEqual(authoredQuizzes(graded));
  expect(authoredQuestionShapes(practice + graded)).toEqual(authoredQuestionShapes(graded));
  const rubric = JSON.stringify({
    check: { q1: { expected: "owner", points: 1, full: "Name it", partial: "No partial" } },
  });
  expect(parseRubric(rubric, practice + graded)).toEqual(parseRubric(rubric, graded));
});
it("refuses judgment questions, missing explanations, and copied rubric fields", () => {
  expect(() => practiceEntry("short", entry("reason"))).toThrow("teacher judgment");
  expect(() => practiceEntry("term", { ...entry("owner"), incorrect: "" })).toThrow(
    "incorrect feedback",
  );
  expect(() => practiceEntry("term", { ...entry("owner"), points: 1 })).toThrow("only expected");
});
it("matches exact answers using the shared assessment comparison without a grade record", () => {
  expect(
    practiceFeedback(
      { questionId: "p1", type: "numeric", value: "1.1", unit: "m" },
      entry({ value: 1, tolerance: 0.1, unit: "m" }),
    ),
  ).toEqual({ correct: true, feedback: entry(0).correct });
  expect(
    practiceFeedback(
      { questionId: "p1", type: "term", value: "wrong" },
      entry(["owner", "holder"]),
    ),
  ).toEqual({ correct: false, feedback: entry(0).incorrect });
});
it("rejects a public key with ids outside the authored controls", () => {
  const shape = { id: "p1", type: "choice", options: ["a", "b"] } as QuestionShape;
  expect(practiceErrors([shape], { p1: entry("c") })).toEqual([
    "Practice question p1: practice key does not match its controls.",
  ]);
  expect(practiceErrors([shape], { p1: entry("a"), extra: entry("a") })).toContain(
    "Practice key must contain exactly the practice question ids.",
  );
});

it("requires numeric units to be answerable through their controls", () => {
  const shape = { id: "p1", type: "numeric", units: 0 } as QuestionShape;
  const key = { p1: entry({ value: 2, unit: "m" }) };
  expect(practiceErrors([shape], key)).toEqual([
    'Practice question p1: numeric practice requires one .cl-unit control for "m".',
  ]);
  expect(practiceErrors([{ ...shape, units: 1, unitValues: null }], key)).toEqual([]);
  expect(practiceErrors([{ ...shape, units: 1, unitValues: ["cm", "m"] }], key)).toEqual([]);
  for (const unitValues of [[], ["cm"]])
    expect(practiceErrors([{ ...shape, units: 1, unitValues }], key)).toHaveLength(1);
  const scalar = { p1: entry({ value: 2 }) };
  expect(practiceErrors([shape], scalar)).toEqual([]);
  expect(practiceErrors([{ ...shape, units: 1, unitValues: ["m"] }], scalar)).toHaveLength(1);
  expect(practiceErrors([{ ...shape, units: 1, unitValues: [""] }], scalar)).toEqual([]);
  expect(
    practiceFeedback({ questionId: "p1", type: "numeric", value: "2", unit: "cm" }, key.p1).correct,
  ).toBe(false);
  expect(
    practiceFeedback({ questionId: "p1", type: "numeric", value: "2 m", unit: "m" }, key.p1)
      .correct,
  ).toBe(false);
});
