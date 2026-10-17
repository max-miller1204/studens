import { describe, expect, it } from "vitest";
import { parseRubric } from "../src/rubric.ts";

const question = '<li class="cl-q" data-question-id="q1" data-type="short"></li>';
const quiz = (body = question, attributes = 'data-quiz-id="check"') =>
  `<form class="cl-quiz" ${attributes}>${body}</form>`;
const criteria = { expected: "A reason", points: 2, full: "Both steps", partial: "First step" };
const rubric = (entry: unknown) => ({ check: { q1: entry } });
const parse = (value: unknown, html = quiz()) => parseRubric(JSON.stringify(value), html);

describe("private rubric", () => {
  it.each(["A reason", 0, false, ["owner"], { value: "scope" }])(
    "preserves structured expected answers: %j",
    (expected) => {
      const value = rubric({ ...criteria, expected });
      expect(parse(value)).toEqual(value);
    },
  );

  it("binds criteria across quizzes and identifies the invalid question", () => {
    const html =
      quiz(question + question.replace('data-question-id="q1"', 'data-question-id="q2"')) +
      quiz(question, 'data-quiz-id="other"');
    const value = {
      check: { q1: criteria, q2: { ...criteria, points: 1 } },
      other: { q1: criteria },
    };
    expect(parse(value, html)).toEqual(value);
    value.check.q2.points = 0;
    expect(() => parse(value, html)).toThrow(/check\/q2/);
  });

  it("rejects invalid JSON", () => {
    expect(() => parseRubric("{", quiz())).toThrow(SyntaxError);
  });

  it.each([null, [], 1])("rejects a non-object rubric: %j", (value) => {
    expect(() => parse(value)).toThrow(/keyed by quiz id/);
  });

  it.each([undefined, [], 1])("requires quiz criteria: %j", (check) => {
    expect(() => parse({ check })).toThrow(/missing quiz check/);
  });

  it.each([
    ["absent entry", undefined, /expected answer/],
    ["null entry", null, /expected answer/],
    ["scalar entry", 1, /expected answer/],
    ["missing answer", { ...criteria, expected: undefined }, /expected answer/],
    ["null answer", { ...criteria, expected: null }, /expected answer/],
    ["empty answer", { ...criteria, expected: "" }, /expected answer/],
    ...[undefined, "2", 0].map(
      (points) => [`invalid points ${points}`, { ...criteria, points }, /positive points/] as const,
    ),
    ...["full", "partial"].flatMap((field) =>
      [1, "   "].map(
        (value) =>
          [
            `invalid ${field} ${value}`,
            { ...criteria, [field]: value },
            /credit criteria/,
          ] as const,
      ),
    ),
  ] as const)("rejects %s", (_name, entry, error) => {
    expect(() => parse(rubric(entry))).toThrow(error);
  });

  it.each([
    ["no quiz", "", /authored quiz/],
    ["no questions", quiz(""), /Invalid authored quiz/],
    ["duplicate quizzes", quiz() + quiz(), /unique id/],
    ["missing quiz id", quiz(question, ""), /data-quiz-id/],
    [
      "unknown kind",
      quiz(question, 'data-quiz-id="check" data-kind="other"'),
      /Invalid authored quiz/,
    ],
    ["duplicate questions", quiz(question + question), /Duplicate question ids/],
    [
      "missing question id",
      quiz(question.replace('data-question-id="q1"', "")),
      /Unfinished authored question/,
    ],
    [
      "unknown type",
      quiz(question.replace('data-type="short"', 'data-type="essay"')),
      /Unfinished authored question/,
    ],
  ] as const)("rejects authored structure with %s", (_name, html, error) => {
    expect(() => parse(rubric(criteria), html)).toThrow(error);
  });
});

it("includes authored identity when a closed rubric key cannot be checked in code", () => {
  const html = quiz(question.replace('data-type="short"', 'data-type="numeric"'));
  expect(() => parse(rubric({ ...criteria, expected: "one" }), html)).toThrow(
    /check\/q1.*machine-checkable/,
  );
});

it("preserves pre-machine numeric criteria only for the explicit legacy format", () => {
  const html = quiz(question.replace('data-type="short"', 'data-type="numeric"'));
  const value = rubric({ ...criteria, expected: "2.5" });
  expect(parseRubric(JSON.stringify(value), html, "legacy")).toEqual(value);
  expect(() => parseRubric(JSON.stringify(value), html, "machine")).toThrow(/machine-checkable/);
});
