import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { makeFixture, type Fixture } from "./helpers.ts";
import {
  preflightLessonInputs,
  readLessonInputs,
  sameLessonInputs,
} from "../scripts/lesson-inputs.ts";

let fixture: Fixture;
const prefix = "os/001-counts/";
const html = `<form class="cl-quiz" data-quiz-id="check" data-kind="check"><ol><li class="cl-q" data-question-id="q" data-type="numeric"><p class="cl-q-prompt">Count.</p><input class="cl-number" type="number"></li></ol></form>`;
const rubric = () => ({
  expected: { value: 2, tolerance: 0 },
  points: 1,
  full: "A count.",
  partial: "No count.",
  criteria: [{ id: "count", description: "Correct count.", points: 1 }],
});
const mapping = () => ({ objective: "original", task: "retrieval", support: "independent" });
function documents() {
  return {
    meta: {
      assessmentContract: 1,
      criterionContract: 1,
      instructionalContract: 1,
      reviewVariantContract: 1,
    },
    key: {
      check: {
        q: {
          ...rubric(),
          variants: ["v1", "v2"].map((id) => ({
            id,
            html: html
              .match(/<li.*<\/li>/)![0]
              .replace('data-question-id="q"', `data-question-id="${id}"`),
            rubric: rubric(),
          })),
        },
      },
    },
    plan: {
      version: 1,
      objectives: { count: { statement: "Count results.", application: false } },
      quizzes: {
        check: {
          purpose: "assessment",
          questions: {
            q: { ...mapping(), objective: "count", variants: { v1: mapping(), v2: mapping() } },
          },
        },
      },
    },
  };
}
function save(d = documents()) {
  fixture.write(prefix + "lesson.html", html);
  fixture.write(prefix + "lesson.json", JSON.stringify(d.meta));
  fixture.write(prefix + "quiz/key.json", JSON.stringify(d.key));
  fixture.write(prefix + "quiz/plan.json", JSON.stringify(d.plan));
  return d;
}
function preflight() {
  preflightLessonInputs(readLessonInputs("os", "001-counts"), "os", "001-counts");
}
beforeEach(() => {
  fixture = makeFixture();
  save();
});
afterEach(() => fixture.cleanup());

