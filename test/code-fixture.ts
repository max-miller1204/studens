/** Public exercise fixture shared by contract and real browser/host drives. */
import type { CodeExercise } from "../assets/runtime/code.mjs";

export const exercise: CodeExercise = {
  version: 1,
  language: "javascript",
  entry: "sum",
  tests: [
    { id: "empty", args: [[]], expected: 0 },
    { id: "mixed", args: [[2, -1, 4]], expected: 5 },
    { id: "negative", args: [[-3, -2]], expected: -5 },
  ],
};
export const source =
  "function sum(values) {\n  return values.reduce((total, value) => total + value, 0);\n}";
export const starter = "function sum(values) {\n  // Write your implementation here.\n}";
export const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
export const codeQuestion = (initial = starter, contract: unknown = exercise, id = "sum") =>
  `<li class="cl-q" data-question-id="${id}" data-type="code" data-code="${escapeHtml(JSON.stringify(contract))}"><p class="cl-q-prompt">Implement sum(values). Return the sum, including zero for an empty array.</p><label>JavaScript source<textarea class="cl-code-source" rows="8" spellcheck="false">${escapeHtml(initial)}</textarea></label></li>`;
export const codeForm = (initial = starter, contract: unknown = exercise) =>
  `<form class="cl-quiz" data-quiz-id="check" data-title="Write the function"><ol class="cl-questions">${codeQuestion(initial, contract)}</ol></form>`;
export const codeRubric = {
  expected:
    "An implementation returning the arithmetic sum of every finite input, with zero for an empty array. Equivalent loop or reduce implementations accepted.",
  points: 2,
  full: "Accumulates every value and handles the empty array.",
  partial: "One point for accumulating every value; one for the zero identity on an empty array.",
  criteria: [
    { id: "accumulate", description: "Accumulate every input value", points: 1 },
    { id: "empty", description: "Return zero for an empty array", points: 1 },
  ],
};
