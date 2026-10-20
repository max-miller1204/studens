/** Persist passage answers through one shared path for every host. */
import { renderMarkdown } from "./markdown.ts";
import * as server from "./server.ts";
import * as store from "./store.ts";

/** Persist an answer for whichever turn of a card is waiting on one. */
export function applyAnswer(annotationId: string, answerMarkdown: string): store.Annotation | null {
  const annotation = store.findAnnotation(annotationId);
  if (!annotation) return null;
  return applyTurnAnswer(annotationId, store.answerTarget(annotation), answerMarkdown);
}

/** Persist an answer for one specific turn of a card and push it to watching pages. */
export function applyTurnAnswer(
  annotationId: string,
  turn: store.TurnId,
  answerMarkdown: string,
): store.Annotation | null {
  const patch = {
    status: "answered" as const,
    answerMarkdown,
    answerHtml: renderMarkdown(answerMarkdown),
    answeredAt: Date.now(),
  };
  const updated =
    turn === null
      ? store.updateAnnotation(annotationId, patch)
      : store.updateFollowUp(annotationId, turn, patch);
  if (updated) server.pushEvent(updated.classroom, updated.lesson, "answer", updated);
  return updated;
}
