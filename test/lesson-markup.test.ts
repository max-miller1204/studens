import * as fs from "node:fs";
import { expect, it } from "vitest";
import { validateLessonMarkup } from "../src/lesson-markup.ts";

const root = (body: string) =>
  `<main class="cl-lesson-shell" data-cl-content data-cl-ui="2">${body}</main>`;
const quiz = `<form class="cl-quiz cl-card-box" data-quiz-id="check"><ol class="cl-questions"><li class="cl-q" data-question-id="q" data-type="short"><p class="cl-q-prompt">Explain the cause.</p><textarea class="cl-input"></textarea></li></ol></form>`;
const read = (name: string) =>
  fs.readFileSync(new URL(`../assets/templates/${name}.html`, import.meta.url), "utf8");
it.each(["lesson", "assessment", "review", "reference"])("marks the %s shell as v2", (name) => {
  expect(() => validateLessonMarkup(read(name), true)).not.toThrow();
});
it("keeps all canonical question and local teaching hooks in v2", () => {
  expect(() =>
    validateLessonMarkup(root(["quiz", "practice", "stepper", "faded"].map(read).join("")), true),
  ).not.toThrow();
});
it.each([
  ['data-cl-ui="2"', 'data-cl-ui="3"', /Unsupported/],
  ['data-cl-ui="2"', "", /New lessons need/],
  ["data-cl-content", "", /Contract v2 needs/],
  ["cl-lesson-shell", "other", /Contract v2 needs/],
  ["cl-card-box", "", /forms need cl-card-box/],
  ['class="cl-questions"', "", /direct ol.cl-questions/],
  ['class="cl-q"', "", /list items need cl-q/],
  ["cl-q-prompt", "other", /needs .cl-q-prompt/],
  ["cl-input", "other", /textarea controls need cl-input/],
] as const)("rejects a missing or unsupported promise: %s", (from, to, error) => {
  expect(() => validateLessonMarkup(root(quiz).replace(from, to), true)).toThrow(error);
});
it("checks inert gates and ignores marker text inside comments and scripts", () => {
  expect(() =>
    validateLessonMarkup(
      root(`<template data-cl-after-pretest="before">${quiz.replace("cl-input", "")}</template>`),
    ),
  ).toThrow(/cl-input/);
  expect(() =>
    validateLessonMarkup(
      `<!-- ${root(quiz)} --><script>${JSON.stringify(root(quiz))}</script>`,
      true,
    ),
  ).toThrow(/New lessons need/);
});
it("refuses duplicate roots and assessments outside the promised root", () => {
  expect(() => validateLessonMarkup(root(quiz) + root(""))).toThrow(/exactly one/);
  expect(() => validateLessonMarkup(root("") + quiz)).toThrow(/inside the v2 lesson root/);
  expect(() => validateLessonMarkup(`<div data-cl-content></div>${root(quiz)}`)).toThrow(
    /exactly one data-cl-content/,
  );
});
it("reads unmarked saved lessons without declaring or rewriting them as v2", () => {
  const legacy = '<main data-cl-content><form class="cl-quiz"><textarea></textarea></form></main>';
  expect(() => validateLessonMarkup(legacy)).not.toThrow();
  expect(() => validateLessonMarkup(legacy, true)).toThrow(/New lessons need/);
});

it("leaves distinct local controls outside the shared text-field contract", () => {
  expect(() =>
    validateLessonMarkup(
      root('<label>Speed<input type="range"></label><input type="hidden">'),
      true,
    ),
  ).not.toThrow();
  expect(() => validateLessonMarkup(root('<input type="text">'), true)).toThrow(/cl-input/);
});
