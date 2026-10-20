import type * as http from "node:http";
import { draftErrors, isDraftKey } from "../../assets/runtime/draft.mjs";
import { isContractId } from "../../assets/runtime/quiz.mjs";
import { isValidSlug } from "../paths.ts";
import { reteachOffers } from "../reteach.ts";
import { reviewSessions } from "../review-session.ts";
import * as store from "../store.ts";
import { hooks } from "./hooks.ts";
import { lessonParams, readJsonBody, sendJson } from "./http.ts";

export function handleState(res: http.ServerResponse, url: URL): void {
  const params = lessonParams(url);
  if (!params) return sendJson(res, { error: "classroom and lesson are required" }, 400);

  sendJson(res, {
    annotations: store.listAnnotations(params.classroom, params.lesson),
    quizzes: store.latestQuizStates(params.classroom, params.lesson).map((state) => ({
      ...state,
      submission: store.publicSubmission(state.submission),
      history: store
        .listGrades(params.classroom, params.lesson)
        .filter((g) => g.submissionId === state.submission.id),
    })),
    reflections: store.latestReflections(params.classroom, params.lesson),
    drafts: store.readDrafts(params.classroom, params.lesson),
    reteach: reteachOffers(params.classroom, params.lesson),
    teacher: hooks?.teacherState?.(params.classroom, params.lesson),
  });
}

export function handleGlossary(res: http.ServerResponse, url: URL): void {
  const classroom = url.searchParams.get("classroom") ?? "";
  if (!isValidSlug(classroom) || !store.readClassroom(classroom)) {
    return sendJson(res, { error: "Unknown classroom" }, 404);
  }
  sendJson(res, store.readGlossary(classroom));
}

export async function handleReflect(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = (await readJsonBody(req)) as Record<string, unknown>;
  } catch (err) {
    return sendJson(res, { error: (err as Error).message }, 400);
  }

  const classroom = String(body["classroom"] ?? "");
  const lesson = String(body["lesson"] ?? "");
  if (!isValidSlug(classroom) || !isValidSlug(lesson)) {
    return sendJson(res, { error: "Unknown classroom or lesson" }, 400);
  }
  if (!store.readLesson(classroom, lesson)) return sendJson(res, { error: "Unknown lesson" }, 404);

  const reflectId = body["reflectId"];
  if (!isContractId(reflectId)) {
    return sendJson(res, { error: "A valid reflectId is required" }, 400);
  }
  const text = typeof body["text"] === "string" ? body["text"].trim() : "";
  if (!text) return sendJson(res, { error: "A reflection needs some text" }, 400);

  hooks?.canAccept?.(classroom);
  if (reviewSessions(classroom).some((s) => s.lesson === lesson && s.status !== "done"))
    return sendJson(res, { error: "This review is not ready." }, 409);
  store.clearDraft(classroom, lesson, `reflect:${reflectId}`);
  const reflection = store.createReflection({
    classroom,
    lesson,
    reflectId,
    prompt: typeof body["prompt"] === "string" ? body["prompt"].slice(0, 2000) : "",
    text: text.slice(0, 8000),
  });

  hooks?.onReflect(reflection);
  sendJson(res, reflection, 201);
}

/**
 * Save one draft, or remove it when `value` is null.
 *
 * Drafts never reach the teacher. They exist so a reload does not lose what the
 * learner typed. The handlers that send text remove the matching draft.
 */
export async function handleDraft(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = (await readJsonBody(req)) as Record<string, unknown>;
  } catch (err) {
    return sendJson(res, { error: (err as Error).message }, 400);
  }

  const { classroom, lesson, key, value } = body;
  if (!isValidSlug(classroom) || !isValidSlug(lesson)) {
    return sendJson(res, { error: "Unknown classroom or lesson" }, 400);
  }
  if (!store.readLesson(classroom, lesson)) return sendJson(res, { error: "Unknown lesson" }, 404);
  if (!isDraftKey(key))
    return sendJson(res, { error: `Unknown draft key ${JSON.stringify(key)}.` }, 400);
  if (value === null) {
    store.clearDraft(classroom, lesson, key);
    return sendJson(res, { saved: false });
  }
  const errors = draftErrors(key, value);
  if (errors.length > 0) return sendJson(res, { error: errors.join(" ") }, 400);
  store.saveDraft(classroom, lesson, key, value);
  sendJson(res, { saved: true });
}
