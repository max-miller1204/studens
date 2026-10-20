/** Bind public browser code input to the authored assessment; never execute it here. */
import { parseCodeExercise, sameCodeJson } from "../assets/runtime/code.mjs";
import { questionErrors } from "../assets/runtime/quiz.mjs";
import { authoredQuestionShapes, authoredQuestions } from "./quiz-authoring.ts";
import { parseAnswer } from "./quiz.ts";
import type { QuizAnswer, QuizKind } from "./quiz.ts";

export function validateCodeQuestions(
  html: string,
  meta: { assessmentContract?: number; criterionContract?: number } | null,
): void {
  if (!authoredQuestions(html).some((q) => q.type === "code")) return;
  for (const shape of authoredQuestionShapes(html, true).filter((q) => q.type === "code")) {
    if (meta?.assessmentContract !== 1 || meta.criterionContract !== 1)
      throw new Error("Code questions require assessmentContract: 1 and criterionContract: 1.");
    const errors = questionErrors(shape);
    if (errors.length)
      throw new Error(`Code question ${shape.quizId}/${shape.id}: ${errors.join(" ")}`);
  }
}

export function bindCodeAnswers(
  html: string,
  quizId: string,
  kind: QuizKind,
  answers: QuizAnswer[],
): QuizAnswer[] {
  if (!answers.some((a) => a.type === "code")) return answers;
  const shapes = authoredQuestionShapes(html, true).filter((q) => q.quizId === quizId);
  return answers.map((answer) => {
    if (answer.type !== "code") return answer;
    const shape = shapes.find((q) => q.id === answer.questionId && q.type === "code");
    if (!shape) throw new Error(`No authored code question ${quizId}/${answer.questionId}.`);
    const parsed = parseAnswer(answer, kind);
    const exercise = parseCodeExercise(shape.code);
    if (!sameCodeJson(parsed.code!.exercise, exercise))
      throw new Error(
        `Public code tests changed for ${quizId}/${answer.questionId}. Reload and explicitly submit again.`,
      );
    return { ...parsed, code: { ...parsed.code!, exercise } };
  });
}
