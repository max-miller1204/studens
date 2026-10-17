import { expect, it } from "vitest";
import type { ClassroomTool } from "../src/tools.ts";
import { scoredAnswers, answerGradingTool, GRADE_ANSWERS } from "../src/teacher-grading.ts";

const answers = () => ({
  submission_id: "weighted",
  feedback_markdown: "Review the averaging step.",
  questions: [
    [4, 4],
    [2, 4],
    [2, 2],
    [2, 2],
    [2, 2],
    [2, 2],
  ].map(([earned, possible], i) => ({
    question_id: `q${i}`,
    correct: earned === possible,
    points_earned: earned,
    points_possible: possible,
    feedback: "Feedback.",
  })),
});

it("calculates the weighted total without changing the model's point allocations", () => {
  const args = answers();
  const before = structuredClone(args);
  expect(scoredAnswers(args)).toEqual({ ...before, score: 87.5 });
  expect(args).toEqual(before);
});

it("rejects a supplied score even when its value is undefined", () => {
  const supplied = { ...answers(), score: undefined };
  expect(() => scoredAnswers(supplied)).toThrow("must omit score");
});

it("keeps correctness and point bounds mandatory", () => {
  const args = answers();
  args.questions[1].correct = true;
  expect(() => scoredAnswers(args)).toThrow("correct must mean full credit");
  args.questions[1].correct = false;
  args.questions[1].points_earned = 5;
  expect(() => scoredAnswers(args)).toThrow("Invalid points");
});

it("rejects malformed question collections with a specific error", () => {
  expect(() => scoredAnswers({ ...answers(), questions: null as never })).toThrow(/question/);
});

it("requires the public grading operation before creating a score-free adapter", () => {
  expect(() => answerGradingTool({ name: "other" } as ClassroomTool)).toThrow(/grading tool/);
});

it("isolates the score-free schema and forwards computed points through the public tool", async () => {
  const received: unknown[] = [];
  const saved = { content: [{ type: "text" as const, text: "Saved." }], details: { saved: true } };
  const tool: ClassroomTool = {
    name: "grade_lesson_quiz",
    label: "Grade",
    description: "Public grading.",
    parameters: {
      type: "object",
      properties: { score: { type: "number" }, submission_id: { type: "string" } },
      required: ["score", "submission_id"],
      additionalProperties: true,
    },
    async execute(args) {
      received.push(args);
      return saved;
    },
  };
  const parameters = structuredClone(tool.parameters);
  const adapted = answerGradingTool(tool);
  expect(adapted.name).toBe(GRADE_ANSWERS);
  expect(adapted.label).toBe(tool.label);
  expect(adapted.description).toBeTruthy();
  expect(adapted.parameters).toMatchObject({
    required: ["submission_id"],
    additionalProperties: false,
  });
  expect(adapted.parameters.properties).not.toHaveProperty("score");
  const args = answers();
  expect(await adapted.execute(args)).toBe(saved);
  expect(received).toEqual([{ ...args, score: 87.5 }]);
  (adapted.parameters.properties as Record<string, unknown>).submission_id = { type: "number" };
  expect(tool.parameters).toEqual(parameters);
  expect(args).not.toHaveProperty("score");
});
