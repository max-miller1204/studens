import { randomUUID } from "node:crypto";
import { annotationsFile, isValidSlug } from "../paths.ts";
import { allLessonRefs } from "./classrooms.ts";
import { readJson, writeJson } from "./json.ts";

/**
 * A follow-up question asked inside an existing card, continuing the same thread.
 *
 * Follow-ups live on the annotation rather than becoming annotations of their own: they
 * share one highlight, and the teacher needs the earlier turns as context to answer.
 */
export interface FollowUp {
  id: string;
  status: "pending" | "answered" | "failed";
  question: string;
  answerMarkdown: string | null;
  answerHtml: string | null;
  askedAt: number;
  answeredAt: number | null;
}

/**
 * A highlight-and-ask card. `anchor` is a W3C-style text-quote selector so the
 * highlight can be re-found after the page reloads (or after the lesson is edited).
 *
 * The card is a thread: `question`/`answer*` are its first turn and `followUps` are the
 * ones after it. `followUps` is optional so annotation files written before follow-ups
 * existed still parse.
 */
export interface Annotation {
  id: string;
  classroom: string;
  lesson: string;
  status: "pending" | "answered" | "failed";
  question: string;
  /** The text the learner highlighted. */
  selection: string;
  anchor: { exact: string; prefix: string; suffix: string; occurrence: number };
  answerMarkdown: string | null;
  answerHtml: string | null;
  createdAt: number;
  answeredAt: number | null;
  followUps?: FollowUp[];
  /**
   * Set when the highlight sits inside a quiz. `graded` is whether that quiz had a
   * grade when the question was last asked, because before grading the teacher must
   * not give away the answer. `questionId` is null for the quiz heading.
   */
  quiz?: { quizId: string; questionId: string | null; graded: boolean };
}

/**
 * Which turn of a card an answer belongs to: `null` is the original question, a string
 * is the id of a follow-up.
 */
export type TurnId = string | null;

export function listAnnotations(classroom: string, lesson: string): Annotation[] {
  if (!isValidSlug(classroom) || !isValidSlug(lesson)) return [];
  return readJson<Annotation[]>(annotationsFile(classroom, lesson), "array") ?? [];
}

function writeAnnotations(classroom: string, lesson: string, list: Annotation[]): void {
  writeJson(annotationsFile(classroom, lesson), list);
}

export function createAnnotation(
  input: Omit<
    Annotation,
    "id" | "status" | "answerMarkdown" | "answerHtml" | "createdAt" | "answeredAt"
  >,
): Annotation {
  const annotation: Annotation = {
    ...input,
    id: randomUUID(),
    status: "pending",
    answerMarkdown: null,
    answerHtml: null,
    createdAt: Date.now(),
    answeredAt: null,
    followUps: [],
  };
  const list = listAnnotations(input.classroom, input.lesson);
  list.push(annotation);
  writeAnnotations(input.classroom, input.lesson, list);
  return annotation;
}

/**
 * Find an annotation by id across every classroom and lesson.
 *
 * Reason: `answer_lesson_question` is called with just the id — the model should not
 * have to carry classroom/lesson round-trip, and getting either wrong would silently
 * drop the answer.
 */
export function findAnnotation(id: string): Annotation | null {
  for (const { classroom, lesson } of allLessonRefs()) {
    const hit = listAnnotations(classroom, lesson).find((a) => a.id === id);
    if (hit) return hit;
  }
  return null;
}

export function updateAnnotation(
  id: string,
  patch: Partial<Omit<Annotation, "id" | "classroom" | "lesson">>,
): Annotation | null {
  const existing = findAnnotation(id);
  if (!existing) return null;

  const list = listAnnotations(existing.classroom, existing.lesson);
  const idx = list.findIndex((a) => a.id === id);
  if (idx === -1) return null;

  const updated = { ...list[idx], ...patch };
  list[idx] = updated;
  writeAnnotations(existing.classroom, existing.lesson, list);
  return updated;
}

// ── Follow-ups ────────────────────────────────────────────────────────────────

/** Append a follow-up question to an existing card, as a pending turn. */
export function addFollowUp(
  annotationId: string,
  question: string,
): { annotation: Annotation; followUp: FollowUp } | null {
  const existing = findAnnotation(annotationId);
  if (!existing) return null;

  const followUp: FollowUp = {
    id: randomUUID(),
    status: "pending",
    question,
    answerMarkdown: null,
    answerHtml: null,
    askedAt: Date.now(),
    answeredAt: null,
  };

  const annotation = updateAnnotation(annotationId, {
    followUps: [...(existing.followUps ?? []), followUp],
  });
  return annotation ? { annotation, followUp } : null;
}

export function updateFollowUp(
  annotationId: string,
  followUpId: string,
  patch: Partial<Omit<FollowUp, "id">>,
): Annotation | null {
  const existing = findAnnotation(annotationId);
  if (!existing) return null;

  const followUps = existing.followUps ?? [];
  if (!followUps.some((f) => f.id === followUpId)) return null;

  return updateAnnotation(annotationId, {
    followUps: followUps.map((f) => (f.id === followUpId ? { ...f, ...patch } : f)),
  });
}

/** Is the given turn of a card still waiting on an answer? */
export function isTurnPending(annotation: Annotation, turn: TurnId): boolean {
  if (turn === null) return annotation.status === "pending";
  return (annotation.followUps ?? []).find((f) => f.id === turn)?.status === "pending";
}

/**
 * The turn an incoming answer belongs to.
 *
 * Reason: `answer_lesson_question` is called with only an annotation id, so the target
 * is inferred — the oldest turn still waiting, or (when nothing is pending and the model
 * is revising) the most recent turn.
 */
export function answerTarget(annotation: Annotation): TurnId {
  if (annotation.status === "pending") return null;
  const followUps = annotation.followUps ?? [];
  const pending = followUps.find((f) => f.status === "pending");
  if (pending) return pending.id;
  return followUps.length > 0 ? followUps[followUps.length - 1].id : null;
}

export function deleteAnnotation(classroom: string, lesson: string, id: string): boolean {
  const list = listAnnotations(classroom, lesson);
  const next = list.filter((a) => a.id !== id);
  if (next.length === list.length) return false;
  writeAnnotations(classroom, lesson, next);
  return true;
}
