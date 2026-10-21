/** Typed service passage output; only code encodes the durable operation arguments. */
import type { TeacherPlan } from "./teacher.ts";

const text = { type: "string", minLength: 1, pattern: "\\S" };
export const PASSAGE_ANSWER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { annotation_id: text, answer_markdown: text },
  required: ["annotation_id", "answer_markdown"],
};

/** Bind identity to the durable request rather than asking the model to reconstruct it. */
export function passageAnswerSchema(annotationId: string | undefined) {
  if (typeof annotationId !== "string" || !annotationId.trim())
    throw new Error("A passage response schema requires its annotation target.");
  return {
    ...PASSAGE_ANSWER_SCHEMA,
    properties: {
      ...PASSAGE_ANSWER_SCHEMA.properties,
      annotation_id: { ...text, enum: [annotationId] },
    },
  };
}

/** Also validate at the host boundary: provider schema enforcement is not trusted. */
export function passageAnswerPlan(value: unknown): TeacherPlan {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    !Object.hasOwn(value, "annotation_id") ||
    !Object.hasOwn(value, "answer_markdown")
  )
    throw new Error("Passage answer must contain only annotation_id and answer_markdown.");
  const args = value as Record<string, unknown>;
  for (const key of PASSAGE_ANSWER_SCHEMA.required)
    if (typeof args[key] !== "string" || !args[key].trim())
      throw new Error(`Passage answer ${key} must be a nonblank string.`);
  return {
    calls: [
      {
        name: "answer_lesson_question",
        arguments_json: JSON.stringify({
          annotation_id: args.annotation_id,
          answer_markdown: args.answer_markdown,
        }),
      },
    ],
    message: "",
    learning_record: "",
    notes_markdown: "",
  };
}
