import { expect, it } from "vitest";
import { hasQuestionExplanation, questionFeedbackText } from "../scripts/feedback-explanation.ts";

it("accepts the retained Claude question's visible criterion explanations", () => {
  const question = {
    feedback:
      "Full credit. Your method is correct, so the unsure rating did not change the grade. Keep using this method.",
    criteria: [
      { feedback: "The term (4+1) shows you squared each residual and added the results." },
      { feedback: "Dividing the sum by 2 gives 2.5, which is the correct mean squared error." },
    ],
  };
  expect(hasQuestionExplanation(question)).toBe(true);
  expect(questionFeedbackText(question)).toContain(question.criteria[0].feedback);
  expect(questionFeedbackText(question)).toContain(question.criteria[1].feedback);
});

it.each([
  { feedback: "Correct. Full credit." },
  {
    feedback: "Your method is correct. Keep using it.",
    criteria: [{ feedback: "Met." }, { feedback: "Full credit." }],
  },
  { feedback: "Correct.", criteria: [{ feedback: "" }, { feedback: "" }] },
])("still refuses feedback without an explanation: %j", (question) => {
  expect(hasQuestionExplanation(question)).toBe(false);
});

it("does not use descriptions, labels, or a neighboring answer as this question's explanation", () => {
  const question = {
    feedback: "Correct.",
    criteria: [{ criterion_id: "mean", description: "Divide the squared sum", feedback: "Met." }],
  };
  const neighbor = { feedback: "Squaring and averaging gives 2.5." };
  expect(hasQuestionExplanation(neighbor)).toBe(true);
  expect(hasQuestionExplanation(question)).toBe(false);
  expect(questionFeedbackText(question)).toBe("Correct.\nMet.");
});
