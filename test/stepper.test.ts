import * as fs from "node:fs";
import { expect, it } from "vitest";
import { validateStepper, prefixSumSteps, parseStepperInput } from "../assets/runtime/stepper.mjs";
import { lessonModelPlan } from "../src/lesson-output.ts";
import { nextLessonDocument } from "./next-lesson-fixture.ts";
import { lessonOutput } from "./lesson-output-fixture.ts";
import { makeFixture, seedClassroom, seedPreparedReviewSource } from "./helpers.ts";
import { piLessonDocument, piLessonArguments, validateLessonDocument } from "../src/next-lesson.ts";
import { stageLesson } from "../src/pretest.ts";
const template = fs.readFileSync(
  new URL("../assets/templates/stepper.html", import.meta.url),
  "utf8",
);
const widgets = template.slice(template.indexOf('<section class="cl-stepper cl-card-box"'));
const configs = [...widgets.matchAll(/<script[^>]*data-cl-stepper[^>]*>([\s\S]*?)<\/script>/g)].map(
  (m) => JSON.parse(m[1]),
);
it("declares four causal domains and preserves ordered state descriptions", () => {
  expect(configs.map((c) => validateStepper(c).domain)).toEqual([
    "process",
    "state-machine",
    "pipeline",
    "algorithm",
  ]);
  expect(
    configs.slice(0, 3).every((c) => c.steps.length === 3 && c.steps[0].state !== c.steps[2].state),
  ).toBe(true);
});
it("computes prefix state from input with bounded exact integers", () => {
  const steps = prefixSumSteps([3, -2, 7]);
  expect(steps.map((s) => /Sum: (-?\d+)/.exec(s.state)![1])).toEqual(["0", "3", "1", "8"]);
  expect(prefixSumSteps([0]).at(-1)!.state).toContain("Sum: 0");
  expect(parseStepperInput(" -100, 0, 100 ")).toEqual([-100, 0, 100]);
});
it.each([
  "",
  "1,",
  "1,,2",
  "1.5",
  "1e2",
  "1 2",
  "101",
  "-101",
  "0x10",
  "Infinity",
  "1,".repeat(12) + "1",
])("rejects malformed or unbounded input %s", (input) => {
  expect(() => parseStepperInput(input)).toThrow();
});
it("rejects unknown fields, mixed trace/computed results, unsupported algorithms and malformed state", () => {
  const base = configs[0];
  for (const invalid of [
    { ...base, version: 2 },
    { ...base, result: 3 },
    { ...base, mode: "execute" },
    { ...base, values: [1] },
    { ...base, steps: [] },
    { ...base, steps: Array(65).fill(base.steps[0]) },
    { ...base, steps: [{}, {}] },
    { ...configs[3], steps: base.steps },
    { ...configs[3], domain: "process" },
    { ...configs[3], values: [NaN] },
    { ...configs[3], values: [1.5] },
  ])
    expect(() => validateStepper(invalid)).toThrow();
});
it("preserves public widgets through typed producer, strict Pi serialization and private assessment contracts", () => {
  const f = makeFixture();
  try {
    seedClassroom(f);
    seedPreparedReviewSource(f.root);
    const document = nextLessonDocument(f.root);
    document.lesson_html = document.lesson_html.replace("</template>", widgets + "</template>");
    const plan = lessonModelPlan(lessonOutput(document));
    const decoded = JSON.parse(plan.calls[0].arguments_json);
    expect(decoded.lesson_html).toBe(document.lesson_html);
    expect(piLessonDocument(piLessonArguments(document))).toEqual(document);
    expect(() => validateLessonDocument(decoded)).not.toThrow();
    expect(JSON.parse(decoded.rubric_json)).toEqual(JSON.parse(document.rubric_json));
    expect(stageLesson(decoded.lesson_html, new Set()).html).not.toContain("data-cl-stepper");
    expect(stageLesson(decoded.lesson_html, new Set(["pretest-1"])).html).toContain(
      "data-cl-stepper",
    );
    expect(plan.learning_record).toBe("");
  } finally {
    f.cleanup();
  }
});
