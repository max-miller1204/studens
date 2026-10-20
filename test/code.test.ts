import * as fs from "node:fs";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import {
  CODE_ENGINE,
  parseCodeExercise,
  parseCodeRun,
  sameCodeJson,
} from "../assets/runtime/code.mjs";
import { questionErrors } from "../assets/runtime/quiz.mjs";
import { machineGraded } from "../assets/runtime/closed.mjs";
import { practiceEntry } from "../assets/runtime/practice.mjs";
import { authoredQuestionShapes } from "../src/quiz-authoring.ts";
import { validateCodeQuestions } from "../src/code-questions.ts";
import { parseAnswer, answerDetail } from "../src/quiz.ts";
import { parseRubric } from "../src/rubric.ts";
import { validateVariant } from "../src/review-variants.ts";
import * as store from "../src/store.ts";
import { makeFixture, seedClassroom } from "./helpers.ts";
import { codeForm, codeQuestion, codeRubric, exercise, source } from "./code-fixture.ts";
import { preflightLessonInputs, readLessonInputs } from "../scripts/lesson-inputs.ts";

const meta = { assessmentContract: 1, criterionContract: 1 };
const raw = () => ({ questionId: "sum", type: "code", value: source, code: { exercise } });
const run = () => ({
  id: randomUUID(),
  source,
  engine: CODE_ENGINE,
  status: "complete",
  output: "",
  results: exercise.tests.map((t) => ({
    id: t.id,
    outcome: "passed",
    actual: JSON.stringify(t.expected),
  })),
});
let f: ReturnType<typeof makeFixture> | undefined;
afterEach(() => f?.cleanup());

it.each([
  ["language", { ...exercise, language: "python" }],
  ["version", { ...exercise, version: 2 }],
  ["executable tests", { ...exercise, tests: ["sum([])===0"] }],
  ["entry expression", { ...exercise, entry: "sum.call" }],
  ["reserved entry", { ...exercise, entry: "for" }],
  ["no tests", { ...exercise, tests: [] }],
  ["duplicate ids", { ...exercise, tests: [exercise.tests[0], exercise.tests[0]] }],
  ["missing expected", { ...exercise, tests: [{ id: "x", args: [] }] }],
  ["extra fields", { ...exercise, grading: "machine" }],
  ["oversized contract", { ...exercise, entry: "x".repeat(16001) }],
])("rejects malformed public contract: %s", (_name, value) => {
  expect(() => parseCodeExercise(JSON.stringify(value))).toThrow();
  expect(questionErrors(authoredQuestionShapes(codeForm(source, value))[0]).length).toBeGreaterThan(
    0,
  );
});

it("decodes HTML quoted test strings identically and validates gated code", () => {
  const contract = { ...exercise, tests: [{ id: "quoted", args: ["<&\"'"], expected: "<&\"'" }] };
  const html = `<template data-cl-after-pretest="pre">${codeForm(source, contract)}</template>`;
  const shape = authoredQuestionShapes(html, true)[0];
  expect(parseCodeExercise(shape.code)).toEqual(contract);
  expect(questionErrors(shape)).toEqual([]);
  expect(
    questionErrors(
      authoredQuestionShapes(
        codeForm()
          .replace("<textarea class=", "<span><textarea class=")
          .replace("</textarea>", "</textarea></span>"),
      )[0],
    ),
  ).toEqual([]);
  expect(() => validateCodeQuestions(html, null)).toThrow(/assessmentContract/);
  expect(() => validateCodeQuestions(html, meta)).not.toThrow();
  expect(() =>
    validateCodeQuestions(html.replace('class="cl-code-source"', 'class="other"'), meta),
  ).toThrow(/textarea/);
});

it("never trims/truncates source or accepts a stale or oversized run", () => {
  const spaced = `\n  ${source}\n`;
  expect(parseAnswer({ ...raw(), value: spaced }, "check").value).toBe(spaced);
  expect(() => parseAnswer({ ...raw(), value: "x".repeat(8001) }, "check")).toThrow(
    /never truncated/,
  );
  expect(() =>
    parseAnswer({ ...raw(), code: { exercise, run: { ...run(), source: "different" } } }, "check"),
  ).toThrow(/stale/);
  expect(() => parseCodeRun({ ...run(), output: "x".repeat(8193) }, source, exercise)).toThrow();
});

