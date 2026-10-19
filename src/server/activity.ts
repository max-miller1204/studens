/** Read-only classroom projection. Execution and retries stay with their owning features. */
import type * as http from "node:http";
import { isValidSlug, lessonUrl } from "../paths.ts";
import { refillRequests } from "../review-refill.ts";
import { reviewSessions } from "../review-session.ts";
import * as store from "../store.ts";
import { hooks } from "./hooks.ts";
import { sendJson } from "./http.ts";

export interface ActivityRequest {
  id: string;
  kind: string;
  status: "queued" | "running" | "planned" | "failed";
  url: string;
  item: string;
  error?: string;
  retry: "teacher" | "review" | null;
}
const kinds = ["ask", "follow-up", "quiz", "reflect", "chat", "review", "resume", "refill"];
const statuses = ["queued", "running", "planned", "done", "failed"];

export function classroomActivity(classroom: string): { requests: ActivityRequest[] } {
  const state = hooks?.teacherState?.(classroom) as
    { requests: unknown[]; identity?: { backend?: string } } | null | undefined;
  if (state && !Array.isArray(state.requests))
    throw new Error("Invalid teacher activity requests.");
  const requests = new Map<string, Record<string, unknown>>();
  for (const value of state?.requests ?? []) {
    if (!value || typeof value !== "object") throw new Error("Invalid teacher activity request.");
    const r = value as Record<string, unknown>;
    requests.set(String(r.id), { ...r, retry: "teacher" });
  }
  // These stores also cover publication without a model and durable Pi background work.
  for (const r of reviewSessions(classroom))
    requests.set(`review:${r.id}`, { ...r, id: `review:${r.id}`, kind: "review", retry: "review" });
  for (const r of refillRequests(classroom))
    requests.set(r.id, { ...r, kind: "refill", retry: "teacher" });

  // Older Pi card failures live on the annotation rather than in panel requests.
  if (state?.identity?.backend === "pi") {
    for (const lesson of store.listLessons(classroom)) {
      for (const annotation of store.listAnnotations(classroom, lesson.name)) {
        for (const turn of [
          { ...annotation, id: `ask:${annotation.id}` },
          ...(annotation.followUps ?? []).map((turn) => ({ ...turn, id: `follow-up:${turn.id}` })),
        ]) {
          if (turn.status !== "failed" || requests.has(turn.id)) continue;
          requests.set(turn.id, {
            id: turn.id,
            lesson: lesson.name,
            kind: "ask",
            target: annotation.id,
            status: "failed",
            error:
              "Your teacher could not answer this question. Open the question to continue the conversation.",
            retry: null,
          });
        }
      }
    }
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
      throw new Error(`Invalid teacher activity request ${JSON.stringify(r.id)}.`);
    if (r.status === "done") return [];
    const lesson = store.readLesson(classroom, r.lesson);
    if (!lesson && r.kind !== "review")
      throw new Error(`The lesson ${r.lesson} for teacher request ${r.id} no longer exists.`);
    const root = `/c/${encodeURIComponent(classroom)}`;
    const url =
      r.kind === "review"
        ? `${root}#cl-review`
        : lessonUrl(classroom, r.lesson) +
          (["ask", "follow-up"].includes(r.kind) && typeof r.target === "string"
            ? `#cl-question-${encodeURIComponent(r.target)}`
            : "#cl-teacher");
    return [
      {
        id: r.id,
        kind: r.kind,
        status: r.status as ActivityRequest["status"],
        url,
        item: lesson?.title ?? (r.kind === "review" ? "Classroom review" : r.lesson),
        ...(r.status === "failed" ? { error: r.error as string } : {}),
        retry: r.retry as ActivityRequest["retry"],
        order,
      },
    ];
  });
  const priority = { running: 0, planned: 0, queued: 1, failed: 2 };
  result.sort(
    (a, b) =>
      priority[a.status] - priority[b.status] || a.order - b.order || a.id.localeCompare(b.id),
  );
  return { requests: result.map(({ order: _order, ...r }) => r) };
}

export function handleActivity(res: http.ServerResponse, url: URL): void {
  const classroom = url.searchParams.get("classroom");
  if (!isValidSlug(classroom) || !store.readClassroom(classroom))
    return sendJson(res, { error: "Unknown classroom." }, 404);
  try {
    sendJson(res, classroomActivity(classroom));
  } catch (error) {
    sendJson(res, { error: (error as Error).message }, 500);
  }
}
