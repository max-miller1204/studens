import { refillRequests } from "../src/review-refill.ts";
import { completeClosedSubmission } from "../src/quiz-grading.ts";
import { TeacherService } from "../src/teacher-service.ts";
import { readTeacherState } from "../src/service-state.ts";
import { ClassroomBridge } from "../src/bridge.ts";
import { piResumes } from "../src/teacher-resume.ts";
import { afterEach, beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { lessonDir } from "../src/paths.ts";
import { authoredQuizzes } from "../src/quiz-authoring.ts";
import {
  startReview,
  completePreparedReview,
  resumableReview,
  currentReview,
} from "../src/review-session.ts";
import { DAY_MS } from "../src/review.ts";
import * as server from "../src/server.ts";
import * as store from "../src/store.ts";
import {
  closeReviewVariants,
  refillPlan,
  makeFixture,
  seedClassroom,
  seedPreparedReviewSource,
  termAnswer,
  writeGradedAttempt,
  type Fixture,
} from "./helpers.ts";
let fixture: Fixture;
beforeEach(() => {
  fixture = makeFixture();
  seedClassroom(fixture);
  seedPreparedReviewSource(fixture.root, "rust", "001-ownership", "check-1", ["q1", "q2"]);
  closeReviewVariants(fixture.root);
  writeGradedAttempt({
    at: Date.now() - 2 * DAY_MS,
    answers: [termAnswer("q1", "owner"), termAnswer("q2", "owner")],
    correct: { q1: true, q2: true },
  });
});
afterEach(async () => {
  await server.close();
  fixture.cleanup();
});

it("keeps each card's rubric and completion durable without completing the remaining cards", () => {
  const session = startReview("rust", randomUUID(), "pi").session;
  const quizzes = authoredQuizzes(session.document!.lesson_html);
  expect(quizzes.map((quiz) => quiz.questions.length)).toEqual([1, 1]);
  const rubric = JSON.parse(session.document!.rubric_json);
  expect(Object.keys(rubric)).toEqual(quizzes.map((quiz) => quiz.id));
  completePreparedReview(session);
  expect(lessonDir("rust", session.lesson)).toBe(
    path.join(fixture.root, "rust/.reviews", session.lesson),
  );
  expect(store.listLessonDirs("rust")).toContain(session.lesson);
  expect(store.readClassroom("rust")!.lessonCount).toBe(1);
  writeGradedAttempt({
    lesson: session.lesson,
    quizId: "review",
    kind: "review",
    at: Date.now(),
    answers: [termAnswer("r1", "owner", { reviewOf: session.items[0].key })],
    correct: { r1: true },
  });
  expect(resumableReview(currentReview("rust")!)).toBe(true);
  expect(startReview("rust", randomUUID(), "pi").session.id).toBe(session.id);
  writeGradedAttempt({
    lesson: session.lesson,
    quizId: "review-2",
    kind: "review",
    at: Date.now() + 10,
    answers: [termAnswer("r2", "owner", { reviewOf: session.items[1].key })],
    correct: { r2: true },
  });
  expect(resumableReview(currentReview("rust")!)).toBe(false);
  expect(store.reviewItems("rust").map((item) => item.attempts)).toEqual([2, 2]);
});

it("guards review history ancestors and rejects private files on canonical and legacy routes", async () => {
  const session = startReview("rust", randomUUID(), "pi").session;
  completePreparedReview(session);
  const base = await server.start(0);
  for (const prefix of [`/c/rust/reviews/${session.lesson}`, `/c/rust/${session.lesson}`]) {
    expect((await fetch(base + prefix)).status).toBe(200);
    for (const file of ["quiz/key.json", "quiz/plan.json", "lesson.json", "drafts.json"])
      expect((await fetch(`${base}${prefix}/${file}`)).status).toBe(404);
  }
  const history = path.join(fixture.root, "rust/.reviews");
  const moved = path.join(fixture.root, "saved-review-history");
  fs.renameSync(history, moved);
  fs.symlinkSync(moved, history, "dir");
  expect((await fetch(`${base}/c/rust/reviews/${session.lesson}`)).status).toBe(404);
});

it("keeps review panel replies durable behind an active Pi origin", () => {
  const session = startReview("rust", randomUUID(), "pi").session;
  completePreparedReview(session);
  const sent: string[] = [];
  const bridge = new ClassroomBridge({ sendUserMessage: (text) => sent.push(text) });
  bridge.noteForeignTurn();
  const id = randomUUID();
  bridge.chat("rust", session.lesson, "The current owner releases it.", id);
  bridge.chat("rust", session.lesson, "The current owner releases it.", id);
  expect(sent).toHaveLength(0);
  expect(piResumes("rust")).toHaveLength(1);
  bridge.onAgentEnd([
    { role: "assistant", content: [{ type: "text", text: "Background output" }] },
  ]);
  expect(sent).toHaveLength(1);
  expect(
    store.listPanelMessages("rust", session.lesson).filter((message) => message.role === "teacher"),
  ).toHaveLength(0);
  bridge.onAgentEnd([{ role: "assistant", content: [{ type: "text", text: "Correct owner." }] }]);
  expect(store.listPanelMessages("rust", session.lesson).map((message) => message.text)).toEqual([
    "The current owner releases it.",
    "Correct owner.",
  ]);
  expect(piResumes("rust")[0].status).toBe("done");
  bridge.reset();
});

it("recovers a closed miss after the grade save and gives each missed card one corrective request", async () => {
  const session = startReview("rust", randomUUID(), "service").session;
  completePreparedReview(session);
  // Stop between the code-owned grade and the correction enqueue.
  server.setHooks({
    onAsk: () => {},
    onFollowUp: () => {},
    onQuizSubmit: () => {},
    onReflect: () => {},
  });
  const first = store.createSubmission({
    classroom: "rust",
    lesson: session.lesson,
    quizId: "review",
    quizTitle: "First card",
    kind: "review",
    answers: [
      {
        questionId: "r1",
        type: "choice",
        prompt: "Who releases it?",
        value: "old",
        label: "The old binding",
        reviewOf: session.items[0].key,
      },
    ],
  });
  completeClosedSubmission(first);
  let turns = 0;
  const teacher = new TeacherService(async (_identity, prompt) => {
    if (prompt.includes("Background private review refill"))
      return refillPlan(refillRequests("rust").find((request) => request.status === "running")!);
    turns++;
    return {
      calls: [],
      message: "What does the new owner release?",
      learning_record: "",
      notes_markdown: "",
    };
  });
  teacher.attach("rust", "codex");
  await teacher.idle();
  expect(turns).toBe(1);
  const second = store.createSubmission({
    classroom: "rust",
    lesson: session.lesson,
    quizId: "review-2",
    quizTitle: "Second card",
    kind: "review",
    answers: [
      {
        questionId: "r2",
        type: "choice",
        prompt: "Who releases it?",
        value: "old",
        label: "The old binding",
        reviewOf: session.items[1].key,
      },
    ],
  });
  completeClosedSubmission(second);
  // Recovery discovers an already graded card even after another panel exchange.
  await teacher.stop();
  const restored = new TeacherService(async (_identity, prompt) => {
    if (prompt.includes("Background private review refill"))
      return refillPlan(refillRequests("rust").find((request) => request.status === "running")!);
    turns++;
    return {
      calls: [],
      message: "Which binding owns it now?",
      learning_record: "",
      notes_markdown: "",
    };
  });
  restored.restore();
  await restored.idle();
  expect(turns).toBe(2);
  const requests = readTeacherState("rust")!.requests.filter(
    (request) => request.kind === "resume",
  );
  expect(requests.map((request) => request.target)).toEqual([first.id, second.id]);
  expect(store.listGrades("rust", session.lesson)).toHaveLength(2);
  await restored.stop();
});
