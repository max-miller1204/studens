import { expect, it } from "vitest";
import { FEEDBACK_CRITERIA, parseFeedbackJudgments } from "../scripts/feedback-evaluation.ts";

const content = {
  assessment: "Original question.\nSaved answer.",
  response: "New task. Wait for a reply.",
};
const judgments = () =>
  Object.keys(FEEDBACK_CRITERIA).map((criterion) => ({
    criterion,
    verdict: "fail",
    assessmentQuote: "Original question. Saved answer.",
    responseQuote: "New task.",
    reason: "Compare the original task with its correction.",
  }));
it("requires complete distinct judgments bound to both original assessment and teacher response", () => {
  expect(parseFeedbackJudgments(JSON.stringify(judgments()), content)).toHaveLength(4);
  for (const field of ["assessmentQuote", "responseQuote"] as const) {
    const invented = judgments();
    invented[0][field] = "Invented evidence";
    expect(() => parseFeedbackJudgments(JSON.stringify(invented), content)).toThrow(
      `quotes no supplied ${field}`,
    );
    const swapped = judgments();
    swapped[0][field] = field === "assessmentQuote" ? "New task." : "Original question.";
    expect(() => parseFeedbackJudgments(JSON.stringify(swapped), content)).toThrow(
      `quotes no supplied ${field}`,
    );
  }
  expect(() => parseFeedbackJudgments(JSON.stringify(judgments().slice(1)), content)).toThrow(
    "every criterion",
  );
  const duplicate = judgments();
  duplicate[1] = duplicate[0];
  expect(() => parseFeedbackJudgments(JSON.stringify(duplicate), content)).toThrow(
    "unique criterion",
  );
});
