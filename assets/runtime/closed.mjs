/** Exact answer comparison shared by private assessments and public local practice. */
import { isContractId, parseNumber } from "./quiz.mjs";
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const words = (value) => typeof value === "string" && value.trim().length > 0;
const ids = (value) =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(isContractId) &&
  new Set(value).size === value.length;
const alternatives = (value) =>
  words(value) || (Array.isArray(value) && value.length > 0 && value.every(words));
/** Legacy assessments do not call this validator. Judgment must be explicit for cloze. */
export function machineGraded(type, entry) {
  if (entry.grading !== undefined && entry.grading !== "exact" && entry.grading !== "teacher")
    throw new Error("grading must be exact or teacher.");
  if (type === "short" || type === "code") {
    if (entry.grading === "exact") throw new Error(`${type} answers require teacher judgment.`);
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
const normalize = (value) => value.trim().replace(/\s+/g, " ").toLowerCase();
const accepts = (key, value) =>
  (Array.isArray(key) ? key : [key]).some((expected) => normalize(expected) === normalize(value));
const sameSet = (expected, actual) =>
  expected.length === actual.length &&
  new Set(actual).size === actual.length &&
  actual.every((id) => expected.includes(id));
function withinTolerance(value, expected) {
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
export function gradeClosed(answer, entry) {
  if (!answer.type || !machineGraded(answer.type, entry)) return null;
  const key = entry.expected;
  let correct = false;
  switch (answer.type) {
    case "choice":
      correct = answer.value === key;
      break;
    case "term":
      correct = accepts(key, answer.value ?? "");
      break;
    case "numeric": {
      const expected = entry.expected;
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
        key,
        (answer.parts ?? []).map((p) => p.id),
      );
      break;
    case "order": {
      const actual = (answer.parts ?? []).map((p) => p.id);
      correct = actual.length === key.length && actual.every((id, i) => id === key[i]);
      break;
    }
    case "match": {
      const expected = key;
      const actual = answer.pairs ?? [];
      correct =
        sameSet(
          Object.keys(expected),
          actual.map((p) => p.left),
        ) && actual.every((p) => expected[p.left] === p.right);
      break;
    }
    case "cloze": {
      const expected = key;
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
