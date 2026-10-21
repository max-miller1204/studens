/**
 * Report how well semantic evaluation detects bad content despite valid mappings.
 * The fixed lesson has four known defects. The score is a calibration report, not a
 * verdict: judge models vary between runs. Only an evaluator error fails the run.
 */
import { correctnessFixture } from "./correctness-fixtures.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import { makeFixture } from "../test/helpers.ts";
import { authoredVariants } from "../src/review-variants.ts";
import { parseTeachingPlan } from "../src/teaching-plan.ts";
import { evaluateContent } from "./authoring-evaluator.ts";
import { parseHarness, useTestModel } from "./harness.ts";
const backend = parseHarness(
  process.argv[2],
  "Usage: node scripts/e2e-quality.ts <claude|codex> [artifacts] [none|visible-key|variant-key]",
);
const artifacts = process.argv[3] ? path.resolve(process.argv[3]) : null;
if (artifacts) fs.mkdirSync(artifacts); // Keep every prior report.
const fixture = makeFixture();
const objective = "Calculate mean squared error and explain how large errors affect it.";
const plan = JSON.stringify({
  version: 1,
  objectives: { cost: { statement: objective, application: true } },
  quizzes: {
    pre: {
      purpose: "prequestion",
      questions: {
        p1: {
          objective: "cost",
          task: "prediction",
          support: "independent",
          teaching: "cost-teaching",
        },
      },
    },
    check: {
      purpose: "assessment",
      questions: { q1: { objective: "cost", task: "transfer", support: "independent" } },
    },
  },
});
const html = `<h1>Mean squared error</h1><form class="cl-quiz" data-quiz-id="pre" data-kind="pretest"><li class="cl-q" data-question-id="p1" data-type="short"><p class="cl-q-prompt">What is an operating system process?</p><textarea></textarea></li></form>
<template data-cl-after-pretest="pre"><section id="cost-teaching"><p>Mean squared error is the sum of squared residuals divided by their count. With residuals 2 and -1, the mean is (4+1)/2=2.5.</p></section>
<form class="cl-quiz" data-quiz-id="check"><li class="cl-q" data-question-id="q1" data-type="term"><p class="cl-q-prompt">Copy the result from the example: with residuals 2 and -1, the mean squared error is ____.</p><input type="text"></li></form><!-- Expected answer: 2.5 --></template>`;
const rubric = JSON.stringify({
  pre: {
    p1: {
      expected: "A running program",
      points: 1,
      full: "A running program",
      partial: "0 otherwise",
    },
  },
  check: {
    q1: { expected: "2.5", points: 1, full: "Must exactly say 2.5", partial: "0 otherwise" },
  },
});
const selectedCase = process.argv[4];
if (selectedCase && !["none", "visible-key", "variant-key"].includes(selectedCase))
  throw new Error("Unknown correctness case.");
const evaluatorErrors: string[] = [];
const restoreModel = useTestModel(backend);
try {
  if (!selectedCase) {
    try {
      parseTeachingPlan(plan, html);
      const review = await evaluateContent(
        backend,
        fixture.root,
        { objective, mode: "lesson", html, rubric, plan },
        artifacts ? path.join(artifacts, `${backend}-quality-raw.json`) : undefined,
      );
      if (artifacts)
        fs.writeFileSync(
          path.join(artifacts, `${backend}-quality-report.json`),
          JSON.stringify(review, null, 2),
        );
      const expected = ["prequestion", "alignment", "retrievalTransfer", "answerCues"];
      const missed = expected.filter(
        (criterion) => review.judgments.find((j) => j.criterion === criterion)?.verdict !== "fail",
      );
      console.log(
        JSON.stringify(
          {
            backend,
            structurallyValid: true,
            setsVerdict: false,
            defectsDetected: `${expected.length - missed.length}/${expected.length}`,
            missedDefects: missed,
            judgments: review.judgments,
            humanLearningEvidence: false,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      evaluatorErrors.push(`alignment-control: ${String(error)}`);
      if (artifacts)
        fs.writeFileSync(
          path.join(artifacts, `${backend}-quality-error.json`),
          JSON.stringify({ error: String(error), setsVerdict: true }, null, 2),
        );
    }
  }
  // Fixed positive and negative controls expose false reassurance from correct metadata.
  for (const defect of ["none", "visible-key", "variant-key"] as const) {
    if (selectedCase && defect !== selectedCase) continue;
    const content = correctnessFixture(defect);
    authoredVariants(content.rubric, content.plan, content.html, true);
    try {
      parseTeachingPlan(content.plan, content.html);
      const reviewed = await evaluateContent(
        backend,
        fixture.root,
        content,
        artifacts ? path.join(artifacts, `${backend}-correctness-${defect}-raw.json`) : undefined,
      );
      const judgment = reviewed.judgments.find((j) => j.criterion === "correctness")!;
      const report = {
        defect,
        expectedVerdict: defect === "none" ? "pass" : "fail",
        matched: judgment.verdict === (defect === "none" ? "pass" : "fail"),
        setsVerdict: false,
        humanLearningEvidence: false,
        judgment,
      };
      if (artifacts)
        fs.writeFileSync(
          path.join(artifacts, `${backend}-correctness-${defect}.json`),
          JSON.stringify(report, null, 2),
        );
      console.log(JSON.stringify(report, null, 2));
    } catch (error) {
      evaluatorErrors.push(`${defect}: ${String(error)}`);
      if (artifacts)
        fs.writeFileSync(
          path.join(artifacts, `${backend}-correctness-${defect}-error.json`),
          JSON.stringify({ error: String(error), setsVerdict: true }, null, 2),
        );
    }
  }
  if (evaluatorErrors.length) throw new Error(evaluatorErrors.join("\n"));
} finally {
  fixture.cleanup();
  restoreModel();
}
