/** Durable background work. Learner requests always run before queued refills. */
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { classroomDir, docsDir, isValidSlug } from "./paths.ts";
import { lessonPools, privatePoolPath } from "./review-pool.ts";
import { validateVariant } from "./review-variants.ts";
import type { PreparedVariant } from "./review-variants.ts";
import { reviewSessions } from "./review-session.ts";
import type { ReviewOwner } from "./review-session.ts";
import type { ReviewItem } from "./review.ts";
import * as store from "./store.ts";
import { answerSummary } from "./quiz.ts";
import type { ClassroomTool } from "./tools.ts";
import { parseReviewKey } from "../assets/runtime/quiz.mjs";

export interface RefillRequest {
  id: string;
  classroom: string;
  lesson: string;
  key: string;
  input: ReviewItem;
  owner: ReviewOwner;
  ownerPid: number;
  reason: "miss" | "low";
  at: number;
  status: "queued" | "running" | "planned" | "done" | "failed";
  prompt: string;
  error?: string;
  plan?: PreparedVariant[];
}

function file(classroom: string): string {
  if (!isValidSlug(classroom)) throw new Error("Invalid refill classroom.");
  const root = classroomDir(classroom);
  const target = path.join(root, ".review-refills.json");
  for (const name of [root, target]) {
    try {
      if (fs.lstatSync(name).isSymbolicLink())
        throw new Error(`Refill state cannot be a symlink: ${name}.`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return target;
}
function atomicJson(target: string, value: unknown): void {
  const temp = `${target}.${randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600, flag: "wx" });
  fs.renameSync(temp, target);
}
export function refillRequests(classroom: string): RefillRequest[] {
  try {
    const value = JSON.parse(fs.readFileSync(file(classroom), "utf8"));
    if (
      !value ||
      value.version !== 1 ||
      !Array.isArray(value.requests) ||
      new Set(value.requests.map((r: RefillRequest) => r?.id)).size !== value.requests.length
    )
      throw new Error(`Invalid review refill state for ${classroom}.`);
    for (const r of value.requests) {
      if (
        !r ||
        r.classroom !== classroom ||
        !isValidSlug(r.lesson) ||
        !["pi", "service"].includes(r.owner) ||
        !Number.isSafeInteger(r.ownerPid) ||
        r.ownerPid < 1 ||
        typeof r.id !== "string" ||
        typeof r.prompt !== "string" ||
        !["miss", "low"].includes(r.reason) ||
        !["queued", "running", "planned", "done", "failed"].includes(r.status) ||
        !Number.isFinite(r.at) ||
        !parseReviewKey(r.key) ||
        !r.input ||
        r.input.key !== r.key ||
        typeof r.input.lastAnswer !== "string" ||
        typeof r.input.lastFeedback !== "string" ||
        (r.plan !== undefined && !Array.isArray(r.plan))
      )
        throw new Error(`Invalid review refill state for ${classroom}.`);
    }
    return value.requests;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
export function updateRefill(
  request: RefillRequest,
  status: RefillRequest["status"],
  error?: string,
): void {
  const requests = refillRequests(request.classroom);
  const saved = requests.find((r) => r.id === request.id);
  if (!saved || saved.owner !== request.owner)
    throw new Error("This host does not own the refill request.");
  saved.status = status;
  if (status === "running") saved.ownerPid = process.pid;
  if (error) saved.error = error;
  else delete saved.error;
  atomicJson(file(request.classroom), { version: 1, requests });
}

function prompt(request: RefillRequest, item: ReviewItem, pool: PreparedVariant[]): string {
  return [
    `Background private review refill ${request.id} for classroom ${request.classroom}, original item ${item.key}.`,
    request.reason === "miss"
      ? `Write one fresh variant aimed at this specific mistake. Learner answer: ${item.lastAnswer}\nFeedback: ${item.lastFeedback}`
      : "Write two fresh variants to replenish this item's low pool.",
    `Keep the original objective and policy. Use new cases and independent retrieval. Do not include teaching, hints, or expected answers in question HTML. Use the private variant contract in ${path.join(docsDir(), "TEACHING-PLAN.md")}: one complete li.cl-q, its unique id, complete controls, and its own rubric. Closed types need machine-checkable expected keys. Use classroom-absolute media links. Do not use data-review-of. Do not reuse any existing id or prompt.`,
    `Original objective: ${JSON.stringify(pool[0].objective)}\nOriginal prompt: ${item.prompt}`,
    `Existing private variants: ${JSON.stringify(pool)}`,
    `Return exactly one save_review_variants call with classroom=${JSON.stringify(request.classroom)}, request_id=${JSON.stringify(request.id)} (copy the entire id, including its refill: prefix), and variants, an array of {id,html,rubric,plan}. Each html is an ordinary HTML string with quoted attributes, encoded once in the arguments JSON. Each plan uses objective=original, support=independent, and a suitable mental task. Keep message empty, learning_record=null, and notes_markdown empty. Do not grade, write learner messages, or edit files. This work is behind learner requests.`,
  ].join("\n\n");
}

/** Reconcile immutable grades and saved variant selections; IDs survive every restart. */
export function discoverRefills(classroom: string, owner: ReviewOwner): RefillRequest[] {
  const requests = refillRequests(classroom);
  const previousCount = requests.length;
  const items = store.reviewItems(classroom);
  const pools = new Map<string, Map<string, PreparedVariant[]>>();
  const poolFor = (item: ReviewItem) => {
    if (!pools.has(item.lesson))
      pools.set(
        item.lesson,
        lessonPools(
          classroom,
          item.lesson,
          store.readLesson(classroom, item.lesson)?.reviewVariantContract === 1,
        ),
      );
    return pools.get(item.lesson)!.get(`${item.quizId}/${item.questionId}`);
  };
  const add = (
    item: ReviewItem,
    reason: RefillRequest["reason"],
    trigger: string,
    lesson: string,
  ) => {
    const id = `refill:${createHash("sha256").update(`${reason}:${item.key}:${trigger}`).digest("hex").slice(0, 32)}`;
    if (
      requests.some(
        (r) => r.id === id || (r.key === item.key && r.reason === reason && r.status !== "done"),
      )
    )
      return;
    const request: RefillRequest = {
      id,
      classroom,
      lesson,
      key: item.key,
      input: item,
      owner,
      ownerPid: process.pid,
      reason,
      at: Date.now(),
      status: "queued",
      prompt: "",
    };
    try {
      const pool = poolFor(item);
      if (!pool) return;
      request.prompt = prompt(request, item, pool);
    } catch (error) {
      request.status = "failed";
      request.error = `Cannot prepare private review refill for ${item.key}: ${(error as Error).message}`;
    }
    requests.push(request);
  };
  for (const lesson of store.listLessons(classroom)) {
    const grades = store.latestGrades(classroom, lesson.name);
    for (const submission of store.listSubmissions(classroom, lesson.name)) {
      if (submission.kind === "pretest") continue;
      const grade = grades.find((g) => g.submissionId === submission.id);
      if (!grade) continue;
      for (const verdict of grade.questions) {
        if (verdict.correct) continue;
        const answer = submission.answers.find((a) => a.questionId === verdict.questionId);
        const key =
          answer?.reviewOf ?? `${submission.lesson}/${submission.quizId}/${verdict.questionId}`;
        const item = items.find((item) => item.key === key);
        if (item)
          add(
            {
              ...item,
              lastAnswer: answerSummary(
                submission.answers.filter((a) => a.questionId === verdict.questionId),
              ),
              lastFeedback: verdict.feedback,
            },
            "miss",
            submission.id,
            submission.lesson,
          );
      }
    }
  }
  const sessions = reviewSessions(classroom);
  for (const item of items) {
    const used = sessions.flatMap((s) => (s.variants?.[item.key] ? [s.variants[item.key]] : []));
    const latest = [...sessions]
      .reverse()
      .find((s) => s.status === "done" && s.variants?.[item.key]);
    if (!latest) continue;
    try {
      const pool = poolFor(item);
      if (pool && pool.filter((v) => !used.includes(v.id)).length <= 1)
        add(item, "low", latest.id, latest.lesson);
    } catch {
      add(item, "low", latest.id, latest.lesson);
    }
  }
  if (requests.length !== previousCount) atomicJson(file(classroom), { version: 1, requests });
  return requests.filter((r) => r.owner === owner);
}

export function validateRefill(request: RefillRequest, value: unknown): PreparedVariant[] {
  if (!Array.isArray(value) || value.length !== (request.reason === "miss" ? 1 : 2))
    throw new Error(
      `Refill ${request.id} needs ${request.reason === "miss" ? "one" : "two"} variants.`,
    );
  const [lesson, quiz, question] = request.key.split("/");
  const pool = lessonPools(request.classroom, lesson).get(`${quiz}/${question}`);
  if (!pool?.length) throw new Error(`Original private pool is missing: ${request.key}.`);
  const variants = value.map((v) => validateVariant(v, v?.plan, pool[0].objective));
  if (variants.some((v) => pool.some((old) => old.id === v.id)))
    throw new Error("A refill reused an existing variant id.");
  if (new Set(variants.map((v) => v.id)).size !== variants.length)
    throw new Error("Refill variant ids must be unique.");
  return variants;
}

/** Save validated output before the single atomic pool update. Replay is idempotent. */
export function saveRefillPlan(request: RefillRequest, value: unknown): void {
  const requests = refillRequests(request.classroom);
  const saved = requests.find((r) => r.id === request.id && r.owner === request.owner);
  if (!saved || !["running", "planned"].includes(saved.status))
    throw new Error("This refill is not active for this host.");
  if (!Array.isArray(value)) throw new Error("Refill output must be a variant array.");
  if (saved.plan) {
    const replay = value.map((v) => validateVariant(v, v?.plan, saved.plan![0].objective));
    if (JSON.stringify(saved.plan) !== JSON.stringify(replay))
      throw new Error("The saved refill plan conflicts with this output.");
    return;
  }
  const variants = validateRefill(request, value);
  saved.plan = variants;
  saved.status = "planned";
  atomicJson(file(request.classroom), { version: 1, requests });
}

export function applyRefill(request: RefillRequest): void {
  const saved = refillRequests(request.classroom).find(
    (r) => r.id === request.id && r.owner === request.owner,
  );
  if (!saved?.plan) throw new Error("No saved refill plan to apply.");
  const [lesson, quiz, question] = request.key.split("/");
  const target = privatePoolPath(request.classroom, lesson, "review-pool.json");
  const state = fs.existsSync(target)
    ? JSON.parse(fs.readFileSync(target, "utf8"))
    : { version: 1, batches: [] };
  if (!state || state.version !== 1 || !Array.isArray(state.batches))
    throw new Error("Invalid private supplemental pool.");
  const previous = state.batches.find((b: { requestId: string }) => b.requestId === request.id);
  const batch = { requestId: request.id, key: `${quiz}/${question}`, variants: saved.plan };
  if (previous && JSON.stringify(previous) !== JSON.stringify(batch))
    throw new Error("Published refill conflicts with its saved plan.");
  if (!previous) {
    const validated = validateRefill(saved, saved.plan);
    if (JSON.stringify(validated) !== JSON.stringify(saved.plan))
      throw new Error("The original objective changed after the refill plan was saved.");
    state.batches.push(batch);
    atomicJson(target, state);
  }
  updateRefill(request, "done");
}

export const REFILL_TOOL = {
  name: "save_review_variants",
  description:
    "Save only the private variants requested by the active background refill. Never grade or change learner history.",
  parameters: {
    type: "object",
    properties: {
      classroom: { type: "string" },
      request_id: { type: "string" },
      variants: {
        type: "array",
        minItems: 1,
        maxItems: 2,
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            html: { type: "string" },
            rubric: { type: "object" },
            plan: { type: "object" },
          },
          required: ["id", "html", "rubric", "plan"],
          additionalProperties: false,
        },
      },
    },
    required: ["classroom", "request_id", "variants"],
    additionalProperties: false,
  },
};

export function piRefillTool(): ClassroomTool {
  return {
    ...REFILL_TOOL,
    label: "Save Review Variants",
    async execute(args: { classroom: string; request_id: string; variants: unknown }) {
      try {
        const request = refillRequests(args.classroom).find((r) => r.id === args.request_id);
        if (
          !request ||
          request.owner !== "pi" ||
          request.ownerPid !== process.pid ||
          request.status !== "running"
        )
          throw new Error("This Pi session does not own an active refill request.");
        saveRefillPlan(request, args.variants);
        applyRefill(request);
        return {
          content: [
            { type: "text", text: "Saved private review variants. Learner history is unchanged." },
          ],
          details: {},
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${(error as Error).message}` }],
          details: { error: true },
        };
      }
    },
  };
}

/** Explicit retry may refresh authoring context, never the saved learner mistake. */
export function refreshRefill(request: RefillRequest): RefillRequest {
  if (request.plan) return request;
  const [lesson, quiz, question] = request.key.split("/");
  const pool = lessonPools(request.classroom, lesson).get(`${quiz}/${question}`);
  if (!pool?.length) throw new Error(`Original private pool is missing: ${request.key}.`);
  const requests = refillRequests(request.classroom);
  const saved = requests.find((r) => r.id === request.id && r.owner === request.owner)!;
  saved.prompt = prompt(saved, saved.input, pool);
  if (saved.error)
    saved.prompt += `\nPrevious refill error: ${saved.error}. Correct it in this attempt.`;
  atomicJson(file(request.classroom), { version: 1, requests });
  return saved;
}

export function refillOwnerAlive(request: Pick<RefillRequest, "ownerPid">): boolean {
  try {
    process.kill(request.ownerPid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}
