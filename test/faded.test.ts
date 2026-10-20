import { describe, expect, it } from "vitest";
import { validateFaded } from "../assets/runtime/faded.mjs";
import { practiceFeedback } from "../assets/runtime/practice.mjs";

const config = () => ({
  version: 1,
  title: "Balance an equation",
  steps: [
    { title: "Undo addition", principle: "Why must both sides change?" },
    { title: "Undo multiplication", principle: "Why divide both sides?" },
  ],
  rounds: ["2x + 4 = 10", "3x + 6 = 18", "4x + 8 = 28"].map((situation, i) => ({
    situation,
    steps: [
      {
        prompt: "Explain the first operation.",
        solution: "Subtract the constant from both sides.",
        response: { type: "compare" },
      },
      {
        prompt: "Find x.",
        solution: `x = ${i + 3}`,
        response: {
          type: "numeric",
          expected: { value: i + 3 },
          correct: "Both sides were divided.",
          incorrect: "Undo multiplication on both sides.",
        },
      },
    ],
  })),
});

describe("public faded practice contract", () => {
  it("requires a full example and a new complete case for each handover", () => {
    expect(validateFaded(config()).rounds).toHaveLength(3);
    const missing = config();
    missing.rounds.pop();
    expect(() => validateFaded(missing)).toThrow("one new case per handed-over step");
    const repeated = config();
    repeated.rounds[1].situation = `  ${repeated.rounds[0].situation}  `;
    expect(() => validateFaded(repeated)).toThrow("different situation");
    const incomplete = config();
    incomplete.rounds[1].steps.pop();
    expect(() => validateFaded(incomplete)).toThrow("match the ordered steps");
  });
  it("refuses invented response contracts, malformed keys and spurious correctness on comparison", () => {
    const bad: any = config();
    bad.rounds[1].steps[1].response.type = "short";
    expect(() => validateFaded(bad)).toThrow("term, numeric, or compare");
    bad.rounds[1].steps[1].response = {
      type: "numeric",
      expected: { value: Infinity },
      correct: "ok",
      incorrect: "no",
    };
    expect(() => validateFaded(bad)).toThrow("Invalid machine-checkable");
    bad.rounds[1].steps[0].response.correct = "Looks right";
    expect(() => validateFaded(bad)).toThrow("cannot claim correctness");
    const extra: any = config();
    extra.rounds[0].steps[1].response.expected.hidden = true;
    expect(() => validateFaded(extra)).toThrow("unsupported fields: hidden");
    const noPrinciple: any = config();
    noPrinciple.steps[0].principle = " ";
    expect(() => validateFaded(noPrinciple)).toThrow("principle needs nonempty text");
  });
  it("retains the existing exact practice normalization and numeric unit contract", () => {
    const term = {
      expected: ["same operation", "equal changes"],
      correct: "Equality is preserved.",
      incorrect: "Apply it to both sides.",
    };
    expect(
      practiceFeedback({ questionId: "local", type: "term", value: " SAME   operation " }, term)
        .correct,
    ).toBe(true);
    const number = {
      expected: { value: 1, tolerance: 0.1, unit: "m" },
      correct: "Unit and magnitude match.",
      incorrect: "Check both.",
    };
    expect(
      practiceFeedback({ questionId: "local", type: "numeric", value: "1.1", unit: "m" }, number)
        .correct,
    ).toBe(true);
    expect(
      practiceFeedback(
        { questionId: "local", type: "numeric", value: "1.1junk", unit: "m" },
        number,
      ).correct,
    ).toBe(false);
    expect(
      practiceFeedback({ questionId: "local", type: "numeric", value: "1.1", unit: "cm" }, number)
        .correct,
    ).toBe(false);
  });
});
