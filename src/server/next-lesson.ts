import type * as http from "node:http";
import { isValidSlug } from "../paths.ts";
import {
  lessonRequests,
  publicLessonRequest,
  requireLessonOwner,
  updateLessonRequest,
  startLessonRequest,
} from "../next-lesson.ts";
import * as store from "../store.ts";
import { hooks } from "./hooks.ts";
import { readJsonBody, sendJson } from "./http.ts";

export async function handleNextLesson(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  route: string,
  url: URL,
): Promise<void> {
  if (req.method === "GET") {
    const classroom = url.searchParams.get("classroom");
    if (!isValidSlug(classroom) || !store.readClassroom(classroom))
      return sendJson(res, { error: "Unknown classroom." }, 404);
    try {
      const request = lessonRequests(classroom).at(-1) ?? null;
      if (request && request.status !== "done" && hooks?.lessonOwner)
        requireLessonOwner(request, hooks.lessonOwner(classroom));
      return sendJson(res, { lesson: publicLessonRequest(request) });
    } catch (error) {
      return sendJson(res, { error: (error as Error).message }, 409);
    }
  }
  const body = (await readJsonBody(req)) as Record<string, unknown>;
  if (
    !body ||
    !isValidSlug(body.classroom) ||
    typeof body.id !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(body.id) ||
    (body.topic !== undefined && (typeof body.topic !== "string" || body.topic.length > 2000))
  )
    return sendJson(
      res,
      { error: "Invalid next lesson request. Topic must be at most 2000 characters." },
      400,
    );
  if (!store.readClassroom(body.classroom))
    return sendJson(res, { error: "Unknown classroom." }, 404);
  if (!hooks?.onNextLesson || !hooks.onNextLessonRetry || !hooks.lessonOwner)
    return sendJson(res, { error: "No lesson teacher is connected." }, 409);
  let attempted: ReturnType<typeof startLessonRequest> | undefined;
  try {
    hooks.canAccept?.(body.classroom);
    const owner = hooks.lessonOwner(body.classroom);
    let selected: string;
    if (route === "lesson/retry") {
      const request = lessonRequests(body.classroom).find((r) => r.id === body.id);
      if (!request || request.status !== "failed")
        throw new Error("This lesson request cannot be retried.");
      requireLessonOwner(request, owner);
      attempted = request;
      selected = request.id;
      hooks.onNextLessonRetry(request);
    } else {
      const request = startLessonRequest(
        body.classroom,
        body.id,
        (body.topic as string | undefined)?.trim() ?? "",
        owner,
        hooks.delivery === "service" ? "service" : undefined,
      );
      attempted = request;
      selected = request.id;
      if (request.status === "queued") hooks.onNextLesson(request);
    }
    return sendJson(
      res,
      {
        lesson: publicLessonRequest(lessonRequests(body.classroom).find((r) => r.id === selected)!),
      },
      202,
    );
  } catch (error) {
    if (attempted && attempted.status !== "done")
      updateLessonRequest(attempted, { status: "failed", error: (error as Error).message });
    return sendJson(res, { error: (error as Error).message }, 409);
  }
}
