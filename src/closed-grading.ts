/** Private assessment allocation merging. */
import type { QuizQuestionGrade } from "./store.ts";
export { machineGraded, gradeClosed } from "../assets/runtime/closed.mjs";

/** Teacher allocations cannot replace a saved machine allocation, even on a regrade. */
export function mergeGrades(
  fixed: QuizQuestionGrade[],
  teacher: QuizQuestionGrade[],
): QuizQuestionGrade[] {
  if (teacher.some((q) => fixed.some((saved) => saved.questionId === q.questionId)))
    throw new Error("Teacher grades must omit machine-graded questions.");
  return [...fixed, ...teacher];
}
