import { stateReadError } from "../state-errors.ts";
/** Read-only projection. Execution and retries stay with their canonical owners. */
import type * as http from "node:http";
import { isValidSlug, lessonUrl } from "../paths.ts";
import { lessonRequests } from "../next-lesson.ts";
import { refillRequests } from "../review-refill.ts";
import { reviewSessions } from "../review-session.ts";
import { activeGroup, dailyReviews } from "../store/daily-review.ts";
import * as store from "../store.ts";
import { hooks } from "./hooks.ts";
import { sendJson } from "./http.ts";

export interface ActivityRequest {
  id: string;
  classroom: string;
  kind: string;
  status: "queued" | "running" | "planned" | "failed";
  url: string;
  item: string;
  error?: string;
  retry: "teacher" | "review" | "lesson" | "daily" | null;
  retryId: string;
  phase?: "writing" | "checking" | "publishing";
}
const kinds = [
  "ask",
  "follow-up",
  "quiz",
  "reflect",
  "chat",
  "review",
  "resume",
  "refill",
  "lesson",
  "dispute",
  "daily",
];
const statuses = ["queued", "running", "planned", "done", "failed"];
const priority = { running: 0, planned: 0, queued: 1, failed: 2 };

function readActivity<T>(context: string, read: () => T): T {
  try {
    return read();
  } catch (error) {
    throw stateReadError(context, error);
  }
}

