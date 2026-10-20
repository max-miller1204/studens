import * as fs from "node:fs";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { lessonModelPlan } from "../src/lesson-output.ts";
import { dedicatedTeacherPrompt } from "../src/prompts.ts";
import {
  nextLessonPrompt,
  piLessonArguments,
  piLessonDocument,
  startLessonRequest,
  validateLessonDocument,
} from "../src/next-lesson.ts";
import { makeFixture, seedClassroom, seedPreparedReviewSource } from "./helpers.ts";
import { nextLessonDocument } from "./next-lesson-fixture.ts";
import { lessonOutput } from "./lesson-output-fixture.ts";
import { stageLesson } from "../src/pretest.ts";
import { validateFaded } from "../assets/runtime/faded.mjs";

const template = fs.readFileSync(
  new URL("../assets/templates/faded.html", import.meta.url),
  "utf8",
);
const widget = template.slice(template.indexOf('<section class="cl-faded"'));

it("preserves public practice through strict service/Pi serialization and private assessment validation", () => {
  const f = makeFixture();
  try {
    seedClassroom(f);
    seedPreparedReviewSource(f.root);
    const document = nextLessonDocument(f.root);
    document.lesson_html = document.lesson_html.replace("</template>", `${widget}</template>`);
    const plan = lessonModelPlan(lessonOutput(document));
    const decoded = JSON.parse(plan.calls[0].arguments_json);
    expect(decoded.lesson_html).toBe(document.lesson_html);
    expect(JSON.parse(decoded.rubric_json)).toEqual(JSON.parse(document.rubric_json));
    expect(JSON.parse(decoded.teaching_plan_json)).toEqual(JSON.parse(document.teaching_plan_json));
    expect(piLessonDocument(piLessonArguments(document))).toEqual(document);
    expect(() => validateLessonDocument(decoded)).not.toThrow();
    expect(stageLesson(decoded.lesson_html, new Set()).html).not.toContain("data-cl-faded");
    const released = stageLesson(decoded.lesson_html, new Set(["pretest-1"])).html;
    const configuration = JSON.parse(
      /<script[^>]*data-cl-faded[^>]*>([\s\S]*?)<\/script>/.exec(released)![1],
    );
    expect(validateFaded(configuration).rounds).toHaveLength(4);
    expect(Object.keys(JSON.parse(decoded.rubric_json))).toEqual(
      Object.keys(JSON.parse(document.rubric_json)),
    );
    expect(plan.learning_record).toBe("");
    expect(plan.notes_markdown).toBe("");
  } finally {
    f.cleanup();
  }
});

it("supplies the complete public widget contract inline only to explicit lesson authoring", () => {
  const f = makeFixture();
  try {
    seedClassroom(f);
    const request = startLessonRequest(
      "rust",
      randomUUID(),
      "A procedural lesson",
      "codex",
      "service",
    );
    for (const host of ["service", "pi"] as const) {
      const prompt = nextLessonPrompt(request, host);
      expect(prompt).toContain(template);
      expect(prompt).toContain("data-cl-after-pretest");
    }
    const ordinary = dedicatedTeacherPrompt("ordinary", "A learner reply", {}, []);
    expect(ordinary).not.toContain(template);
    expect(ordinary).not.toContain("data-cl-faded");
  } finally {
    f.cleanup();
  }
});
