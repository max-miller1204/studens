import { correctnessFixture } from "../scripts/correctness-fixtures.ts";
import { authoredVariants } from "../src/review-variants.ts";
import { expect, it } from "vitest";
import {
  AUTHORING_CRITERIA,
  parseContentJudgments,
  type AuthoredContent,
} from "../src/authoring-evaluation.ts";
const content: AuthoredContent = {
  objective: "Apply cost",
  mode: "lesson",
  html: "<p>Predict cost on new data.</p>",
  rubric: "Accept equivalent valid methods.",
  plan: "Objective: cost",
};
const judgments = () =>
  Object.keys(AUTHORING_CRITERIA).map((criterion) => ({
    criterion,
    verdict: "pass",
    quote: "Predict cost on new data.",
    reason: "A concrete upcoming task.",
  }));
it("requires every semantic criterion and a supplied excerpt", () => {
  expect(parseContentJudgments(JSON.stringify(judgments()), content)).toHaveLength(
    Object.keys(AUTHORING_CRITERIA).length,
  );
  const invented = judgments();
  invented[0].quote = "An invented question";
  expect(() => parseContentJudgments(JSON.stringify(invented), content)).toThrow(
    "quotes no supplied source",
  );
  expect(() => parseContentJudgments(JSON.stringify(judgments().slice(1)), content)).toThrow(
    "every criterion",
  );
  const duplicate = judgments();
  duplicate[1] = duplicate[0];
  expect(() => parseContentJudgments(JSON.stringify(duplicate), content)).toThrow(
    "unique criterion",
  );
});

it("refuses an older review that omitted correctness, even when all other judgments pass", () => {
  const oldReview = judgments().filter((j) => j.criterion !== "correctness");
  expect(() => parseContentJudgments(JSON.stringify(oldReview), content)).toThrow(
    "every criterion",
  );
  const wrongKey = { ...content, rubric: "What is 2 + 3? Expected: 6." };
  const reviewed = judgments();
  reviewed.find((j) => j.criterion === "correctness")!.verdict = "fail";
  reviewed.find((j) => j.criterion === "correctness")!.quote = "Expected: 6.";
  expect(
    parseContentJudgments(JSON.stringify(reviewed), wrongKey).find(
      (j) => j.criterion === "correctness",
    )?.verdict,
  ).toBe("fail");
});

it.each(["none", "visible-key", "variant-key"] as const)(
  "keeps the %s arithmetic control structurally valid, including private pools",
  (defect) => {
    const fixture = correctnessFixture(defect);
    expect(
      authoredVariants(fixture.rubric, fixture.plan, fixture.html, true).get("check/q1"),
    ).toHaveLength(2);
  },
);
