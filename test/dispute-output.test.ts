import { expect, it } from "vitest";
import { validateToolCall } from "@earendil-works/pi-ai";
import type { ToolCall } from "@earendil-works/pi-ai";
import { disputeOutputPlan, disputeOutputSchema } from "../src/dispute-output.ts";

const target = { id: "ed3084de-41f7-4725-b652-dc99f88150ac", questionId: "exact", machine: true };
const output = {
  dispute_id: target.id,
  decision: "declined",
  question: null,
  message: "The original answer does not match the fixed key.",
};
function native(value: ToolCall["arguments"]) {
  return validateToolCall(
    [
      {
        name: "submit_teacher_plan",
        description: "",
        parameters: disputeOutputSchema(target) as any,
      },
    ],
    { type: "toolCall", id: "resolution", name: "submit_teacher_plan", arguments: value },
  );
}
it("binds machine resolutions to the dispute UUID and omits nullable transport fields from the canonical saved call", () => {
  expect(native(output)).toEqual(output);
  const plan = disputeOutputPlan(output, target);
  expect(JSON.parse(plan.calls[0].arguments_json)).toEqual({
    dispute_id: target.id,
    decision: "declined",
  });
  expect(plan).toMatchObject({ message: output.message, learning_record: "", notes_markdown: "" });
});
it.each([`dispute:${target.id}`, "previous-dispute", "submission-id"])(
  "rejects wrong identity %s in both native schema and host decoder",
  (id) => {
    const wrong = { ...output, dispute_id: id };
    expect(() => native(wrong)).toThrow();
    expect(() => disputeOutputPlan(wrong, target)).toThrow(/exact saved dispute id/);
    expect(wrong.dispute_id).toBe(id);
  },
);
it.each([
  { ...output, decision: "accepted" },
  { ...output, question: { question_id: "exact" } },
  { ...output, calls: [] },
  { ...output, message: " " },
])("rejects machine overrides, extra envelopes and missing responses", (value) => {
  expect(() => native(value)).toThrow();
  expect(() => disputeOutputPlan(value, target)).toThrow();
});
it("requires the saved target and only permits the disputed judgment question", () => {
  expect(() => disputeOutputSchema(undefined)).toThrow(/saved dispute/);
  const judgment = { ...target, machine: false };
  expect(() =>
    disputeOutputPlan(
      { ...output, decision: "accepted", question: { question_id: "neighbor" } },
      judgment,
    ),
  ).toThrow(/exact disputed question/);
});
