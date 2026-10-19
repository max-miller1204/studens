import type * as http from "node:http";
import { isValidSlug } from "../paths.ts";
import * as store from "../store.ts";
import { hooks } from "./hooks.ts";
import { readJsonBody, sendJson } from "./http.ts";

export async function handleTeacher(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  route: string,
): Promise<void> {
  if (route === "teacher/chat" && req.method === "POST") {
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    const { classroom, lesson, text, id } = body;
    if (
      !isValidSlug(classroom) ||
      !isValidSlug(lesson) ||
      !store.readLesson(classroom, lesson) ||
      typeof text !== "string" ||
      !text.trim() ||
      text.length > 8000 ||
      typeof id !== "string" ||
      !/^[a-f0-9-]{36}$/.test(id)
    )
      return sendJson(res, { error: "Invalid teacher reply." }, 400);
    if (!hooks?.onTeacherChat) return sendJson(res, { error: "No dedicated teacher." }, 409);
    store.clearDraft(classroom, lesson, "teacher");
    hooks.onTeacherChat(classroom, lesson, text.trim(), id);
    return sendJson(res, { saved: true }, 201);
  }
  if (route === "teacher/retry" && req.method === "POST") {
    const body = (await readJsonBody(req)) as Record<string, unknown>;
    if (!isValidSlug(body.classroom) || typeof body.id !== "string")
      return sendJson(res, { error: "Invalid request." }, 400);
    if (!hooks?.onTeacherRetry) return sendJson(res, { error: "No dedicated teacher." }, 409);
    try {
      hooks.onTeacherRetry(body.classroom, body.id);
    } catch (err) {
      return sendJson(res, { error: (err as Error).message }, 409);
    }
    return sendJson(res, { queued: true });
  }
}
