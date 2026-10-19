import type * as http from "node:http";
import { shell } from "../pages.ts";
import { escapeHtml } from "../markdown.ts";
import {
  activeGroup,
  currentDailyReview,
  dailyDue,
  editDailyReview,
  dailyReviews,
  groupSession,
  isDailyId,
  publicDailyReview,
  saveDailyReview,
  startDailyReview,
} from "../store/daily-review.ts";
import type { DailyGroup, DailyReview } from "../store/daily-review.ts";
import {
  planReview,
  plannedReviewEligible,
  requireReviewOwner,
  savePlannedReview,
} from "../review-session.ts";
import { privateStatePath } from "../paths.ts";
import { readTeacherState } from "../service-state.ts";
import { hooks } from "./hooks.ts";
import { readJsonBody, sendHtml, sendJson, sendNotFound } from "./http.ts";

/** Daily navigation must use the selected classroom host, including after reload. */
function requireGroupOwner(group: DailyGroup): void {
  privateStatePath(`${group.classroom}/.teacher.json`);
  const teacher = readTeacherState(group.classroom);
  if (hooks?.reviewOwner === "pi" && teacher)
    throw new Error(
      `This classroom belongs to ${teacher.identity.backend}. Open its persistent classroom service to continue.`,
    );
  const session = groupSession(group) ?? group.plan;
  if (session.status !== "done" && hooks?.reviewOwner)
    requireReviewOwner(session, hooks.reviewOwner);
}
function requireGroupHost(group: DailyGroup): void {
  if (!hooks?.reviewOwner || !hooks.onReview || !hooks.onReviewRetry)
    throw new Error("No review teacher is connected.");
  requireGroupOwner(group);
  hooks.canAccept?.(group.classroom);
}
function presentDailyReview(request: DailyReview) {
  const result = publicDailyReview(request);
  if (result.active !== -1) {
    try {
      requireGroupHost(request.groups[result.active]);
    } catch (error) {
      result.groups[result.active].error = (error as Error).message;
      result.groups[result.active].available = false;
    }
  }
  return result;
}

