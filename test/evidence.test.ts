import { expect, it } from "vitest";
import { evidenceContext, independent } from "../src/evidence.ts";
import type { PerformanceEvidence } from "../src/evidence.ts";

const evidence: PerformanceEvidence = {
  objectiveId: "ownership",
  objective: { statement: "Explain ownership", application: true },
  task: "retrieval",
  support: "independent",
  assistance: "none",
};
const DAY = 86_400_000;

it.each([
  ["missing history", undefined, "unknown"],
  ["unknown help", { ...evidence, assistance: "unknown" }, "unknown"],
  ["hint", { ...evidence, assistance: "hint" }, "assisted"],
  ["solution", { ...evidence, assistance: "solution" }, "assisted"],
  ["authored support", { ...evidence, support: "assisted" }, "assisted"],
] as const)("keeps %s out of independent evidence", (_name, value, context) => {
  expect(independent(value)).toBe(false);
  expect(evidenceContext(value, DAY)).toBe(context);
});

it.each([
  [DAY - 1, "immediate-independent", "immediate-independent"],
  [DAY, "delayed-retrieval", "delayed-transfer"],
] as const)("classifies independent performance after %i ms", (elapsed, retrieval, transfer) => {
  expect(independent(evidence)).toBe(true);
  expect(evidenceContext(evidence, elapsed)).toBe(retrieval);
  expect(evidenceContext({ ...evidence, task: "transfer" }, elapsed)).toBe(transfer);
});
