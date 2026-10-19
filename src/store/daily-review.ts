/** Durable cross-classroom selections. Classroom assessment history remains separate. */
import * as fs from "node:fs";
import { randomUUID } from "node:crypto";
import { isValidSlug, lessonUrl, privateStatePath } from "../paths.ts";
import type { ReviewOwner, ReviewSession } from "../review-session.ts";
import { planReview, resumableReview, reviewSessions, validateReview } from "../review-session.ts";
import { summarize } from "../review.ts";
import { listClassrooms } from "./classrooms.ts";
import { reviewItems } from "./review.ts";

export const isDailyId = (id: unknown): id is string =>
  typeof id === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id);

export interface DailyGroup {
  classroom: string;
  title: string;
  plan: ReviewSession;
  error?: string;
  empty?: boolean;
}
export interface DailyReview {
  id: string;
  at: number;
  owner: ReviewOwner;
  groups: DailyGroup[];
}

export function dailyReviews(): DailyReview[] {
  const file = privateStatePath(".daily-reviews.json");
  let value;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(`Cannot read daily review state: ${(error as Error).message}`);
  }
  if (
    value?.version !== 1 ||
    !Array.isArray(value.requests) ||
    value.requests.some(
      (request: DailyReview) =>
        !request ||
        !isDailyId(request.id) ||
        !Number.isFinite(request.at) ||
        !["pi", "service"].includes(request.owner) ||
        !Array.isArray(request.groups) ||
        !request.groups.length ||
        request.groups.some(
          (g) =>
            !g ||
            !isValidSlug(g.classroom) ||
            typeof g.title !== "string" ||
            (g.empty !== undefined && typeof g.empty !== "boolean") ||
            !g.plan ||
            g.plan.classroom !== g.classroom ||
            !isDailyId(g.plan.id) ||
            !["pi", "service"].includes(g.plan.owner) ||
            !["queued", "running", "done", "failed"].includes(g.plan.status) ||
            !Number.isSafeInteger(g.plan.ownerPid) ||
            g.plan.ownerPid < 1 ||
            !Number.isFinite(g.plan.at) ||
            (g.plan.status !== "done" && g.plan.owner !== request.owner) ||
            !isValidSlug(g.plan.lesson) ||
            (g.plan.criterionContract !== undefined && g.plan.criterionContract !== 1) ||
            !Array.isArray(g.plan.items) ||
            !g.plan.items.length ||
            g.plan.items.some((item) => !item || typeof item.key !== "string") ||
            (g.error !== undefined && typeof g.error !== "string"),
        ) ||
        new Set(request.groups.map((g) => g.classroom)).size !== request.groups.length,
    ) ||
    new Set(value.requests.map((r: DailyReview) => r.id)).size !== value.requests.length
  )
    throw new Error("Invalid daily review state.");
  for (const request of value.requests as DailyReview[])
    for (const group of request.groups) {
      if (group.plan.document) validateReview(group.plan, group.plan.document);
    }
  return value.requests;
}

