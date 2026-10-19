import type { QuestionType } from "./quiz.mjs";
import type { QuizAnswer } from "../../src/quiz.ts";
import type { RubricQuestion } from "../../src/rubric.ts";
import type { QuizQuestionGrade } from "../../src/store.ts";
export declare function machineGraded(type: QuestionType, entry: RubricQuestion): boolean;
export declare function gradeClosed(
  answer: QuizAnswer,
  entry: RubricQuestion,
): QuizQuestionGrade | null;
