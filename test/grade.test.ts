import { describe, expect, it } from "vitest";
import {
  gradePointsNotice,
  gradeScore,
  gradeSummary,
  questionGradeLabel,
  questionOutcome,
  validateGrade,
} from "../assets/runtime/grade.mjs";

const questions = [
  { questionId: "q1", correct: true, pointsEarned: 9, pointsPossible: 9 },
  { questionId: "q2", correct: false, pointsEarned: 7, pointsPossible: 9 },
  { questionId: "q3", correct: false, pointsEarned: 5, pointsPossible: 9 },
];

describe("partial credit", () => {
  it("represents a rounded 78% score with one complete and two incomplete answers", () => {
    expect(validateGrade(78, questions, ["q1", "q2", "q3"])).toBeCloseTo(77.7778);
    expect(gradeSummary(questions)).toBe("1 of 3 fully correct · 2 partial credit");
    expect(questionGradeLabel(questions[1])).toBe("Partial credit (7/9 points)");
    expect(questionOutcome(questions[1])).toBe("partial");
  });

  it("reads historical binary grades without inferring unrecorded partial points", () => {
    const old = [{ questionId: "q1", correct: false }];
    expect(questionGradeLabel(old[0])).toBe("Incorrect");
    expect(gradeSummary(old)).toBe("0 of 1 fully correct");
    expect(gradePointsNotice({ score: 75, questions: old })).toContain("no per-question points");
    expect(gradePointsNotice({ score: 0, questions: old })).toBe("");
  });

  it("refuses inconsistent scores, correctness, invalid points, and duplicate questions", () => {
    expect(() => validateGrade(33, questions, ["q1", "q2", "q3"])).toThrow(/Score must match/);
    expect(() => validateGrade(78, [{ ...questions[1], correct: true }], ["q2"])).toThrow(
      /full credit/,
    );
    expect(() => validateGrade(100, [questions[0], questions[0]], ["q1"])).toThrow(/exactly once/);
    expect(() => validateGrade(140, [questions[0]], ["q1"])).toThrow(/Score must match/);
    expect(() => validateGrade(99.8, [questions[0]], ["q1"])).toThrow(/Score must match/);
  });
});

describe("grade validation boundaries", () => {
  it.each([
    { pointsEarned: -1 },
    { pointsEarned: 10 },
    { pointsEarned: undefined },
    { pointsEarned: NaN },
    { pointsPossible: 0 },
    { pointsPossible: Infinity },
    { correct: "true", pointsEarned: undefined, pointsPossible: undefined },
  ])("rejects invalid question data: %j", (patch) => {
    expect(() =>
      gradeScore([{ ...questions[1], ...patch }] as Parameters<typeof gradeScore>[0]),
    ).toThrow();
  });

  it("rejects empty grades and point totals that overflow", () => {
    expect(() => gradeScore([])).toThrow();
    const huge = { questionId: "q1", correct: true, pointsEarned: 1e308, pointsPossible: 1e308 };
    expect(() => gradeScore([huge, huge])).toThrow();
    expect(() =>
      gradeScore([
        { ...huge, correct: false, pointsEarned: 0 },
        { ...huge, correct: false, pointsEarned: 0 },
      ]),
    ).toThrow();
  });

  it.each([["q1", "other"], ["q1"], ["q1", "q2", "q3"]])(
    "rejects missing or unsubmitted question identities: %j",
    (...ids) => {
      expect(() =>
        validateGrade(
          50,
          [
            { questionId: "q1", correct: true },
            { questionId: "q2", correct: false },
          ],
          ids,
        ),
      ).toThrow();
    },
  );

  it.each([NaN, Infinity, -5e-10, 100 + 5e-10])("rejects invalid totals: %s", (score) => {
    expect(() =>
      validateGrade(score, [{ questionId: "q1", correct: score > 0 }], ["q1"]),
    ).toThrow();
  });

  it("accepts exact ratios, integer rounding, and the floating point tolerance boundary", () => {
    const partial = [{ questionId: "q1", correct: false, pointsEarned: 1, pointsPossible: 3 }];
    expect(validateGrade(100 / 3, partial, ["q1"])).toBeCloseTo(100 / 3);
    expect(validateGrade(33, partial, ["q1"])).toBeCloseTo(100 / 3);
    expect(validateGrade(1e-9, [{ questionId: "q1", correct: false }], ["q1"])).toBe(0);
    expect(() => validateGrade(2e-9, [{ questionId: "q1", correct: false }], ["q1"])).toThrow();
  });

  it("distinguishes historical rounding from missing point allocations", () => {
    const binary = [
      { questionId: "q1", correct: true },
      { questionId: "q2", correct: false },
    ];
    expect(gradePointsNotice({ score: 50.5, questions: binary })).toBe("");
    expect(gradePointsNotice({ score: 50.6, questions: binary })).not.toBe("");
    expect(gradePointsNotice({ score: 50, questions: [binary[0], questions[1]] })).toBe("");
    expect(questionOutcome(questions[0])).toBe("correct");
    expect(questionGradeLabel(questions[0])).toContain("9/9");
  });
});
