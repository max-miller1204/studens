/** Read private pools and assemble a review without a teacher turn. */
import * as fs from "node:fs";
import * as path from "node:path";
import { classroomDir, isValidSlug, safeStaticFile, lessonDir } from "./paths.ts";
import { readLesson } from "./store/lessons.ts";
import { authoredVariants, validateVariant } from "./review-variants.ts";
import type { PreparedVariant } from "./review-variants.ts";
import type { ReviewDocument } from "./review-session.ts";
import type { ReviewItem } from "./review.ts";
import type { RubricQuestion } from "./rubric.ts";
import type { Objective, QuestionPlan } from "./teaching-plan.ts";
import { TAG_ATTRIBUTES } from "./authoring-html.ts";

/** Also used before private writes; reject every symlink component. */
export function privatePoolPath(classroom: string, lesson: string, name: string): string {
  if (
    !isValidSlug(classroom) ||
    !isValidSlug(lesson) ||
    !["key.json", "plan.json", "review-pool.json"].includes(name)
  )
    throw new Error("Invalid private variant path.");
  const root = classroomDir(classroom);
  const relative = path.relative(root, path.join(lessonDir(classroom, lesson), "quiz", name));
  let current = root;
  for (const segment of ["", ...relative.split("/")]) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink())
        throw new Error(`Private variant path cannot be a symlink: ${current}.`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return path.join(root, relative);
}

export function lessonPools(
  classroom: string,
  lesson: string,
  required = false,
): Map<string, PreparedVariant[]> {
  const key = privatePoolPath(classroom, lesson, "key.json");
  const plan = privatePoolPath(classroom, lesson, "plan.json");
  if (!fs.existsSync(key) && !fs.existsSync(plan) && !required) return new Map();
  const keyText = fs.existsSync(key) ? fs.readFileSync(key, "utf8") : "{}";
  const planText = fs.existsSync(plan) ? fs.readFileSync(plan, "utf8") : "{}";
  const declaresPool = (value: unknown): boolean =>
    !!value &&
    typeof value === "object" &&
    Object.entries(value).some(([name, entry]) => name === "variants" || declaresPool(entry));
  if (!required && !declaresPool(JSON.parse(keyText)) && !declaresPool(JSON.parse(planText)))
    return new Map();
  const html = safeStaticFile(
    classroomDir(classroom),
    path.relative(classroomDir(classroom), path.join(lessonDir(classroom, lesson), "lesson.html")),
  );
  if (!html) throw new Error(`Missing or unsafe variant source lesson: ${lesson}.`);
  const pools = authoredVariants(
    keyText,
    planText,
    fs.readFileSync(html, "utf8"),
    required,
    readLesson(classroom, lesson)?.assessmentContract === 1 ? "machine" : "legacy",
  );
  const supplement = privatePoolPath(classroom, lesson, "review-pool.json");
  if (fs.existsSync(supplement)) {
    const saved = JSON.parse(fs.readFileSync(supplement, "utf8"));
    if (!saved || saved.version !== 1 || !Array.isArray(saved.batches))
      throw new Error("Invalid private supplemental pool.");
    const requests = new Set<string>();
    for (const batch of saved.batches) {
      const pool = pools.get(batch?.key);
      if (
        !pool ||
        typeof batch.requestId !== "string" ||
        requests.has(batch.requestId) ||
        !Array.isArray(batch.variants) ||
        !batch.variants.length
      )
        throw new Error("Invalid private variant batch.");
      requests.add(batch.requestId);
      for (const variant of batch.variants) {
        const prepared = validateVariant(variant, variant?.plan, pool[0].objective);
        if (pool.some((v) => v.id === prepared.id))
          throw new Error("Duplicate private variant id.");
        pool.push(prepared);
      }
    }
  }
  return pools;
}

/** Prefer an unseen question, then the least-used variant in authored order. */
export function selectVariant(pool: PreparedVariant[], used: string[]): PreparedVariant {
  if (!pool.length) throw new Error("No prepared review variants.");
  return pool.reduce((best, candidate) =>
    used.filter((id) => id === candidate.id).length < used.filter((id) => id === best.id).length
      ? candidate
      : best,
  );
}

function questionHtml(variant: PreparedVariant, id: string, key: string): string {
  const namespace = (value: string) => `${id}-${value}`;
  return variant.html.replace(
    new RegExp(`<([a-z][\\w-]*)\\b(${TAG_ATTRIBUTES})>`, "gi"),
    (tag, _name, attributes: string) => {
      let updated = attributes.replace(
        /([\w-]+)\s*=\s*("([^"]*)"|'([^']*)')/g,
        (
          attribute,
          name: string,
          quoted: string,
          double: string | undefined,
          single: string | undefined,
        ) => {
          const value = double ?? single!;
          const lower = name.toLowerCase();
          const next =
            lower === "data-question-id"
              ? id
              : ["id", "name", "for"].includes(lower)
                ? namespace(value)
                : ["aria-labelledby", "aria-describedby", "aria-controls"].includes(lower)
                  ? value.split(/\s+/).map(namespace).join(" ")
                  : lower === "href" && value.startsWith("#")
                    ? `#${namespace(value.slice(1))}`
                    : value;
          return attribute.replace(quoted, `${quoted[0]}${next}${quoted[0]}`);
        },
      );
      if (/\bdata-question-id\s*=/i.test(attributes)) updated += ` data-review-of="${key}"`;
      return tag.replace(attributes, updated);
    },
  );
}

export function assembleReview(
  items: ReviewItem[],
  variants: PreparedVariant[],
  cards = false,
): ReviewDocument {
  const rubric: Record<string, RubricQuestion> = {};
  const objectives: Record<string, Objective> = {};
  const questions: Record<string, QuestionPlan> = {};
  const html = items
    .map((item, i) => {
      const id = `r${i + 1}`;
      const variant = variants[i];
      rubric[id] = variant.rubric;
      objectives[id] = item.objective ?? variant.objective;
      questions[id] = { ...variant.plan, objective: id };
      return questionHtml(variant, id, item.key);
    })
    .join("\n");
  const quizId = (index: number) => (index === 0 ? "review" : `review-${index + 1}`);
  const forms = cards
    ? items
        .map(
          (item, i) =>
            `<form class="cl-quiz" data-quiz-id="${quizId(i)}" data-kind="review" data-title="Question ${i + 1}" data-evidence="report" data-confidence="optional"><ol class="cl-questions">${questionHtml(variants[i], `r${i + 1}`, item.key)}</ol></form>`,
        )
        .join("\n")
    : `<form class="cl-quiz" data-quiz-id="review" data-kind="review" data-title="Review" data-evidence="report" data-confidence="optional"><ol class="cl-questions">${html}</ol></form>`;
  return {
    lesson_html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Spaced review</title></head><body><main class="cl-lesson-shell" data-cl-content><header><h1>Spaced review</h1><p class="cl-lede">Recall these ideas before looking anything up.</p></header>${forms}</main></body></html>`,
    rubric_json: JSON.stringify(
      cards
        ? Object.fromEntries(
            items.map((_, i) => [quizId(i), { [`r${i + 1}`]: rubric[`r${i + 1}`] }]),
          )
        : { review: rubric },
    ),
    teaching_plan_json: JSON.stringify({
      version: 1,
      objectives,
      quizzes: cards
        ? Object.fromEntries(
            items.map((_, i) => [
              quizId(i),
              { purpose: "assessment", questions: { [`r${i + 1}`]: questions[`r${i + 1}`] } },
            ]),
          )
        : { review: { purpose: "assessment", questions } },
    }),
  };
}
