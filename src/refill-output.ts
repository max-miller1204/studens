/** Fresh refill data is typed and request-bound; saved publication plans stay canonical. */
import type { TeacherPlan } from "./teacher.ts";
import { MODEL_RUBRIC_SCHEMA, MODEL_TASK_SCHEMA, modelRubric } from "./lesson-output.ts";
import { isContractId } from "../assets/runtime/quiz.mjs";
import { MENTAL_TASKS } from "./teaching-plan.ts";

export interface RefillOutputTarget {
  classroom: string;
  requestId: string;
  count: 1 | 2;
}
const text = { type: "string", minLength: 1, pattern: "\\S" };
const object = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
function requireTarget(
  target: RefillOutputTarget | undefined,
): asserts target is RefillOutputTarget {
  if (!target?.classroom?.trim() || !target.requestId?.trim() || ![1, 2].includes(target.count))
    throw new Error(
      "A refill response requires the saved classroom, request id and variant count.",
    );
}
export function refillOutputSchema(target: RefillOutputTarget | undefined) {
  requireTarget(target);
  return object({
    classroom: { ...text, enum: [target.classroom] },
    request_id: { ...text, enum: [target.requestId] },
    variants: {
      type: "array",
      minItems: target.count,
      maxItems: target.count,
      items: object({ id: text, html: text, rubric: MODEL_RUBRIC_SCHEMA, task: MODEL_TASK_SCHEMA }),
    },
  });
}
export function isRefillOutputSchema(schema: Record<string, unknown>): boolean {
  const p = schema.properties as Record<string, unknown> | undefined;
  return !!p && ["classroom", "request_id", "variants"].every((key) => Object.hasOwn(p, key));
}
function shape(value: unknown, fields: string[], label: string): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== fields.length ||
    fields.some((key) => !Object.hasOwn(value, key))
  )
    throw new Error(`${label} has missing or extra fields.`);
  return value as Record<string, unknown>;
}
export function refillOutputPlan(
  value: unknown,
  target: RefillOutputTarget | undefined,
): TeacherPlan {
  requireTarget(target);
  const row = shape(value, ["classroom", "request_id", "variants"], "Refill response");
  if (row.classroom !== target.classroom || row.request_id !== target.requestId)
    throw new Error("Refill response must use its exact saved classroom and request id.");
  if (!Array.isArray(row.variants) || row.variants.length !== target.count)
    throw new Error(`Refill response requires exactly ${target.count} variants.`);
  const ids = new Set<string>();
  const variants = row.variants.map((raw) => {
    const v = shape(raw, ["id", "html", "rubric", "task"], "Refill variant");
    if (!isContractId(v.id) || ids.has(v.id))
      throw new Error("Refill variant ids must be valid and unique.");
    ids.add(v.id);
    if (typeof v.html !== "string" || !v.html.trim())
      throw new Error("Refill variant HTML is required.");
    if (!MENTAL_TASKS.includes(v.task as (typeof MENTAL_TASKS)[number]))
      throw new Error("Refill variant task is invalid.");
    return {
      id: v.id,
      html: v.html,
      rubric: modelRubric(v.rubric),
      plan: { objective: "original", support: "independent", task: v.task },
    };
  });
  // Existing validateRefill still checks HTML, controls, private keys, the source
  // objective and pool ids before saveRefillPlan and the idempotent atomic write.
  return {
    calls: [
      {
        name: "save_review_variants",
        arguments_json: JSON.stringify({
          classroom: target.classroom,
          request_id: target.requestId,
          variants,
        }),
      },
    ],
    message: "",
    learning_record: "",
    notes_markdown: "",
  };
}
