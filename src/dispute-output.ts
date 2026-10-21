/** Request-bound dispute data; code alone serializes the durable resolution call. */
import type { TeacherPlan } from "./teacher.ts";

export interface DisputeOutputTarget {
  id: string;
  questionId: string;
  machine: boolean;
}
const text = { type: "string", minLength: 1, pattern: "\\S" };
const object = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
function requireTarget(
  target: DisputeOutputTarget | undefined,
): asserts target is DisputeOutputTarget {
  if (!target?.id?.trim() || !target.questionId?.trim() || typeof target.machine !== "boolean")
    throw new Error("A dispute response schema requires its saved dispute and question target.");
}
export function disputeOutputSchema(target: DisputeOutputTarget | undefined) {
  requireTarget(target);
  const question = object({
    question_id: { ...text, enum: [target.questionId] },
    points_earned: { type: "number", minimum: 0 },
    points_possible: { type: "number", exclusiveMinimum: 0 },
    correct: { type: "boolean" },
    feedback: text,
    criteria: {
      type: "array",
      items: object({
        criterion_id: text,
        points_earned: { type: "number", minimum: 0 },
        feedback: text,
      }),
    },
  });
  return object({
    dispute_id: { ...text, enum: [target.id] },
    decision: {
      type: "string",
      enum: target.machine
        ? ["declined", "authoring-defect"]
        : ["accepted", "declined", "authoring-defect"],
    },
    question: target.machine ? { type: "null" } : { anyOf: [question, { type: "null" }] },
    message: text,
  });
}
export function disputeOutputPlan(
  value: unknown,
  target: DisputeOutputTarget | undefined,
): TeacherPlan {
  requireTarget(target);
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 4 ||
    !["dispute_id", "decision", "question", "message"].every((key) => Object.hasOwn(value, key))
  )
    throw new Error(
      "Dispute response must contain only dispute_id, decision, question and message.",
    );
  const row = value as Record<string, unknown>;
  if (row.dispute_id !== target.id)
    throw new Error(
      "Dispute response must use the exact saved dispute id, without a request prefix.",
    );
  if (
    !["accepted", "declined", "authoring-defect"].includes(row.decision as string) ||
    typeof row.message !== "string" ||
    !row.message.trim()
  )
    throw new Error("Dispute response needs a decision and a nonblank message.");
  if (row.decision === "accepted") {
    if (target.machine) throw new Error("A machine-graded dispute cannot change points.");
    if (
      !row.question ||
      typeof row.question !== "object" ||
      Array.isArray(row.question) ||
      (row.question as Record<string, unknown>).question_id !== target.questionId
    )
      throw new Error("Revise only the exact disputed question.");
  } else if (row.question !== null) {
    throw new Error("A declined or flagged dispute must have question: null.");
  }
  // resolveDispute still validates the complete original rubric, allocation,
  // machine protection and stale-grade boundary before any grade can be written.
  return {
    calls: [
      {
        name: "resolve_grade_dispute",
        arguments_json: JSON.stringify({
          dispute_id: row.dispute_id,
          decision: row.decision,
          ...(row.question === null ? {} : { question: row.question }),
        }),
      },
    ],
    message: row.message,
    learning_record: "",
    notes_markdown: "",
  };
}