/** Match folder/control edits: no waiting or automatic stale-lock removal. */
function withDailyEdit<T>(edit: () => T): T {
  fs.mkdirSync(privateStatePath("."), { recursive: true });
  const lock = privateStatePath(".daily-reviews.lock");
  let descriptor: number;
  try {
    descriptor = fs.openSync(lock, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new Error(
        `Another server has locked daily review edits. Retry after it finishes. If a server stopped during a save, remove ${lock} before retrying.`,
      );
    throw error;
  }
  try {
    fs.writeFileSync(descriptor, `${process.pid}\n`);
    return edit();
  } finally {
    fs.closeSync(descriptor);
    fs.unlinkSync(lock);
  }
}

/** Reload under the root lock so another host's completed edit cannot be overwritten. */
export function editDailyReview(id: string, edit: (request: DailyReview) => void): DailyReview {
  return withDailyEdit(() => {
    const request = dailyReviews().find((request) => request.id === id);
    if (!request) throw new Error("This daily review no longer exists.");
    edit(request);
    return request;
  });
}

export function saveDailyReview(request: DailyReview): void {
  const requests = dailyReviews();
  const index = requests.findIndex((r) => r.id === request.id);
  if (index < 0) requests.push(request);
  else requests[index] = request;
  fs.mkdirSync(privateStatePath("."), { recursive: true });
  const temporary = privateStatePath(".daily-reviews.json.tmp");
  fs.writeFileSync(temporary, JSON.stringify({ version: 1, requests }, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, privateStatePath(".daily-reviews.json"));
}

export function groupSession(group: DailyGroup): ReviewSession | undefined {
  return reviewSessions(group.classroom).find((r) => r.id === group.plan.id);
}
export function groupComplete(group: DailyGroup): boolean {
  if (group.empty) return true;
  const session = groupSession(group);
  return session?.status === "done" && !resumableReview(session);
}
export function activeGroup(request: DailyReview): number {
  return request.groups.findIndex((group) => !groupComplete(group));
}
export function currentDailyReview(): DailyReview | null {
  return [...dailyReviews()].reverse().find((r) => activeGroup(r) !== -1) ?? null;
}
/** The same history-derived summary used on the classroom page. No schedule writes. */
export function dailyDue(now = Date.now()): Record<string, number> {
  return Object.fromEntries(
    listClassrooms().map((c) => [c.name, summarize(reviewItems(c.name), now).due]),
  );
}
export function startDailyReview(
  id: string,
  owner: ReviewOwner,
  authorize?: (group: DailyGroup) => void,
): DailyReview {
  return withDailyEdit(() => createDailyReview(id, owner, authorize));
}
function createDailyReview(
  id: string,
  owner: ReviewOwner,
  authorize?: (group: DailyGroup) => void,
): DailyReview {
  if (!isDailyId(id)) throw new Error("Invalid daily review request.");
  const requests = dailyReviews();
  const existing =
    requests.find((r) => r.id === id) ?? [...requests].reverse().find((r) => activeGroup(r) !== -1);
  if (existing) {
    const active = activeGroup(existing);
    if (active !== -1) authorize?.(existing.groups[active]);
    return existing;
  }
  const due = dailyDue();
  const groups: DailyGroup[] = [];
  for (const classroom of listClassrooms().sort((a, b) => a.name.localeCompare(b.name))) {
    const pending = [...reviewSessions(classroom.name)].reverse().find(resumableReview);
    if (!pending && !due[classroom.name]) continue;
    try {
      const plan = pending ?? planReview(classroom.name, randomUUID(), owner);
      // Published reviews may be opened across hosts; unpublished work keeps its owner.
      if (plan.status !== "done" && plan.owner !== owner)
        throw new Error(
          `This review belongs to ${plan.owner}. Open that classroom host to continue.`,
        );
      const group = { classroom: classroom.name, title: classroom.title, plan };
      authorize?.(group);
      groups.push(group);
    } catch (error) {
      throw new Error(`${classroom.title}: ${(error as Error).message}`);
    }
  }
  if (!groups.length) throw new Error("No questions are due across classrooms.");
  const request = { id, owner, at: Date.now(), groups };
  saveDailyReview(request);
  return request;
}
export function publicDailyReview(request: DailyReview) {
  const active = activeGroup(request);
  return {
    id: request.id,
    at: request.at,
    complete: active === -1,
    active,
    url: `/reviews/daily/${request.id}`,
    groups: request.groups.map((g, index) => {
      const session = groupSession(g);
      return {
        classroom: g.classroom,
        title: g.title,
        count: g.empty ? 0 : g.plan.items.length,
        empty: g.empty === true,
        complete: groupComplete(g),
        status: session?.status ?? "planned",
        error: g.error ?? session?.error,
        available:
          !g.error &&
          index <= (active === -1 ? request.groups.length : active) &&
          session?.status === "done",
        url: `${lessonUrl(g.classroom, g.plan.lesson)}?daily=${request.id}`,
        historyUrl: `/c/${encodeURIComponent(g.classroom)}/reviews`,
      };
    }),
  };
}
