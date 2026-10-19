import type { QuestionShape, QuestionType } from "./quiz.mjs";
import type { QuizAnswer } from "../../src/quiz.ts";
import type { RubricQuestion } from "../../src/rubric.ts";
export interface PracticeKey {
  expected: unknown;
  correct: string;
  incorrect: string;
}
export declare function practiceEntry(type: QuestionType, entry: unknown): RubricQuestion;
export declare function practiceErrors(shapes: QuestionShape[], key: unknown): string[];
export declare function practiceFeedback(
  answer: QuizAnswer,
  entry: PracticeKey,
): {
  correct: boolean;
  feedback: string;
};