/** Only explicit actions publish or retry a group; reads never wake a teacher. */
function openGroup(request: DailyReview, classroom: unknown, retry: boolean): void {
  const index = activeGroup(request);
  if (index === -1) return;
  const group = request.groups[index];
  // A delayed duplicate click must not publish the following classroom.
  if (group.classroom !== classroom) return;
  // Foreign navigation may display an error, but cannot overwrite the owner's state.
  requireGroupOwner(group);
  let session = groupSession(group);
  if (!retry && (group.error || session?.status === "failed")) return;
  try {
    requireGroupHost(group);
    if (session?.status === "done") {
      delete group.error;
      saveDailyReview(request);
      return;
    }
    if (retry && !session && !plannedReviewEligible(group.plan)) {
      // Refresh only on explicit retry, preserving the original snapshot until then.
      // The picker also applies retirement/pausing controls when those are present.
      const anyDue = dailyDue()[group.classroom] > 0;
      if (!anyDue) group.empty = true;
      else group.plan = planReview(group.classroom, group.plan.id, group.plan.owner);
      delete group.error;
      saveDailyReview(request);
      if (group.empty) return;
    }
    session ??= savePlannedReview(group.plan);
    if (session.status === "failed") {
      if (!retry) return;
      hooks!.onReviewRetry!(session);
    } else if (session.status === "queued") hooks!.onReview!(session);
    delete group.error;
  } catch (error) {
    group.error = (error as Error).message;
  }
  saveDailyReview(request);
}
export async function handleDailyReview(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  route: string,
  url: URL,
): Promise<void> {
  try {
    if (req.method === "GET" && route === "daily-review") {
      const id = url.searchParams.get("id");
      if (id !== null && !isDailyId(id))
        return sendJson(res, { error: "Invalid daily review ID." }, 400);
      const request = id ? dailyReviews().find((r) => r.id === id) : currentDailyReview();
      if (id && !request)
        return sendJson(res, { error: "This daily review no longer exists." }, 404);
      return sendJson(res, {
        daily: request ? presentDailyReview(request) : null,
        due: dailyDue(),
      });
    }
    if (req.method !== "POST") return sendJson(res, { error: "Unknown daily review action." }, 405);
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    if (!body || !isDailyId(body.id))
      return sendJson(res, { error: "Invalid daily review request." }, 400);
    let request;
    if (route === "daily-review") {
      if (!hooks?.reviewOwner)
        return sendJson(res, { error: "No review teacher is connected." }, 409);
      const started = startDailyReview(body.id, hooks.reviewOwner, requireGroupOwner);
      request = editDailyReview(started.id, (current) => {
        const index = activeGroup(current);
        if (index !== -1) openGroup(current, current.groups[index].classroom, false);
      });
    } else {
      request = editDailyReview(body.id, (current) =>
        openGroup(current, body.classroom, route === "daily-review/retry"),
      );
    }
    return sendJson(res, { daily: presentDailyReview(request), due: dailyDue() }, 202);
  } catch (error) {
    return sendJson(res, { error: (error as Error).message }, 409);
  }
}
export function handleDailyPage(res: http.ServerResponse, rest: string[]): void {
  if (rest.length === 1 && rest[0] === "daily") {
    try {
      const history = dailyReviews().reverse().map(publicDailyReview);
      return sendHtml(
        res,
        shell({
          title: "Daily review history",
          breadcrumb: '<a class="cl-crumb" href="/">Classrooms</a>',
          body: `<div class="cl-hero"><h1>Daily review history</h1></div>${history.length ? `<ol class="cl-daily-groups">${history.map((r) => `<li class="cl-daily-group"><a href="${r.url}">${escapeHtml(new Date(r.at).toLocaleDateString("en-US", { timeZone: "UTC" }))}</a><p>${r.groups.length} classrooms · ${r.groups.filter((g) => g.complete).length} complete</p></li>`).join("")}</ol>` : "<p>No daily reviews yet. Start when questions are due.</p>"}`,
        }),
      );
    } catch (error) {
      return sendHtml(
        res,
        shell({
          title: "Cannot load daily review history",
          breadcrumb: '<a href="/">Classrooms</a>',
          body: `<h1>Cannot load daily review history</h1><p role="alert">${escapeHtml((error as Error).message)}</p><a href="/reviews/daily">Retry loading</a>`,
        }),
        409,
      );
    }
  }
  if (rest.length !== 2 || rest[0] !== "daily" || !isDailyId(rest[1]))
    return sendNotFound(res, "Unknown daily review");
  try {
    const request = dailyReviews().find((r) => r.id === rest[1]);
    if (!request) return sendNotFound(res, "This daily review no longer exists.");
    sendHtml(
      res,
      shell({
        title: "Daily review",
        breadcrumb:
          '<a class="cl-crumb" href="/">Classrooms</a><span class="cl-crumb-sep" aria-hidden="true">/</span><span class="cl-crumb cl-crumb-current">Daily review</span>',
        body: `<div class="cl-hero"><h1>Daily review</h1><p class="cl-lede">${escapeHtml(new Date(request.at).toLocaleDateString("en-US", { timeZone: "UTC" }))} · One classroom at a time. Your answers and teacher conversations stay with each classroom.</p></div>
<section data-cl-daily="${request.id}" aria-label="Daily review groups"><p role="status" data-daily-status>Loading daily review…</p><ol class="cl-daily-groups" data-daily-groups></ol><button class="cl-button" type="button" data-daily-action disabled>Continue daily review</button></section>
<p><a href="/">Back to classrooms</a></p>`,
      }),
    );
  } catch (error) {
    sendHtml(
      res,
      shell({
        title: "Cannot load daily review",
        breadcrumb: '<a href="/">Classrooms</a>',
        body: `<h1>Cannot load daily review</h1><p role="alert">${escapeHtml((error as Error).message)}</p><a class="cl-button" href="/reviews/daily/${rest[1]}">Retry loading</a>`,
      }),
      409,
    );
  }
}
