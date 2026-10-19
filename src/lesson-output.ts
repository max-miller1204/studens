/** Provider lesson data is typed; code alone serializes both private files and the durable call. */
import { validateCriteria } from "./criteria.ts";
import type { TeacherPlan } from "./teacher.ts";
import { MENTAL_TASKS } from "./teaching-plan.ts";
import { isContractId } from "../assets/runtime/quiz.mjs";
const text = { type: "string", minLength: 1, pattern: "\\S" };
const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });
const object = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
const array = (items: Record<string, unknown>, minItems = 0, maxItems?: number) => ({
  type: "array",
  items,
  minItems,
  ...(maxItems === undefined ? {} : { maxItems }),
});
const strings = array(text, 1);
const expectedSchema = {
  anyOf: [
    object({ kind: { type: "string", enum: ["text"] }, value: text }),
    object({ kind: { type: "string", enum: ["list"] }, values: strings }),
    object({
      kind: { type: "string", enum: ["numeric"] },
      value: { type: "number" },
      tolerance: nullable({ type: "number", minimum: 0 }),
      unit: nullable(text),
    }),
    object({
      kind: { type: "string", enum: ["map"] },
      entries: array(object({ key: text, value: { anyOf: [text, strings] } }), 1),
    }),
  ],
};
const criterionSchema = object({
  id: text,
  description: text,
  points: { type: "number", exclusiveMinimum: 0 },
});
const rubricSchema = object({
  criteria: array(criterionSchema, 1),
  expected: expectedSchema,
  points: { type: "number", exclusiveMinimum: 0 },
  full: text,
  partial: text,
  grading: nullable({ type: "string", enum: ["teacher", "exact"] }),
});
const task = { type: "string", enum: [...MENTAL_TASKS] };
const variantSchema = object({
  quiz: text,
  question: text,
  id: text,
  html: text,
  rubric: rubricSchema,
  task,
});
const questionSchema = object({
  id: text,
  rubric: rubricSchema,
  objective: text,
  task,
  support: { type: "string", enum: ["independent", "assisted"] },
  teaching: nullable(text),
});
export const LESSON_OUTPUT_SCHEMA = object({
  title: text,
  summary: text,
  lesson_html: text,
  message: text,
  objectives: array(
    object({
      id: text,
      statement: text,
      application: { type: "boolean" },
      retentionDays: nullable({ type: "number", minimum: 1 }),
      interleaveGroup: nullable(text),
      strategy: nullable(text),
    }),
    1,
  ),
  quizzes: array(
    object({
      id: text,
      purpose: {
        type: "string",
        enum: ["prequestion", "prerequisite", "prior-retrieval", "assessment"],
      },
      questions: array(questionSchema, 1),
    }),
    1,
  ),
  variants: array(variantSchema),
});
function shape(value: unknown, keys: string[], label: string): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw new Error(`${label} has missing or extra fields.`);
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label} must be a nonblank string.`);
  return value;
}
function number(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`${label} must be finite.`);
  return value;
}
function optionalString(value: unknown, label: string): string | undefined {
  return value === null ? undefined : string(value, label);
}
function choice(value: unknown, values: readonly string[], label: string): string {
  const found = string(value, label);
  if (!values.includes(found)) throw new Error(`${label} is invalid.`);
  return found;
}
function rows(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}
function pairs(value: unknown, label: string, decode: (row: Record<string, unknown>) => unknown) {
  const used = new Set<string>();
  return Object.fromEntries(
    rows(value, label).map((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw))
        throw new Error(`${label} needs object rows.`);
      const row = raw as Record<string, unknown>,
        id = row.id;
      if (!isContractId(id) || used.has(id))
        throw new Error(`${label} has an invalid or duplicate id.`);
      used.add(id);
      return [id, decode(row)];
    }),
  );
}
function expected(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected answer must be typed data.");
  const tag = (value as Record<string, unknown>).kind;
  if (tag === "text") {
    const row = shape(value, ["kind", "value"], "Text key");
    return string(row.value, "Expected text");
  }
  if (tag === "list") {
    const row = shape(value, ["kind", "values"], "List key");
    const values = rows(row.values, "Expected list").map((v) => string(v, "Expected list value"));
    if (!values.length) throw new Error("Expected list is empty.");
    return values;
  }
  if (tag === "numeric") {
    const row = shape(value, ["kind", "value", "tolerance", "unit"], "Numeric key"),
      unit = optionalString(row.unit, "Expected unit");
    return {
      value: number(row.value, "Expected number"),
      ...(row.tolerance === null ? {} : { tolerance: number(row.tolerance, "Expected tolerance") }),
      ...(unit === undefined ? {} : { unit }),
    };
  }
  if (tag === "map") {
    const row = shape(value, ["kind", "entries"], "Mapping key"),
      seen = new Set<string>();
    const entries = rows(row.entries, "Expected mapping");
    if (!entries.length) throw new Error("Expected mapping is empty.");
    return Object.fromEntries(
      entries.map((entry) => {
        const item = shape(entry, ["key", "value"], "Expected mapping entry"),
          key = string(item.key, "Expected mapping key");
        if (!isContractId(key) || seen.has(key))
          throw new Error("Expected mapping has invalid or duplicate keys.");
        seen.add(key);
        const v = Array.isArray(item.value)
          ? item.value.map((x) => string(x, "Expected alternative"))
          : string(item.value, "Expected value");
        if (Array.isArray(v) && !v.length) throw new Error("Expected alternatives are empty.");
        return [key, v];
      }),
    );
  }
  throw new Error("Expected answer has an unknown representation.");
}
function rubric(value: unknown) {
  const row = shape(
      value,
      ["expected", "points", "full", "partial", "grading", "criteria"],
      "Rubric",
    ),
    grading =
      row.grading === null ? undefined : choice(row.grading, ["teacher", "exact"], "Grading mode");
  const points = number(row.points, "Rubric points");
  const criteria = rows(row.criteria, "Criteria").map((raw) => {
    const c = shape(raw, ["id", "description", "points"], "Criterion");
    return {
      id: string(c.id, "Criterion id"),
      description: string(c.description, "Criterion description"),
      points: number(c.points, "Criterion points"),
    };
  });
  validateCriteria(criteria, points, "Lesson rubric");
  return {
    criteria,
    expected: expected(row.expected),
    points,
    full: string(row.full, "Full credit"),
    partial: string(row.partial, "Partial credit"),
    ...(grading === undefined ? {} : { grading }),
  };
}
export function lessonModelPlan(value: unknown): TeacherPlan {
  const output = shape(
    value,
    ["title", "summary", "lesson_html", "message", "objectives", "quizzes", "variants"],
    "Lesson response",
  );
  const objectives = pairs(output.objectives, "Objectives", (raw) => {
    const row = shape(
      raw,
      ["id", "statement", "application", "retentionDays", "interleaveGroup", "strategy"],
      "Objective",
    );
    if (typeof row.application !== "boolean")
      throw new Error("Objective application must be boolean.");
    const group = optionalString(row.interleaveGroup, "Interleave group"),
      strategy = optionalString(row.strategy, "Strategy");
    return {
      statement: string(row.statement, "Objective statement"),
      application: row.application,
      ...(row.retentionDays === null
        ? {}
        : { retentionDays: number(row.retentionDays, "Retention days") }),
      ...(group === undefined ? {} : { interleaveGroup: group }),
      ...(strategy === undefined ? {} : { strategy }),
    };
  });
  const variantInputs = rows(output.variants, "Variants").map((raw) =>
    shape(raw, ["quiz", "question", "id", "html", "rubric", "task"], "Variant"),
  );
  const usedVariants = new Set<Record<string, unknown>>();
  const keys: Record<string, unknown> = {};
  const quizzes = pairs(output.quizzes, "Quizzes", (raw) => {
    const quiz = shape(raw, ["id", "purpose", "questions"], "Quiz"),
      key: Record<string, unknown> = {};
    const questions = pairs(quiz.questions, "Questions", (question) => {
      const row = shape(
        question,
        ["id", "rubric", "objective", "task", "support", "teaching"],
        "Question",
      );
      const variantRows = variantInputs.filter((v) => v.quiz === quiz.id && v.question === row.id);
      for (const v of variantRows) usedVariants.add(v);
      if (variantRows.length > 3) throw new Error("At most three private variants are permitted.");
      const variants = pairs(variantRows, "Variants", (variant) => {
        const v = shape(variant, ["quiz", "question", "id", "html", "rubric", "task"], "Variant");
        return {
          task: choice(v.task, MENTAL_TASKS, "Variant task"),
          objective: "original",
          support: "independent",
        };
      });
      const pool = variantRows.map((rawVariant) => {
        const v = rawVariant as Record<string, unknown>;
        return { id: v.id, html: string(v.html, "Variant HTML"), rubric: rubric(v.rubric) };
      });
      Object.defineProperty(key, row.id as string, {
        value: { ...rubric(row.rubric), ...(pool.length ? { variants: pool } : {}) },
        enumerable: true,
      });
      const teaching = optionalString(row.teaching, "Teaching target");
      return {
        objective: string(row.objective, "Question objective"),
        task: choice(row.task, MENTAL_TASKS, "Question task"),
        support: choice(row.support, ["independent", "assisted"], "Question support"),
        ...(teaching === undefined ? {} : { teaching }),
        ...(pool.length ? { variants } : {}),
      };
    });
    Object.defineProperty(keys, quiz.id as string, { value: key, enumerable: true });
    return {
      purpose: choice(
        quiz.purpose,
        ["prequestion", "prerequisite", "prior-retrieval", "assessment"],
        "Quiz purpose",
      ),
      questions,
    };
  });
  if (usedVariants.size !== variantInputs.length)
    throw new Error("Private variant names an unknown quiz or question.");
  const document = {
    title: string(output.title, "Title"),
    summary: string(output.summary, "Summary"),
    lesson_html: string(output.lesson_html, "Lesson HTML"),
    rubric_json: JSON.stringify(keys),
    teaching_plan_json: JSON.stringify({ version: 1, objectives, quizzes }),
  };
  return {
    calls: [{ name: "publish_lesson", arguments_json: JSON.stringify(document) }],
    message: string(output.message, "Ready message"),
    learning_record: "",
    notes_markdown: "",
  };
}
