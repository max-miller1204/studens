/** Public practice keys. These never read a graded rubric or create learning evidence. */
import { gradeClosed, machineGraded } from "./closed.mjs";

const sameIds = (actual, expected) =>
  actual.length === expected.length && actual.every((id) => expected.includes(id));

export function practiceEntry(type, entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry))
    throw new Error("needs a public practice key.");
  if (Object.keys(entry).some((key) => !["expected", "correct", "incorrect"].includes(key)))
    throw new Error("practice keys use only expected, correct, and incorrect.");
  for (const name of ["correct", "incorrect"]) {
    if (typeof entry[name] !== "string" || !entry[name].trim())
      throw new Error(`needs ${name} feedback explaining the practice answer.`);
  }
  const rubric = {
    expected: entry.expected,
    grading: "exact",
    points: 1,
    full: entry.correct,
    partial: entry.incorrect,
  };
  if (!machineGraded(type, rubric)) throw new Error("needs an exact practice answer.");
  return rubric;
}

/** Validate feedback and ensure key ids refer to the actual controls. */
export function practiceErrors(shapes, key) {
  if (!key || typeof key !== "object" || Array.isArray(key))
    return ["Practice needs a JSON object keyed by question id."];
  const errors = [];
  if (
    !sameIds(
      Object.keys(key),
      shapes.map((shape) => shape.id),
    )
  )
    errors.push("Practice key must contain exactly the practice question ids.");
  for (const shape of shapes) {
    try {
      practiceEntry(shape.type, key[shape.id]);
      const expected = key[shape.id].expected;
      const subset = (ids, allowed) => ids.every((id) => allowed.includes(id));
      let valid = true;
      switch (shape.type) {
        case "choice":
          valid = shape.options.includes(expected);
          break;
        case "multi":
          valid = subset(expected, shape.options);
          break;
        case "numeric": {
          const unit = (expected.unit ?? "").trim();
          if (unit && shape.units !== 1)
            throw new Error(`numeric practice requires one .cl-unit control for "${unit}".`);
          if (shape.units > 0 && shape.unitValues !== null && !shape.unitValues?.includes(unit))
            throw new Error(
              `numeric .cl-unit control cannot supply ${unit ? `"${unit}"` : "an empty unit"}.`,
            );
          break;
        }
        case "order":
          valid = sameIds(expected, shape.orderItems);
          break;
        case "match":
          valid =
            sameIds(Object.keys(expected), shape.matchLeft) &&
            subset(Object.values(expected), shape.matchRight);
          break;
        case "cloze":
          valid = sameIds(Object.keys(expected), shape.blanks);
          break;
        case "locate":
          valid =
            subset(expected, shape.segments) && (shape.select === "many" || expected.length === 1);
          break;
      }
      if (!valid) throw new Error("practice key does not match its controls.");
    } catch (error) {
      errors.push(`Practice question ${shape.id}: ${error.message}`);
    }
  }
  return errors;
}

export function practiceFeedback(answer, entry) {
  const result = gradeClosed(answer, practiceEntry(answer.type, entry));
  return {
    correct: result.correct,
    feedback: result.correct ? entry.correct : entry.incorrect,
  };
}
