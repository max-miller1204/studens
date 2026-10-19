import * as path from "node:path";
import { gradesDir, isValidSlug, submissionsDir } from "../paths.ts";
import type { QuizAnswer, QuizKind } from "../quiz.ts";
import type { TeachingPlan } from "../teaching-plan.ts";
import { allLessonRefs } from "./classrooms.ts";
import { listJsonFiles, writeJson } from "./json.ts";
export type { QuizAnswer, QuizKind } from "../quiz.ts";

export interface QuizSubmission {
  id: string;
  classroom: string;
  lesson: string;
  quizId: string;
  quizTitle: string;
  /** Absent on submissions written before quiz kinds existed. Read it with `kindOf`. */
  kind?: QuizKind;
  /** 1 for the first attempt at this quiz, 2 for the first retake, and so on. */
  attempt?: number;
  answers: QuizAnswer[];
  submittedAt: number;
  /** The private rubric bytes when this attempt was saved. Absent in older attempts. */
  rubricDigest?: string;
  assessmentContract?: 1;
  instructionalContract?: 1;
  teachingPlan?: TeachingPlan;
  /** Private, durable allocations computed before the submission is written. */
  deterministicGrades?: QuizQuestionGrade[];
  /** Code-owned selection timing; replay does not depend on the current schedule. */
  earlyReviewKeys?: string[];
}

export interface QuizQuestionGrade {
  /** Absent on historical binary grades. */
  pointsEarned?: number;
  pointsPossible?: number;
  questionId: string;
  correct: boolean;
  feedback: string;
  feedbackHtml?: string;
}

export interface QuizGrade {
  submissionId: string;
  classroom: string;
  lesson: string;
  quizId: string;
  score: number;
  feedbackMarkdown: string;
  feedbackHtml: string;
  questions: QuizQuestionGrade[];
  gradedAt: number;
}

export function listSubmissions(classroom: string, lesson: string): QuizSubmission[] {
  if (!isValidSlug(classroom) || !isValidSlug(lesson)) return [];
  return listJsonFiles<QuizSubmission>(submissionsDir(classroom, lesson)).sort(
    (a, b) => a.submittedAt - b.submittedAt,
  );
}

/** Every grade file in a lesson, oldest first. A regrade adds a file, so this is history. */
export function listGrades(classroom: string, lesson: string): QuizGrade[] {
  if (!isValidSlug(classroom) || !isValidSlug(lesson)) return [];
  return listJsonFiles<QuizGrade>(gradesDir(classroom, lesson)).sort(
    (a, b) => a.gradedAt - b.gradedAt,
  );
}

/**
 * The newest grade for each submission. Read grades through this.
 *
 * Reason: a regrade writes a new file and keeps the old one. Scores, quiz state, and
 * review must all use the same revision. A revision is not a new learner attempt.
 */
export function latestGrades(classroom: string, lesson: string): QuizGrade[] {
  const latest = new Map<string, QuizGrade>();
  for (const grade of listGrades(classroom, lesson)) latest.set(grade.submissionId, grade);
  return [...latest.values()];
}

export function findSubmission(id: string): QuizSubmission | null {
  for (const { classroom, lesson } of allLessonRefs()) {
    const hit = listSubmissions(classroom, lesson).find((s) => s.id === id);
    if (hit) return hit;
  }
  return null;
}

export function writeGrade(grade: QuizGrade): void {
  writeJson(
    path.join(
      gradesDir(grade.classroom, grade.lesson),
      `${grade.gradedAt}-${grade.submissionId}.json`,
    ),
    grade,
  );
}

/** The latest attempt at one quiz in a lesson, its grade if it has one, and the attempt count. */
export interface QuizState {
  quizId: string;
  submission: QuizSubmission;
  grade: QuizGrade | null;
  attempts: number;
}

/**
 * The latest attempt at each quiz in a lesson, oldest quiz first.
 *
 * Reason: a lesson can hold several quizzes (a pretest and a check), so the page
 * rehydrates each form from its own latest attempt, not from the lesson's latest one.
 */
export function latestQuizStates(classroom: string, lesson: string): QuizState[] {
  const submissions = listSubmissions(classroom, lesson);
  const grades = latestGrades(classroom, lesson);
  const byQuiz = new Map<string, QuizSubmission[]>();
  for (const submission of submissions) {
    const list = byQuiz.get(submission.quizId);
    if (list) list.push(submission);
    else byQuiz.set(submission.quizId, [submission]);
  }
  return [...byQuiz.entries()].map(([quizId, list]) => {
    const submission = list[list.length - 1];
    return {
      quizId,
      submission,
      grade: grades.find((g) => g.submissionId === submission.id) ?? null,
      attempts: list.length,
    };
  });
}

/** The grade of the attempt before this one at the same quiz, when it was graded. */
export function previousGrade(submission: QuizSubmission): QuizGrade | null {
  const earlier = listSubmissions(submission.classroom, submission.lesson).filter(
    (s) => s.quizId === submission.quizId && s.submittedAt < submission.submittedAt,
  );
  const before = earlier[earlier.length - 1];
  if (!before) return null;
  return (
    latestGrades(submission.classroom, submission.lesson).find(
      (g) => g.submissionId === before.id,
    ) ?? null
  );
}
