/** Machine-checkable private keys. No storage, host, or browser dependencies. */
import { isContractId, parseNumber } from "../assets/runtime/quiz.mjs";
import type { QuestionType, QuizAnswer } from "./quiz.ts";
import type { RubricQuestion } from "./rubric.ts";
import type { QuizQuestionGrade } from "./store.ts";

type Key = string | string[] | Record<string, string | string[]>;
interface NumericKey {
  value: number;
  tolerance?: number;
  unit?: string;
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const words = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const ids = (value: unknown): value is string[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(isContractId) &&
  new Set(value).size === value.length;
const alternatives = (value: unknown): value is string | string[] =>
  words(value) || (Array.isArray(value) && value.length > 0 && value.every(words));

/** Legacy assessments do not call this validator. Judgment must be explicit for cloze. */
export function machineGraded(type: QuestionType, entry: RubricQuestion): boolean {
  if (entry.grading !== undefined && entry.grading !== "exact" && entry.grading !== "teacher")
    throw new Error("grading must be exact or teacher.");
  if (type === "short") {
    if (entry.grading === "exact") throw new Error("short answers require teacher judgment.");
    return false;
  }
  const closed = ["choice", "multi", "numeric", "order", "match"].includes(type);
  if (entry.grading === "teacher") {
    if (closed) throw new Error(`${type} requires a machine-checkable expected answer.`);
    return false;
  }
  if (!closed && type !== "cloze" && entry.grading !== "exact") return false;
  const key = entry.expected;
  let valid = false;
  switch (type) {
    case "choice":
      valid = isContractId(key);
      break;
    case "multi":
    case "locate":
      valid = ids(key);
      break;
    case "order":
      valid = ids(key) && key.length >= 2;
      break;
    case "numeric":
      valid =
        object(key) &&
        Number.isFinite(key.value) &&
        (key.tolerance === undefined ||
          (typeof key.tolerance === "number" &&
            Number.isFinite(key.tolerance) &&
            key.tolerance >= 0)) &&
        (key.unit === undefined || words(key.unit));
      break;
    case "term":
      valid = alternatives(key);
      break;
    case "match":
    case "cloze":
      valid =
        object(key) &&
        Object.keys(key).length > 0 &&
        Object.entries(key).every(
          ([id, value]) =>
            isContractId(id) && (type === "match" ? isContractId(value) : alternatives(value)),
        );
      break;
  }
  if (!valid) throw new Error(`Invalid machine-checkable expected answer for ${type}.`);
  return true;
}

const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
const accepts = (key: string | string[], value: string) =>
  (Array.isArray(key) ? key : [key]).some((expected) => normalize(expected) === normalize(value));
const sameSet = (expected: string[], actual: string[]) =>
  expected.length === actual.length &&
  new Set(actual).size === actual.length &&
  actual.every((id) => expected.includes(id));

function withinTolerance(value: number, expected: NumericKey): boolean {
  const difference = Math.abs(value - expected.value);
  const tolerance = expected.tolerance ?? 0;
  // Decimal boundaries such as 1.1 - 1 exceed 0.1 by a floating point rounding error.
  // A zero tolerance remains exact; subtracting the tolerance avoids overflowing it.
  return (
    difference <= tolerance ||
    (tolerance > 0 &&
      difference - tolerance <=
        Number.EPSILON * Math.max(Math.abs(value), Math.abs(expected.value), tolerance))
  );
}

/** Exact questions award all or zero of the authored points. Never trust display labels. */
export function gradeClosed(answer: QuizAnswer, entry: RubricQuestion): QuizQuestionGrade | null {
  if (!answer.type || !machineGraded(answer.type, entry)) return null;
  const key = entry.expected as Key;
  let correct = false;
  switch (answer.type) {
    case "choice":
      correct = answer.value === key;
      break;
    case "term":
      correct = accepts(key as string | string[], answer.value ?? "");
      break;
    case "numeric": {
      const expected = entry.expected as NumericKey;
      const value = parseNumber(answer.value ?? "");
      correct =
        value !== null &&
        withinTolerance(value, expected) &&
        (answer.unit ?? "").trim() === (expected.unit ?? "").trim();
      break;
    }
    case "multi":
    case "locate":
      correct = sameSet(
        key as string[],
        (answer.parts ?? []).map((p) => p.id),
      );
      break;
    case "order": {
      const actual = (answer.parts ?? []).map((p) => p.id);
      correct =
        actual.length === (key as string[]).length &&
        actual.every((id, i) => id === (key as string[])[i]);
      break;
    }
    case "match": {
      const expected = key as Record<string, string>;
      const actual = answer.pairs ?? [];
      correct =
        sameSet(
          Object.keys(expected),
          actual.map((p) => p.left),
        ) && actual.every((p) => expected[p.left] === p.right);
      break;
    }
    case "cloze": {
      const expected = key as Record<string, string | string[]>;
      const actual = answer.parts ?? [];
      correct =
        sameSet(
          Object.keys(expected),
          actual.map((p) => p.id),
        ) && actual.every((p) => accepts(expected[p.id], p.value));
      break;
    }
  }
  return {
    ...(entry.criteria
      ? {
          criteria: entry.criteria.map((c) => ({
            criterionId: c.id,
            description: c.description,
            pointsPossible: c.points,
            pointsEarned: correct ? c.points : 0,
            feedback: correct
              ? entry.full
              : "The answer does not match the private key. Review this question.",
          })),
        }
      : {}),
    questionId: answer.questionId,
    correct,
    pointsEarned: correct ? entry.points : 0,
    pointsPossible: entry.points,
    feedback: correct
      ? entry.full
      : "The answer does not match the private key. Review this question.",
  };
}

/** Teacher allocations cannot replace a saved machine allocation, even on a regrade. */
export function mergeGrades(
  fixed: QuizQuestionGrade[],
  teacher: QuizQuestionGrade[],
): QuizQuestionGrade[] {
  if (teacher.some((q) => fixed.some((saved) => saved.questionId === q.questionId)))
    throw new Error("Teacher grades must omit machine-graded questions.");
  return [...fixed, ...teacher];
}
