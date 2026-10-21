import { lessonDir } from "../src/paths.ts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  startReview,
  currentReview,
  completePreparedReview,
  reviewSessions,
} from "../src/review-session.ts";
import { assembleReview, lessonPools } from "../src/review-pool.ts";
import { DAY_MS } from "../src/review.ts";
import { TeacherService } from "../src/teacher-service.ts";
import {
  makeFixture,
  seedClassroom,
  seedPreparedReviewSource,
  termAnswer,
  writeGradedAttempt,
} from "./helpers.ts";
import type { Fixture } from "./helpers.ts";
let fixture: Fixture;
beforeEach(() => {
  fixture = makeFixture();
  seedClassroom(fixture);
  seedPreparedReviewSource(fixture.root);
  writeGradedAttempt({
    at: Date.now() - 2 * DAY_MS,
    answers: [termAnswer("q1", "owner")],
    correct: { q1: true },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  fixture.cleanup();
});

it("saves the complete assembly before writes and rotates variants only for new reviews", () => {
  const first = startReview("rust", randomUUID(), "service").session;
  expect(first.variants).toEqual({ "001-ownership/check-1/q1": "v1" });
  expect(fs.existsSync(lessonDir("rust", first.lesson))).toBe(false);
  expect(startReview("rust", randomUUID(), "service").session.document).toEqual(first.document);
  // Publication must use the saved bytes, including after source edits.
  fixture.write("rust/001-ownership/quiz/key.json", "{}");
  completePreparedReview(first);
  expect(fs.readFileSync(path.join(lessonDir("rust", first.lesson), "lesson.html"), "utf8")).toBe(
    first.document!.lesson_html,
  );
  seedPreparedReviewSource(fixture.root);
  writeGradedAttempt({
    lesson: first.lesson,
    quizId: "review",
    kind: "review",
    at: Date.now() - 2 * DAY_MS,
    answers: [termAnswer("r1", "owner", { reviewOf: first.items[0].key })],
    correct: { r1: true },
  });
  expect(() => startReview("rust", randomUUID(), "service")).toThrow("allowance is reserved");
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + DAY_MS);
  const second = startReview("rust", randomUUID(), "service").session;
  expect(second.variants).toEqual({ "001-ownership/check-1/q1": "v2" });
  expect(reviewSessions("rust")).toHaveLength(2);
});

it("recovers a reserved service document without a model turn", async () => {
  const session = startReview("rust", randomUUID(), "service").session;
  const teacher = new TeacherService(async () => {
    throw new Error("Unexpected model turn");
  });
  teacher.attach("rust", "codex");
  await teacher.idle();
  await teacher.stop();
  expect(currentReview("rust")).toMatchObject({ id: session.id, status: "done" });
});

it("skips absent legacy pools but reports malformed declared pools and symlinks", () => {
  fs.unlinkSync(path.join(fixture.root, "rust/001-ownership/lesson.json"));
  fixture.write("rust/001-ownership/quiz/key.json", "{}");
  fixture.write("rust/001-ownership/quiz/plan.json", "{}");
  expect(() => startReview("rust", randomUUID(), "service")).toThrow("No prepared variants");
  expect(reviewSessions("rust")).toHaveLength(0);
  seedPreparedReviewSource(fixture.root);
  const key = path.join(fixture.root, "rust/001-ownership/quiz/key.json");
  const rubric = JSON.parse(fs.readFileSync(key, "utf8"));
  rubric["check-1"].q1.variants.pop();
  fs.writeFileSync(key, JSON.stringify(rubric));
  expect(() => startReview("rust", randomUUID(), "service")).toThrow("two or three");
  fs.unlinkSync(key);
  fs.symlinkSync(path.join(fixture.root, "rust/001-ownership/quiz/plan.json"), key);
  expect(() => lessonPools("rust", "001-ownership")).toThrow("symlink");
});

it("namespaces radio groups, labels and accessible references across selected questions", () => {
  const session = startReview("rust", randomUUID(), "service").session;
  const variant = lessonPools("rust", "001-ownership").get("check-1/q1")![0];
  const choice = {
    ...variant,
    html: '<li class="cl-q" data-question-id="v1" data-type="choice"><p id="prompt">Choose.</p><label for="answer">Owner</label><input id="answer" aria-labelledby="prompt" type="radio" name="answer" value="a"><input type="radio" name="answer" value="b"></li>',
    rubric: { ...variant.rubric, expected: "a" },
  };
  const document = assembleReview(
    [session.items[0], { ...session.items[0], key: "001-ownership/check-1/q2" }],
    [choice, choice],
  );
  for (const id of ["r1", "r2"]) {
    expect(document.lesson_html).toContain(`name="${id}-answer"`);
    expect(document.lesson_html).toContain(`for="${id}-answer"`);
    expect(document.lesson_html).toContain(`aria-labelledby="${id}-prompt"`);
  }
  expect(document.lesson_html).not.toContain("The new owner releases the value");
  expect(document.rubric_json).toContain('"expected":"a"');
});
