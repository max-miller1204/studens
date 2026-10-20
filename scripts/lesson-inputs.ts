/** Read-only authoring preflight. Private input bytes never enter the HTTP preview. */
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { classroomsRoot, isValidSlug, lessonDir, privateStatePath } from "../src/paths.ts";
import { resolveLessonHtml } from "../src/store/classrooms.ts";
import type { LessonMeta } from "../src/store/classrooms.ts";
import { validateLessonContractVersions } from "../src/lesson-contracts.ts";
import { authoredQuizzes } from "../src/quiz-authoring.ts";
import { parseRubric } from "../src/rubric.ts";
import { parseTeachingPlan } from "../src/teaching-plan.ts";
import { authoredVariants } from "../src/review-variants.ts";
import { validateCodeQuestions } from "../src/code-questions.ts";

export const inputNames = [
  "lesson.html",
  "lesson.json",
  "quiz/key.json",
  "quiz/plan.json",
] as const;
export type LessonInputHashes = Record<(typeof inputNames)[number], string | null>;
interface Input {
  bytes: Buffer;
  text: string;
}
export interface LessonInputs {
  htmlFile: string;
  html: Input;
  metadata: Input | null;
  key: Input | null;
  plan: Input | null;
  hashes: LessonInputHashes;
}

export function readLessonInputs(classroom: string, lesson: string): LessonInputs {
  if (!isValidSlug(classroom) || !isValidSlug(lesson)) throw new Error("Invalid lesson identity.");
  const dir = privateStatePath(path.relative(classroomsRoot(), lessonDir(classroom, lesson)));
  const htmlFile = resolveLessonHtml(dir);
  if (!htmlFile) throw new Error("The lesson does not exist.");
  function read(name: string): Input | null {
    const file = privateStatePath(path.relative(classroomsRoot(), path.join(dir, name)));
    try {
      if (!fs.statSync(file).isFile()) throw new Error(`Expected a regular file: ${name}.`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    const bytes = fs.readFileSync(file);
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw new Error(`Invalid UTF-8 in ${name}.`);
    }
    return { bytes, text };
  }
  const html = read(path.basename(htmlFile));
  if (!html) throw new Error("The lesson does not exist.");
  const metadata = read("lesson.json");
  const key = read("quiz/key.json");
  const plan = read("quiz/plan.json");
  const hash = (input: Input | null) =>
    input ? createHash("sha256").update(input.bytes).digest("hex") : null;
  return {
    htmlFile: path.basename(htmlFile),
    html,
    metadata,
    key,
    plan,
    hashes: {
      "lesson.html": hash(html),
      "lesson.json": hash(metadata),
      "quiz/key.json": hash(key),
      "quiz/plan.json": hash(plan),
    },
  };
}

function jsonObject(input: Input, name: string): Record<string, any> {
  let value: unknown;
  try {
    value = JSON.parse(input.text);
  } catch {
    // Native JSON errors can quote private answers. Keep the file, never its contents.
    throw new Error(`Invalid JSON in ${name}.`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Expected a JSON object in ${name}.`);
  return value as Record<string, any>;
}

export function preflightLessonInputs(
  inputs: LessonInputs,
  classroom: string,
  lesson: string,
): void {
  const meta = inputs.metadata ? jsonObject(inputs.metadata, "lesson.json") : null;
  validateLessonContractVersions(meta as LessonMeta | null, classroom, lesson);
  validateCodeQuestions(inputs.html.text, meta);
  const key = inputs.key ? jsonObject(inputs.key, "quiz/key.json") : null;
  const plan = inputs.plan ? jsonObject(inputs.plan, "quiz/plan.json") : null;
  const requiresKey =
    meta?.assessmentContract === 1 ||
    meta?.criterionContract === 1 ||
    meta?.reviewVariantContract === 1;
  const requiresPlan = meta?.instructionalContract === 1 || meta?.reviewVariantContract === 1;
  if (requiresKey && !key) throw new Error("Missing required private rubric: quiz/key.json.");
  if (requiresPlan && !plan) throw new Error("Missing required teaching plan: quiz/plan.json.");
  const html = inputs.html.text;
  if (inputs.key) {
    parseRubric(
      inputs.key.text,
      html,
      meta?.assessmentContract === 1 || meta?.reviewVariantContract === 1 ? "machine" : "legacy",
      meta?.criterionContract === 1,
    );
    const quizzes = authoredQuizzes(html);
    for (const [id, entries] of Object.entries(key!)) {
      const quiz = quizzes.find((q) => q.id === id);
      if (!quiz) throw new Error("Private rubric names an unknown quiz.");
      if (Object.keys(entries).some((id) => !quiz.questions.some((q) => q.id === id)))
        throw new Error("Private rubric names an unknown question.");
    }
  }
  if (inputs.plan) parseTeachingPlan(inputs.plan.text, html);
  const declaresVariants = (value: unknown): boolean =>
    !!value &&
    typeof value === "object" &&
    Object.entries(value).some(([name, entry]) => name === "variants" || declaresVariants(entry));
  if (meta?.reviewVariantContract === 1 || declaresVariants(key) || declaresVariants(plan)) {
    if (!inputs.key) throw new Error("Missing required private rubric: quiz/key.json.");
    if (!inputs.plan) throw new Error("Missing required teaching plan: quiz/plan.json.");
    authoredVariants(inputs.key.text, inputs.plan.text, html, meta?.reviewVariantContract === 1);
  }
}

export function sameLessonInputs(a: LessonInputs, b: LessonInputs): boolean {
  return a.htmlFile === b.htmlFile && inputNames.every((name) => a.hashes[name] === b.hashes[name]);
}