describe("saved authoring contract inputs", () => {
  it("validates current inputs without writing and hashes their exact bytes", () => {
    const before = readLessonInputs("os", "001-counts");
    preflight();
    expect(sameLessonInputs(before, readLessonInputs("os", "001-counts"))).toBe(true);
    for (const [name, hash] of Object.entries(before.hashes))
      expect(hash).toBe(
        createHash("sha256")
          .update(fs.readFileSync(path.join(fixture.root, prefix, name)))
          .digest("hex"),
      );
    expect(fs.readdirSync(path.join(fixture.root, prefix, "quiz"))).toEqual([
      "key.json",
      "plan.json",
    ]);
  });
  it("keeps missing legacy files optional and supports legacy HTML filenames", () => {
    for (const file of ["lesson.json", "quiz/key.json", "quiz/plan.json"])
      fs.unlinkSync(path.join(fixture.root, prefix, file));
    fs.renameSync(
      path.join(fixture.root, prefix, "lesson.html"),
      path.join(fixture.root, prefix, "lesson-001.html"),
    );
    preflight();
    expect(readLessonInputs("os", "001-counts").hashes["quiz/key.json"]).toBeNull();
    expect(readLessonInputs("os", "001-counts").htmlFile).toBe("lesson-001.html");
  });
  it("accepts a legacy prose key without claiming machine grading", () => {
    fixture.write(prefix + "lesson.json", "{}");
    fixture.write(
      prefix + "quiz/key.json",
      JSON.stringify({ check: { q: { ...rubric(), expected: "Two.", criteria: undefined } } }),
    );
    fs.unlinkSync(path.join(fixture.root, prefix, "quiz/plan.json"));
    preflight();
  });
  it.each([
    "assessmentContract",
    "criterionContract",
    "instructionalContract",
    "reviewVariantContract",
  ])("rejects unknown %s versions", (flag) => {
    fixture.write(prefix + "lesson.json", JSON.stringify({ [flag]: 2 }));
    expect(preflight).toThrow(/contract/i);
  });
  it.each(["assessmentContract", "criterionContract", "reviewVariantContract"])(
    "requires a key for %s alone",
    (flag) => {
      fixture.write(prefix + "lesson.json", JSON.stringify({ [flag]: 1 }));
      fs.unlinkSync(path.join(fixture.root, prefix, "quiz/key.json"));
      expect(preflight).toThrow("Missing required private rubric");
    },
  );
  it.each(["instructionalContract", "reviewVariantContract"])(
    "requires a plan for %s alone",
    (flag) => {
      fixture.write(prefix + "lesson.json", JSON.stringify({ [flag]: 1 }));
      fs.unlinkSync(path.join(fixture.root, prefix, "quiz/plan.json"));
      expect(preflight).toThrow("Missing required teaching plan");
    },
  );
  it.each(["lesson.json", "quiz/key.json", "quiz/plan.json"])(
    "refuses corrupt %s without quoting private input",
    (file) => {
      fixture.write(prefix + file, '{"secret-answer":PRIVATE-ANSWER');
      expect(preflight).toThrow(`Invalid JSON in ${file}.`);
      try {
        preflight();
      } catch (error) {
        expect(String(error)).not.toContain("PRIVATE-ANSWER");
      }
      fs.writeFileSync(path.join(fixture.root, prefix, file), Buffer.from([0x22, 0xff, 0x22]));
      expect(preflight).toThrow(`Invalid UTF-8 in ${file}.`);
      fixture.write(prefix + file, "[]");
      expect(preflight).toThrow("Expected a JSON object");
    },
  );
  it.each(["lesson.html", "lesson.json", "quiz/key.json", "quiz/plan.json", "quiz"])(
    "rejects a symlink at %s",
    (file) => {
      const target = path.join(fixture.root, prefix, file);
      fs.renameSync(target, target + ".saved");
      fs.symlinkSync(target + ".saved", target);
      expect(preflight).toThrow("symlink");
    },
  );
  it("detects every receipt input changing, including absent metadata appearing", () => {
    const before = readLessonInputs("os", "001-counts");
    for (const name of Object.keys(before.hashes)) {
      const file = path.join(fixture.root, prefix, name);
      const bytes = fs.readFileSync(file);
      fs.appendFileSync(file, " ");
      expect(sameLessonInputs(before, readLessonInputs("os", "001-counts"))).toBe(false);
      fs.writeFileSync(file, bytes);
    }
    fs.unlinkSync(path.join(fixture.root, prefix, "lesson.json"));
    const legacy = readLessonInputs("os", "001-counts");
    fixture.write(prefix + "lesson.json", "{}");
    expect(sameLessonInputs(legacy, readLessonInputs("os", "001-counts"))).toBe(false);
  });
  it("rejects the malformed numeric review variant even when public answers are valid", () => {
    const d = documents();
    Object.assign(d.key.check.q.variants[0].rubric, { expected: "PRIVATE-PROSE-ANSWER" });
    save(d);
    expect(preflight).toThrow(
      "Private rubric review/v1: Invalid machine-checkable expected answer for numeric.",
    );
  });
  it.each([
    "unknown-quiz",
    "unknown-question",
    "missing-question",
    "criteria",
    "variant-ids",
    "required-variants",
    "objective",
    "plan-version",
    "unknown-plan-question",
  ])("refuses %s mismatches", (kind) => {
    const d = documents();
    if (kind === "unknown-quiz") Object.assign(d.key, { unknown: {} });
    if (kind === "unknown-question") Object.assign(d.key.check, { unknown: rubric() });
    if (kind === "missing-question") delete (d.key.check as any).q;
    if (kind === "criteria") d.key.check.q.criteria[0].points = 2;
    if (kind === "variant-ids") d.key.check.q.variants[1].id = "other";
    if (kind === "required-variants") d.key.check.q.variants = [];
    if (kind === "objective") d.plan.quizzes.check.questions.q.objective = "unknown";
    if (kind === "plan-version") d.plan.version = 2;
    if (kind === "unknown-plan-question")
      Object.assign(d.plan.quizzes.check.questions, { unknown: mapping() });
    save(d);
    expect(preflight).toThrow();
  });
  it("validates declared optional variants on legacy metadata", () => {
    fixture.write(prefix + "lesson.json", "{}");
    const d = documents();
    d.key.check.q.variants[1].id = "other";
    fixture.write(prefix + "quiz/key.json", JSON.stringify(d.key));
    expect(preflight).toThrow("mismatched");
  });
});
