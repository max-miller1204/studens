/** Provider lesson output is data; code serializes the canonical durable plan. */
import type { TeacherPlan } from "./teacher.ts";
const fields = [
  "title",
  "summary",
  "lesson_html",
  "rubric_json",
  "teaching_plan_json",
  "message",
] as const;
export const LESSON_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: Object.fromEntries(
    fields.map((field) => [field, { type: "string", minLength: 1, pattern: "\\S" }]),
  ),
  required: [...fields],
};
export function lessonModelPlan(value: unknown): TeacherPlan {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Teacher returned no lesson document.");
  const output = value as Record<string, unknown>;
  if (
    Object.keys(output).length !== fields.length ||
    fields.some((field) => typeof output[field] !== "string" || !(output[field] as string).trim())
  )
    throw new Error(
      "Lesson output requires title, summary, lesson_html, rubric_json, teaching_plan_json, and message only.",
    );
  const { message, ...document } = output;
  return {
    calls: [{ name: "publish_lesson", arguments_json: JSON.stringify(document) }],
    message: message as string,
    learning_record: "",
    notes_markdown: "",
  };
}
