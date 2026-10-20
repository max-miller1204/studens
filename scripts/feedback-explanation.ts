/** The explanation must belong to this question and be visible in its saved verdict. */
export interface VisibleQuestionFeedback {
  feedback: string;
  criteria?: Array<{ feedback: string }>;
}
export function questionFeedbackText(question: VisibleQuestionFeedback): string {
  return [
    question.feedback,
    ...(question.criteria ?? []).map((criterion) => criterion.feedback),
  ].join("\n");
}
export function hasQuestionExplanation(question: VisibleQuestionFeedback): boolean {
  return /2\.5|mean|averag|squar|divid/i.test(questionFeedbackText(question));
}