it("requires complete ordered finite results and rejects interrupted passing flags", () => {
  expect(parseCodeRun(run(), source, exercise)?.status).toBe("complete");
  expect(() => parseCodeRun({ ...run(), results: [] }, source, exercise)).toThrow(
    /every public test/,
  );
  expect(() =>
    parseCodeRun({ ...run(), status: "timeout", error: "Timed out" }, source, exercise),
  ).toThrow(/interrupted/);
  expect(() =>
    parseCodeRun(
      {
        ...run(),
        results: [{ id: "empty", outcome: "passed", actual: "999" }, ...run().results.slice(1)],
      },
      source,
      exercise,
    ),
  ).toThrow(/contradicts/);
  expect(() =>
    parseCodeRun(
      {
        ...run(),
        results: [{ id: "empty", outcome: "failed", actual: "1e999" }, ...run().results.slice(1)],
      },
      source,
      exercise,
    ),
  ).toThrow(/finite/);
  expect(sameCodeJson({ a: 1, b: [2] }, { b: [2], a: 1 })).toBe(true);
  expect(sameCodeJson([1, 2], [2, 1])).toBe(false);
});

it("keeps code under declared judgment criteria, independent of browser pass flags", () => {
  expect(machineGraded("code", codeRubric)).toBe(false);
  expect(() => machineGraded("code", { ...codeRubric, grading: "exact" })).toThrow(/judgment/);
  expect(() =>
    practiceEntry("code", { expected: 0, correct: "Yes", incorrect: "Try again" }),
  ).toThrow();
  expect(() =>
    parseRubric(
      JSON.stringify({ check: { sum: { ...codeRubric, criteria: undefined } } }),
      codeForm(),
    ),
  ).toThrow(/criteria/);
  expect(
    answerDetail([parseAnswer({ ...raw(), code: { exercise, run: run() } }, "check")]).join("\n"),
  ).toContain("never execute on the host");
});

it("snapshots exact source and authored tests once, rejects altered client/tests, and creates no machine allocation", () => {
  f = makeFixture();
  seedClassroom(f);
  f.write("rust/001-ownership/lesson.json", JSON.stringify({ title: "Code", ...meta }));
  f.write("rust/001-ownership/lesson.html", codeForm());
  f.write("rust/001-ownership/quiz/key.json", JSON.stringify({ check: { sum: codeRubric } }));
  const input = {
    classroom: "rust",
    lesson: "001-ownership",
    quizId: "check",
    quizTitle: "Code",
    kind: "check" as const,
    answers: [parseAnswer({ ...raw(), code: { exercise, run: run() } }, "check")],
  };
  const saved = store.createSubmission(input);
  expect(saved.answers[0].value).toBe(source);
  expect(saved.answers[0].code?.exercise).toEqual(exercise);
  expect(saved.deterministicGrades).toEqual([]);
  expect(saved.rubricCriteria?.sum).toEqual(codeRubric.criteria);
  expect(store.listGrades("rust", "001-ownership")).toEqual([]);
  expect(store.publicSubmission(saved).rubricCriteria).toBeUndefined();
  const old = JSON.stringify(store.listSubmissions("rust", "001-ownership"));
  const changed = { ...exercise, entry: "other" };
  expect(() =>
    store.createSubmission({
      ...input,
      answers: [parseAnswer({ ...raw(), code: { exercise: changed } }, "check")],
    }),
  ).toThrow(/Public code tests changed/);
  f.write("rust/001-ownership/lesson.html", codeForm(source, changed));
  expect(() =>
    store.createSubmission({
      ...input,
      answers: [parseAnswer({ ...raw(), code: { exercise: changed } }, "check")],
    }),
  ).toThrow(/after an earlier attempt/);
  expect(JSON.stringify(store.listSubmissions("rust", "001-ownership"))).toBe(old);
});

it("validates code in private variants and private preflight without running it on the host", () => {
  const variant = { id: "sum", html: codeQuestion(), rubric: codeRubric };
  const objective = { statement: "Implement an accumulator", application: true };
  const mapping = { objective: "original", support: "independent", task: "application" };
  expect(validateVariant(variant, mapping, objective).id).toBe("sum");
  expect(() =>
    validateVariant(
      { ...variant, html: codeQuestion(source, { ...exercise, language: "python" }) },
      mapping,
      objective,
    ),
  ).toThrow(/javascript/);
  f = makeFixture();
  seedClassroom(f);
  f.write("rust/001-ownership/lesson.json", JSON.stringify({ title: "Code", ...meta }));
  f.write("rust/001-ownership/lesson.html", codeForm("throw new Error('HOST_EXECUTION_IS_A_BUG')"));
  f.write("rust/001-ownership/quiz/key.json", JSON.stringify({ check: { sum: codeRubric } }));
  const before = fs.readFileSync(f.root + "/rust/001-ownership/lesson.html");
  expect(() =>
    preflightLessonInputs(readLessonInputs("rust", "001-ownership"), "rust", "001-ownership"),
  ).not.toThrow();
  f.write("rust/001-ownership/lesson.html", codeForm(source, { ...exercise, language: "python" }));
  expect(() =>
    preflightLessonInputs(readLessonInputs("rust", "001-ownership"), "rust", "001-ownership"),
  ).toThrow(/javascript/);
  expect(before.toString()).toContain("HOST_EXECUTION_IS_A_BUG");
});
