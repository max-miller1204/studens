import { lessonDir } from "../src/paths.ts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { ClassroomBridge } from "../src/bridge.ts";
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
  const first = startReview("rust", randomUUID(), "pi").session;
  expect(first.variants).toEqual({ "001-ownership/check-1/q1": "v1" });
  expect(fs.existsSync(lessonDir("rust", first.lesson))).toBe(false);
  expect(startReview("rust", randomUUID(), "pi").session.document).toEqual(first.document);
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
  expect(() => startReview("rust", randomUUID(), "pi")).toThrow("allowance is reserved");
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + DAY_MS);
  const second = startReview("rust", randomUUID(), "pi").session;
  expect(second.variants).toEqual({ "001-ownership/check-1/q1": "v2" });
  expect(reviewSessions("rust")).toHaveLength(2);
});

it.each(["pi", "service"] as const)(
  "recovers a reserved %s document without a model turn",
  async (owner) => {
    const session = startReview("rust", randomUUID(), owner).session;
    if (owner === "pi") {
      const bridge = new ClassroomBridge({
        sendUserMessage: () => {
          throw new Error("Unexpected model turn");
        },
      });
      bridge.restoreReviews();
      bridge.reset();
    } else {
      const teacher = new TeacherService(async () => {
        throw new Error("Unexpected model turn");
      });
      teacher.attach("rust", "codex");
      await teacher.idle();
      await teacher.stop();
    }
    expect(currentReview("rust")).toMatchObject({ id: session.id, status: "done" });
  },
);

it("skips absent legacy pools but reports malformed declared pools and symlinks", () => {
  fs.unlinkSync(path.join(fixture.root, "rust/001-ownership/lesson.json"));
  fixture.write("rust/001-ownership/quiz/key.json", "{}");
  fixture.write("rust/001-ownership/quiz/plan.json", "{}");
  expect(() => startReview("rust", randomUUID(), "pi")).toThrow("No prepared variants");
  expect(reviewSessions("rust")).toHaveLength(0);
  seedPreparedReviewSource(fixture.root);
  const key = path.join(fixture.root, "rust/001-ownership/quiz/key.json");
  const rubric = JSON.parse(fs.readFileSync(key, "utf8"));
  rubric["check-1"].q1.variants.pop();
  fs.writeFileSync(key, JSON.stringify(rubric));
  expect(() => startReview("rust", randomUUID(), "pi")).toThrow("two or three");
  fs.unlinkSync(key);
  fs.symlinkSync(path.join(fixture.root, "rust/001-ownership/quiz/plan.json"), key);
  expect(() => lessonPools("rust", "001-ownership")).toThrow("symlink");
});

it("namespaces radio groups, labels and accessible references across selected questions", () => {
  const session = startReview("rust", randomUUID(), "pi").session;
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

it("reads legacy original numeric rubrics but keeps optional modern pools and all variants strict", () => {
  const root = "rust/001-ownership/";
  const htmlFile = path.join(fixture.root, root, "lesson.html");
  const html = fs
    .readFileSync(htmlFile, "utf8")
    .replace('data-type="short"', 'data-type="numeric"')
    .replace("<textarea></textarea>", '<input class="cl-number" type="number">');
  fixture.write(root + "lesson.html", html);
  fixture.write(root + "lesson.json", JSON.stringify({ title: "Legacy", createdAt: 2 }));
  expect(lessonPools("rust", "001-ownership").get("check-1/q1")).toHaveLength(2);
  // Requiring pools is independent of the assessment format.
  expect(lessonPools("rust", "001-ownership", true).size).toBe(1);
  fixture.write(
    root + "lesson.json",
    JSON.stringify({ title: "Modern", createdAt: 2, assessmentContract: 1 }),
  );
  expect(() => lessonPools("rust", "001-ownership", false)).toThrow(
    "Invalid machine-checkable expected answer for numeric",
  );
  fixture.write(root + "lesson.json", JSON.stringify({ title: "Legacy", createdAt: 2 }));
  const keyFile = path.join(fixture.root, root, "quiz/key.json");
  const key = JSON.parse(fs.readFileSync(keyFile, "utf8"));
  key["check-1"].q1.variants[0].html = key["check-1"].q1.variants[0].html
    .replace('data-type="short"', 'data-type="numeric"')
    .replace("<textarea></textarea>", '<input class="cl-number" type="number">');
  fixture.write(root + "quiz/key.json", JSON.stringify(key));
  expect(() => lessonPools("rust", "001-ownership")).toThrow(
    "Invalid machine-checkable expected answer for numeric",
  );
});
