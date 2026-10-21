import { expect, it } from "vitest";
import { validateToolCall } from "@earendil-works/pi-ai";
import { refillOutputSchema, refillOutputPlan } from "../src/refill-output.ts";
import { planSchema } from "../src/teacher.ts";
import { simpleLessonOutput } from "./lesson-output-fixture.ts";
const refillTarget = { classroom: "rust", requestId: "refill:exact", count: 1 as const };
const refillOutput = {
  classroom: "rust",
  request_id: "refill:exact",
  variants: [
    {
      id: "v3",
      html: '<li class="cl-q" data-question-id="v3" data-type="short"><pre>let x = "λ";\nC:\\temp</pre><p class="cl-q-prompt">Who owns it?</p><textarea></textarea></li>',
      rubric: simpleLessonOutput.quizzes[0].questions[0].rubric,
      task: "application",
    },
  ],
};
function native(value: any, count: 1 | 2 = 1) {
  return validateToolCall(
    [
      {
        name: "submit_teacher_plan",
        description: "",
        parameters: refillOutputSchema({ ...refillTarget, count }) as any,
      },
    ],
    { type: "toolCall", id: "refill", name: "submit_teacher_plan", arguments: value },
  );
}
it("serializes direct HTML exactly once into the existing private refill call", () => {
  expect(native(refillOutput)).toEqual(refillOutput);
  const plan = refillOutputPlan(refillOutput, refillTarget);
  const args = JSON.parse(plan.calls[0].arguments_json);
  expect(args.variants[0].html).toBe(refillOutput.variants[0].html);
  expect(args.variants[0].plan).toEqual({
    objective: "original",
    support: "independent",
    task: "application",
  });
  expect(plan).toMatchObject({ message: "", learning_record: "", notes_markdown: "" });
  expect(
    planSchema({ operations: ["save_review_variants"], response: "review-variants", refillTarget }),
  ).toEqual(refillOutputSchema(refillTarget));
});
it.each([
  { ...refillOutput, request_id: "exact" },
  { ...refillOutput, classroom: "neighbor" },
  { ...refillOutput, variants: [] },
  {
    ...refillOutput,
    variants: [...refillOutput.variants, { ...refillOutput.variants[0], id: "v4" }],
  },
  { ...refillOutput, calls: [] },
  {
    calls: [{ name: "save_review_variants", arguments_json: '{"html":"line\nbreak"}' }],
    message: "",
    learning_record: null,
    notes_markdown: "",
  },
])("rejects wrong identities, count and canonical envelopes without fixing output", (value) => {
  const before = structuredClone(value);
  expect(() => native(value)).toThrow();
  expect(() => refillOutputPlan(value, refillTarget)).toThrow();
  expect(value).toEqual(before);
});
it("requires two distinct variants for low pools and no caller-supplied objective policy", () => {
  const target = { ...refillTarget, count: 2 as const };
  const value = {
    ...refillOutput,
    variants: [refillOutput.variants[0], { ...refillOutput.variants[0], id: "v4" }],
  };
  expect(() => native(value, 2)).not.toThrow();
  expect(() => refillOutputPlan(value, target)).not.toThrow();
  value.variants[1].id = "v3";
  expect(() => refillOutputPlan(value, target)).toThrow(/unique/);
  const wrong = structuredClone(refillOutput) as any;
  wrong.variants[0].plan = { objective: "neighbor", support: "assisted" };
  expect(() => native(wrong)).toThrow();
  expect(() => refillOutputPlan(wrong, refillTarget)).toThrow();
});
