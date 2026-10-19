import { isStoredReview } from "../paths.ts";
import type { ReviewOwner, ReviewSession } from "../review-session.ts";
import type * as store from "../store.ts";

export interface ServerHooks {
  teacherSettings?(classroom: string): unknown;
  setTeacherModel?(classroom: string, model: unknown, revision: unknown): void;
  applyConnectionSettings?(): Promise<void>;
  delivery?: "push" | "wait" | "service";
  canAccept?(classroom: string): void;
  teacherState?(classroom: string, lesson: string): unknown;
  reviewOwner?: ReviewOwner;
  onReviewMiss?(submission: store.QuizSubmission): void;
  onGradeSaved?(submission: store.QuizSubmission): void;
  onReviewSaved?(classroom: string): void;
  onReview?(session: ReviewSession): void;
  onReviewRetry?(session: ReviewSession): void;
  onTeacherChat?(classroom: string, lesson: string, text: string, id: string): void;
  onTeacherRetry?(classroom: string, id: string): void;
  /** Called after a question is persisted, to wake the agent. */
  onAsk(annotation: store.Annotation): void;
  /** Called after a follow-up is appended to an existing card. */
  onFollowUp(annotation: store.Annotation, followUp: store.FollowUp): void;
  /** Called after a quiz submission is persisted, to ask for grading. */
  onQuizSubmit(submission: store.QuizSubmission): void;
  /** Called after a reflection is saved, so the teacher sees it. */
  onReflect(reflection: store.Reflection): void;
}

export let hooks: ServerHooks | null = null;

export function reviewSaved(classroom: string): void {
  hooks?.onReviewSaved?.(classroom);
}

export function reviewMiss(submission: store.QuizSubmission): void {
  if (isStoredReview(submission.lesson)) hooks?.onReviewMiss?.(submission);
}

export function gradeSaved(submission: store.QuizSubmission): void {
  if (submission.deterministicGrades?.some((question) => !question.correct)) reviewMiss(submission);
  hooks?.onGradeSaved?.(submission);
}

export function setHooks(next: ServerHooks): void {
  hooks = next;
}
