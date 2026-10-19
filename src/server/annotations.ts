import type * as http from "node:http";
import { isContractId } from "../../assets/runtime/quiz.mjs";
import { isValidSlug } from "../paths.ts";
import { reviewSessions } from "../review-session.ts";
import * as store from "../store.ts";
import { hooks } from "./hooks.ts";
import { lessonParams, readJsonBody, sendJson } from "./http.ts";

/** Validate the anchor an untrusted browser sent us before persisting it. */
function parseAnchor(value: unknown): store.Annotation["anchor"] | null {
  if (!value || typeof value !== "object") return null;
  const a = value as Record<string, unknown>;
  if (typeof a["exact"] !== "string" || a["exact"].length === 0) return null;
  return {
    exact: a["exact"].slice(0, 2000),
    prefix: typeof a["prefix"] === "string" ? a["prefix"].slice(0, 500) : "",
    suffix: typeof a["suffix"] === "string" ? a["suffix"].slice(0, 500) : "",
    occurrence: typeof a["occurrence"] === "number" && a["occurrence"] >= 0 ? a["occurrence"] : 0,
  };
}

export async function handleAsk(
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
  const question = String(body["question"] ?? "").trim();
  const anchor = parseAnchor(body["anchor"]);

  if (!isValidSlug(classroom) || !isValidSlug(lesson)) {
    return sendJson(res, { error: "Unknown classroom or lesson" }, 400);
  }
  if (!question) return sendJson(res, { error: "A question is required" }, 400);
  if (!anchor) return sendJson(res, { error: "A valid anchor is required" }, 400);
  if (!store.readLesson(classroom, lesson)) return sendJson(res, { error: "Unknown lesson" }, 404);
  const quiz = parseQuizRef(body["quiz"]);
  if (quiz === undefined) return sendJson(res, { error: "Invalid quiz reference" }, 400);

  hooks?.canAccept?.(classroom);
  if (reviewSessions(classroom).some((s) => s.lesson === lesson && s.status !== "done"))
    return sendJson(res, { error: "This review is not ready." }, 409);
  // Before the save: a draft file that cannot be read must stop the request, not
  // leave a saved question that the teacher never hears about.
  store.clearDraft(classroom, lesson, "ask");
  const annotation = store.createAnnotation({
    classroom,
    lesson,
    question: question.slice(0, 4000),
    selection:
      typeof body["selection"] === "string" ? body["selection"].slice(0, 2000) : anchor.exact,
    anchor,
    ...(quiz && {
      quiz: { ...quiz, graded: isGraded(classroom, lesson, quiz.quizId) },
    }),
  });

  hooks?.onAsk(annotation);
  sendJson(res, annotation, 201);
}

/**
 * The quiz a highlight sits in. Null for lesson text, undefined when the browser sent
 * something that is not a quiz reference.
 */
function parseQuizRef(
  value: unknown,
): { quizId: string; questionId: string | null } | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object") return undefined;
  const { quizId, questionId } = value as Record<string, unknown>;
  if (!isContractId(quizId)) return undefined;
  if (questionId !== null && questionId !== undefined && !isContractId(questionId))
    return undefined;
  return { quizId, questionId: questionId ?? null };
}

/** Whether the latest attempt at a quiz has a grade. */
function isGraded(classroom: string, lesson: string, quizId: string): boolean {
  return store
    .latestQuizStates(classroom, lesson)
    .some((state) => state.quizId === quizId && state.grade !== null);
}

export async function handleFollowUp(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  annotationId: string,
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = (await readJsonBody(req)) as Record<string, unknown>;
  } catch (err) {
    return sendJson(res, { error: (err as Error).message }, 400);
  }

  const question = String(body["question"] ?? "").trim();
  if (!question) return sendJson(res, { error: "A question is required" }, 400);

  const existing = store.findAnnotation(annotationId);
  if (!existing) return sendJson(res, { error: "Unknown question" }, 404);
  // Reason: a card whose first question is still spinning has no answer to follow up on,
  // and the thread prompt would have nothing to build from.
  if (existing.status === "pending") {
    return sendJson(res, { error: "That question has not been answered yet" }, 409);
  }

  hooks?.canAccept?.(existing.classroom);
  // The quiz may have been graded since the card was opened, and that changes what the
  // teacher may say about it.
  if (existing.quiz) {
    const graded = isGraded(existing.classroom, existing.lesson, existing.quiz.quizId);
    if (graded !== existing.quiz.graded)
      store.updateAnnotation(annotationId, {
        quiz: { ...existing.quiz, graded },
      });
  }
  store.clearDraft(existing.classroom, existing.lesson, `followup:${annotationId}`);
  const added = store.addFollowUp(annotationId, question.slice(0, 4000));
  if (!added) return sendJson(res, { error: "Could not save the follow-up" }, 500);

  hooks?.onFollowUp(added.annotation, added.followUp);
  sendJson(res, added.annotation, 201);
}

export function handleDeleteAnnotation(res: http.ServerResponse, id: string, url: URL): void {
  const params = lessonParams(url);
  if (!params) return sendJson(res, { error: "classroom and lesson are required" }, 400);
  store.clearDraft(params.classroom, params.lesson, `followup:${id}`);
  const removed = store.deleteAnnotation(params.classroom, params.lesson, id);
  sendJson(res, { removed });
}
