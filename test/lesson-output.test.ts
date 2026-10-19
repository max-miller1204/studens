import { expect, it } from "vitest";
import { lessonModelPlan, LESSON_OUTPUT_SCHEMA } from "../src/lesson-output.ts";
import { planSchema } from "../src/teacher.ts";
const document = {
  title: "Lesson",
  summary: "Summary",
  lesson_html: '<main>"quoted"\n\\backslash\ttext</main>',
  rubric_json: '{"pretest-1":{"p1":{"points":1}}}',
  teaching_plan_json: '{"version":1}',
  message: "Ready",
};
it("serializes provider HTML by code into the canonical durable plan without repairing content", () => {
  const plan = lessonModelPlan(document);
  expect(plan.calls).toHaveLength(1);
  expect(plan.calls[0].name).toBe("publish_lesson");
  const { message, ...fields } = document;
  expect(JSON.parse(plan.calls[0].arguments_json)).toEqual(fields);
  expect(plan).toMatchObject({ message, learning_record: "", notes_markdown: "" });
});
it("uses dedicated supported fields only for explicit lesson requests", () => {
  expect(planSchema({ operations: ["publish_lesson"], research: true })).toEqual(
    LESSON_OUTPUT_SCHEMA,
  );
  expect(planSchema({ operations: ["answer_lesson_question"] })).toHaveProperty("properties.calls");
  expect(LESSON_OUTPUT_SCHEMA.additionalProperties).toBe(false);
  expect(LESSON_OUTPUT_SCHEMA.required).toHaveLength(6);
});
it.each([
  null,
  { ...document, message: "" },
  { ...document, lesson_html: 5 },
  { ...document, calls: [] },
  {
    calls: [{ name: "publish_lesson", arguments_json: "malformed" }],
    message: "Ready",
    learning_record: null,
    notes_markdown: "",
  },
])("rejects missing, extra, and legacy model-authored call fields", (input) => {
  expect(() => lessonModelPlan(input)).toThrow();
});
it("does not repair private JSON; the existing publication validator must reject it", () => {
  const invalid = { ...document, rubric_json: '{"pretest-1":\n bad JSON' };
  expect(JSON.parse(lessonModelPlan(invalid).calls[0].arguments_json).rubric_json).toBe(
    invalid.rubric_json,
  );
});
