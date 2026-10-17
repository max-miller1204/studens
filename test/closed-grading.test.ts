import { describe, expect, it } from "vitest";
import { gradeClosed, machineGraded, mergeGrades } from "../src/closed-grading.ts";
import type { RubricQuestion } from "../src/rubric.ts";
import type { QuizAnswer, QuestionType } from "../src/quiz.ts";

const entry = (expected: unknown, extra = {}): RubricQuestion => ({
  expected,
  points: 3,
  full: "Full credit explanation.",
  partial: "No partial credit.",
  ...extra,
});
const parts = (...ids: string[]) => ids.map((id) => ({ id, value: "Untrusted label" }));
const answer = (type: QuestionType, extra: Partial<QuizAnswer>): QuizAnswer => ({
  questionId: "q",
  type,
  ...extra,
});
const grade = (type: QuestionType, expected: unknown, extra: Partial<QuizAnswer>, options = {}) =>
  gradeClosed(answer(type, extra), entry(expected, options))!;

describe("machine rubric contract", () => {
  it.each(["short", "term", "locate"] as const)("keeps %s judgment by default", (type) => {
    expect(machineGraded(type, entry("Explain"))).toBe(false);
    expect(gradeClosed(answer(type, { value: "Explain" }), entry("Explain"))).toBeNull();
  });
  it("keeps legacy answers and explicit judgment out of exact grading", () => {
    expect(gradeClosed({ questionId: "old", value: "a" }, entry("a"))).toBeNull();
    for (const type of ["short", "term", "locate", "cloze"] as const)
      expect(machineGraded(type, entry("Explain", { grading: "teacher" }))).toBe(false);
  });
  it.each(["choice", "multi", "numeric", "order", "match"] as const)(
    "refuses teacher grading for %s",
    (type) => {
      expect(() => machineGraded(type, entry("a", { grading: "teacher" }))).toThrow();
    },
  );
  it("rejects unknown modes and exact essays", () => {
    for (const grading of [null, "model", 1, false])
      expect(() => machineGraded("term", entry("a", { grading }))).toThrow();
    expect(() => machineGraded("short", entry("a", { grading: "exact" }))).toThrow();
  });
  // One representative for each validation rule; shared validators need no type cross-product.
  const malformed: Array<[QuestionType, unknown]> = [
    ["choice", null],
    ["choice", "bad id"],
    ["multi", null],
    ["multi", []],
    ["multi", ["a", "a"]],
    ["multi", ["a", "bad id"]],
    ["order", null],
    ["order", ["a"]],
    ["locate", null],
    ["numeric", null],
    ["numeric", {}],
    ["numeric", { value: "1" }],
    ["numeric", { value: Infinity }],
    ["numeric", { value: 1, tolerance: -1 }],
    ["numeric", { value: 1, tolerance: "0" }],
    ["numeric", { value: 1, tolerance: null }],
    ["numeric", { value: 1, tolerance: Infinity }],
    ["numeric", { value: 1, unit: "" }],
    ["numeric", { value: 1, unit: 1 }],
    ["numeric", { value: 1, unit: "  " }],
    ["term", null],
    ["term", []],
    ["term", ["good", ""]],
    ["match", null],
    ["match", []],
    ["match", {}],
    ["match", "a"],
    ["match", { "bad id": "a" }],
    ["match", { good: "right", bad: "bad id" }],
    ["match", { a: ["b"] }],
    ["cloze", { good: "owner", bad: "" }],
    ["cloze", { a: [] }],
  ];
  it.each(malformed)("rejects invalid %s key %j", (type, key) => {
    expect(() => machineGraded(type, entry(key, { grading: "exact" }))).toThrow(
      /Invalid machine-checkable expected answer/,
    );
  });
});