export function classroomActivity(classroom: string): { requests: ActivityRequest[] } {
  const state = readActivity(`teacher state ${classroom}/.teacher.json`, () =>
    hooks?.teacherState?.(classroom),
  ) as { requests: unknown[]; identity?: { backend?: string } } | null | undefined;
  if (state && !Array.isArray(state.requests))
    throw new Error("Invalid teacher activity requests.");
  const requests = new Map<string, Record<string, unknown>>();
  for (const value of state?.requests ?? []) {
    if (!value || typeof value !== "object") throw new Error("Invalid teacher activity request.");
    const r = value as Record<string, unknown>;
    if (r.classroom !== undefined && r.classroom !== classroom)
      throw new Error("Teacher activity request belongs to another classroom.");
    if (requests.has(String(r.id))) throw new Error("Duplicate teacher activity request.");
    requests.set(String(r.id), { ...r, retry: "teacher", retryId: r.id });
  }
  // Canonical publication stores cover prepared documents without model turns too.
  // Keep the service's running/planned status while it owns an active turn.
  for (const [kind, rows] of [
    [
      "review",
      readActivity(`review request state ${classroom}/.reviews.json`, () =>
        reviewSessions(classroom),
      ),
    ],
    [
      "lesson",
      readActivity(`lesson request state ${classroom}/.lesson-requests.json`, () =>
        lessonRequests(classroom),
      ),
    ],
  ] as const) {
    for (const r of rows) {
      const id = `${kind}:${r.id}`;
      const teacher = requests.get(id);
      requests.set(id, {
        ...r,
        ...teacher,
        id,
        kind,
        retry: kind,
        retryId: r.id,
        ...(r.status === "failed" || r.status === "done"
          ? { status: r.status, error: r.error }
          : {}),
      });
    }
  }
  for (const r of readActivity(`review refill state ${classroom}/.review-refills.json`, () =>
    refillRequests(classroom),
  )) {
    const teacher = requests.get(r.id);
    requests.set(r.id, {
      ...r,
      ...teacher,
      kind: "refill",
      retry: teacher ? "teacher" : null,
      retryId: r.id,
      ...(r.status === "failed" || r.status === "done" ? { status: r.status, error: r.error } : {}),
    });
  }
  // Only the active daily group can fail or run. Unstarted later groups are not teacher work.
  for (const daily of readActivity("daily review state .daily-reviews.json", () =>
    dailyReviews(),
  )) {
    const group = daily.groups[activeGroup(daily)];
    if (!group || group.classroom !== classroom) continue;
    const key = `review:${group.plan.id}`;
    const canonical = requests.get(key);
    if (!group.error && (!canonical || canonical.status === "done")) continue;
    requests.set(key, {
      ...canonical,
      id: canonical?.id ?? `daily:${daily.id}:${classroom}`,
      lesson: group.plan.lesson,
      kind: "daily",
      status: group.error ? "failed" : canonical!.status,
      error: group.error ?? canonical?.error,
      retry: "daily",
      retryId: daily.id,
      url: `/reviews/daily/${daily.id}`,
      item: "Daily review",
    });
  }
  const result = [...requests.values()].flatMap((r, order) => {
    if (
      typeof r.id !== "string" ||
      !r.id ||
      !isValidSlug(r.lesson) ||
      typeof r.kind !== "string" ||
      !kinds.includes(r.kind) ||
      typeof r.status !== "string" ||
      !statuses.includes(r.status) ||
      (r.status === "failed" && (typeof r.error !== "string" || !r.error.trim()))
    )
      throw new Error(
        "Invalid teacher activity request identity, kind, status, or failure diagnostic.",
      );
    if (r.status === "done") return [];
    const requestLesson = r.lesson;
    const lesson = ["review", "lesson", "daily"].includes(r.kind)
      ? null
      : readActivity(`lesson state ${classroom}/${r.lesson}`, () =>
          store.readLesson(classroom, requestLesson),
        );
    if (!lesson && !["review", "lesson", "daily"].includes(r.kind))
      throw new Error(`The lesson ${r.lesson} for teacher request ${r.id} no longer exists.`);
    const root = `/c/${encodeURIComponent(classroom)}`;
    const url =
      r.kind === "daily"
        ? (r.url as string)
        : r.kind === "review"
          ? `${root}#cl-review`
          : r.kind === "lesson"
            ? `${root}#cl-next-lesson`
            : lessonUrl(classroom, r.lesson) +
              (["ask", "follow-up"].includes(r.kind) && typeof r.target === "string"
                ? `#cl-question-${encodeURIComponent(r.target)}`
                : r.kind === "dispute"
                  ? `#cl-dispute-${encodeURIComponent(r.id)}`
                  : "#cl-teacher");
    const kind = r.kind === "chat" && String(r.id).startsWith("chat:reteach:") ? "reteach" : r.kind;
    return [
      {
        id: r.id,
        classroom,
        kind,
        status: r.status as ActivityRequest["status"],
        url,
        item:
          lesson?.title ??
          (r.kind === "lesson"
            ? "Next lesson"
            : r.kind === "daily"
              ? "Daily review"
              : "Classroom review"),
        ...(r.status === "failed" ? { error: r.error as string } : {}),
        retry: r.retry as ActivityRequest["retry"],
        retryId: r.retryId as string,
        ...(r.kind === "lesson"
          ? {
              phase: (!r.document
                ? "writing"
                : !r.pageCheck
                  ? "checking"
                  : "publishing") as ActivityRequest["phase"],
            }
          : {}),
        order,
      },
    ];
  });
  result.sort((a, b) => priority[a.status] - priority[b.status] || a.order - b.order);
  return { requests: result.map(({ order: _order, ...r }) => r) };
}

export function handleActivity(res: http.ServerResponse, url: URL): void {
  const classroom = url.searchParams.get("classroom");
  const root = url.searchParams.get("scope") === "root" && classroom === null;
  try {
    if (
      !root &&
      (!isValidSlug(classroom) ||
        !readActivity(`classroom state ${classroom}`, () => store.readClassroom(classroom)))
    )
      return sendJson(res, { error: "Unknown classroom." }, 404);
    const requests = root
      ? readActivity("classroom discovery", () => store.listClassrooms()).flatMap((c) =>
          classroomActivity(c.name).requests.map((r) => ({
            ...r,
            item: `${c.title} · ${r.item}`,
          })),
        )
      : classroomActivity(classroom!).requests;
    requests.sort((a, b) => priority[a.status] - priority[b.status]);
    sendJson(res, { requests });
  } catch (error) {
    console.error("[classroom] activity state read failed", error);
    sendJson(res, { error: (error as Error).message }, 500);
  }
}