describe("closed point allocations", () => {
  it("uses choice values, rubric points, and full credit feedback", () => {
    expect(
      grade("choice", "a", {
        value: "a",
        label: "Wrong label",
        confidence: "guess",
        assistance: "hint",
      }),
    ).toEqual({
      questionId: "q",
      correct: true,
      pointsEarned: 3,
      pointsPossible: 3,
      feedback: "Full credit explanation.",
    });
    const wrong = grade("choice", "a", { value: "b", label: "a" });
    expect(wrong).toMatchObject({ correct: false, pointsEarned: 0, pointsPossible: 3 });
    expect(wrong.feedback).toBeTruthy();
    expect(grade("choice", "a", {}).correct).toBe(false);
    expect(grade("choice", "a", { value: "A" }).correct).toBe(false);
  });
  it("compares sets without accepting missing, additional, duplicate, or display-only values", () => {
    for (const type of ["multi", "locate"] as const) {
      const options = type === "locate" ? { grading: "exact" } : {};
      expect(grade(type, ["a", "b"], { parts: parts("b", "a") }, options).correct).toBe(true);
      for (const actual of [
        undefined,
        parts("a"),
        parts("a", "b", "c"),
        parts("a", "a"),
        parts("a", "c"),
      ])
        expect(grade(type, ["a", "b"], { parts: actual }, options)).toMatchObject({
          correct: false,
          pointsEarned: 0,
        });
    }
  });
  it("keeps order significant and requires all items", () => {
    expect(grade("order", ["a", "b"], { parts: parts("a", "b") }).correct).toBe(true);
    for (const actual of [
      undefined,
      parts("b", "a"),
      parts("a"),
      parts("a", "b", "c"),
      parts("a", "a"),
    ])
      expect(grade("order", ["a", "b"], { parts: actual }).correct).toBe(false);
  });
  it("compares complete pairs by identities rather than labels or pair order", () => {
    const pairs = [
      { left: "a", right: "x", leftLabel: "bad", rightLabel: "bad" },
      { left: "b", right: "y", leftLabel: "bad", rightLabel: "bad" },
    ];
    expect(grade("match", { a: "x", b: "y" }, { pairs: [...pairs].reverse() }).correct).toBe(true);
    for (const actual of [
      undefined,
      pairs.slice(0, 1),
      [pairs[0], pairs[0]],
      [...pairs, { ...pairs[0], left: "c" }],
      [pairs[0], { ...pairs[1], right: "x" }],
    ])
      expect(grade("match", { a: "x", b: "y" }, { pairs: actual }).correct).toBe(false);
  });
  it("accepts declared text alternatives with case and whitespace normalization", () => {
    for (const expected of ["Rust owner", ["Owner", "Rust owner"]])
      expect(
        grade("term", expected, { value: "  RUST\n owner  " }, { grading: "exact" }).correct,
      ).toBe(true);
    for (const value of [undefined, "owners", "the owner", "rustowner"])
      expect(grade("term", ["owner", "rust owner"], { value }, { grading: "exact" }).correct).toBe(
        false,
      );
  });
  it("requires every cloze blank, accepting each blank's declared alternatives", () => {
    const key = { one: ["owner", "holder"], two: "end of scope" };
    const actual = [
      { id: "two", value: " End  of\nScope " },
      { id: "one", value: " HOLDER " },
    ];
    expect(grade("cloze", key, { parts: actual }).correct).toBe(true);
    for (const p of [
      undefined,
      actual.slice(0, 1),
      [actual[0], actual[0]],
      [...actual, { id: "three", value: "x" }],
      [actual[0], { id: "one", value: "anything" }],
    ])
      expect(grade("cloze", key, { parts: p }).correct).toBe(false);
  });
  it("handles signed, decimal, scientific values, inclusive absolute tolerance, and exact unit spelling", () => {
    for (const value of ["-2", "-2.25", "-1.75", "-2e0"])
      expect(
        grade("numeric", { value: -2, tolerance: 0.25, unit: "m" }, { value, unit: " m " }).correct,
      ).toBe(true);
    for (const value of ["-2.25001", "-1.74999", "bad", "", undefined])
      expect(
        grade("numeric", { value: -2, tolerance: 0.25, unit: "m" }, { value, unit: "m" }).correct,
      ).toBe(false);
    for (const unit of [undefined, "", "M", "cm"])
      expect(grade("numeric", { value: 2, unit: "m" }, { value: "2", unit }).correct).toBe(false);
    expect(grade("numeric", { value: 0 }, { value: "0" }).correct).toBe(true);
    expect(grade("numeric", { value: 0 }, { value: "invalid" }).correct).toBe(false);
    expect(grade("numeric", { value: 2, unit: " m " }, { value: "2", unit: "m" }).correct).toBe(
      true,
    );
    expect(grade("numeric", { value: 0, tolerance: 0 }, { value: "0.000001" }).correct).toBe(false);
    expect(grade("numeric", { value: 2 }, { value: "2", unit: "kg" }).correct).toBe(false);
  });
  it("keeps decimal tolerance boundaries inclusive without relaxing exact or overflowing comparisons", () => {
    for (const value of ["0.9", "1.1"])
      expect(grade("numeric", { value: 1, tolerance: 0.1 }, { value }).correct).toBe(true);
    expect(grade("numeric", { value: 0.3, tolerance: 0.6 }, { value: "0.9" }).correct).toBe(true);
    expect(
      grade("numeric", { value: 1e9, tolerance: 0.1 }, { value: "1000000000.1" }).correct,
    ).toBe(true);
    for (const value of ["0.8999999999", "1.1000000001"])
      expect(grade("numeric", { value: 1, tolerance: 0.1 }, { value }).correct).toBe(false);
    expect(grade("numeric", { value: 1 }, { value: "1.0000000000000002" }).correct).toBe(false);
    expect(
      grade(
        "numeric",
        { value: -Number.MAX_VALUE, tolerance: Number.MAX_VALUE },
        { value: String(Number.MAX_VALUE) },
      ).correct,
    ).toBe(false);
  });
  it("merges without changing either input and rejects teacher overrides", () => {
    const fixed = [grade("choice", "a", { value: "a" })];
    const teacher = [{ ...fixed[0], questionId: "open", pointsEarned: 1, correct: false }];
    expect(mergeGrades(fixed, teacher)).toEqual([...fixed, ...teacher]);
    expect(fixed).toHaveLength(1);
    expect(teacher).toHaveLength(1);
    expect(() => mergeGrades(fixed, fixed)).toThrow(/omit machine/);
    expect(() => mergeGrades(fixed, [...teacher, ...fixed])).toThrow(/omit machine/);
    expect(mergeGrades([], teacher)).toEqual(teacher);
  });
});
