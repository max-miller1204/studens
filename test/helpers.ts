/**
 * Shared fixture helpers: build a throwaway classrooms root on disk and point the
 * extension at it, so store/server tests exercise the real filesystem layout.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { lessonPools } from "../src/review-pool.ts";
import type { RefillRequest } from "../src/review-refill.ts";
import type { ReviewSession } from "../src/review-session.ts";

import { _overrideClassroomsDir, classroomsRoot, submissionsDir } from "../src/paths.ts";
import * as store from "../src/store.ts";
import { DAY_MS } from "../src/review.ts";
import { _overrideConfigPath } from "../src/config.ts";

export interface Fixture {
  root: string;
  /** Write a file beneath the classrooms root, creating parent directories. */
  write(relativePath: string, contents: string): string;
  cleanup(): void;
}

export function makeFixture(): Fixture {
  const previousRoot = process.env.PI_CLASSROOMS_DIR;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-classroom-test-"));
  process.env.PI_CLASSROOMS_DIR = root;
  _overrideClassroomsDir(root);
  // Mutations can disable path redirection. Fail before accessing classroom storage.
  if (classroomsRoot() !== root) {
    fs.rmSync(root, { recursive: true, force: true });
    throw new Error("Test classroom root was not redirected to its fixture.");
  }
  _overrideConfigPath(path.join(root, "test-config.json"));

  return {
    root,
    write(relativePath, contents) {
      const file = path.join(root, relativePath);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, contents, "utf8");
      return file;
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
      if (previousRoot === undefined) delete process.env.PI_CLASSROOMS_DIR;
      else process.env.PI_CLASSROOMS_DIR = previousRoot;
    },
  };
}

/** A minimal, valid lesson document. */
export function lessonHtml(title: string, body = "<p>Some lesson prose to highlight.</p>"): string {
  return `<!doctype html><html><head><title>${title}</title></head><body><main data-cl-content>${body}</main></body></html>`;
}

/**
 * Seed a classroom with one lesson.
 *
 * Returns the slugs so tests can address it without restating the layout.
 */
export function seedClassroom(
  fixture: Fixture,
  options: {
    classroom?: string;
    lesson?: string;
    title?: string;
    mission?: string;
  } = {},
): { classroom: string; lesson: string } {
  const classroom = options.classroom ?? "rust";
  const lesson = options.lesson ?? "001-ownership";

  fixture.write(
    `${classroom}/classroom.json`,
    JSON.stringify({ title: options.title ?? "Rust", emoji: "🦀", createdAt: 1 }),
  );
  fixture.write(
    `${classroom}/MISSION.md`,
    options.mission ??
      "# Mission: Rust\n\n## Why\n\nShip a CLI to my team by October.\n\n## Success looks like\n\n- Ships\n",
  );
  fixture.write(`${classroom}/${lesson}/lesson.html`, lessonHtml("Ownership"));
  fixture.write(
    `${classroom}/${lesson}/lesson.json`,
    JSON.stringify({ title: "Ownership", summary: "One owner at a time.", createdAt: 2 }),
  );

  return { classroom, lesson };
}

/**
 * Write a graded quiz attempt straight to disk, at a chosen time.
 *
 * Review schedules are measured in days, so the tests place attempts in the past
 * instead of waiting.
 */
export function writeGradedAttempt(options: {
  classroom?: string;
  lesson?: string;
  quizId?: string;
  kind?: store.QuizKind;
  at: number;
  answers: store.QuizAnswer[];
  correct: Record<string, boolean>;
}): store.QuizSubmission {
  const classroom = options.classroom ?? "rust";
  const lesson = options.lesson ?? "001-ownership";
  const submission: store.QuizSubmission = {
    id: randomUUID(),
    classroom,
    lesson,
    quizId: options.quizId ?? "check-1",
    quizTitle: "Check on learning",
    kind: options.kind ?? "check",
    attempt: 1,
    answers: options.answers,
    submittedAt: options.at,
  };
  const file = path.join(submissionsDir(classroom, lesson), `${options.at}-${submission.id}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(submission), "utf8");
  store.writeGrade({
    submissionId: submission.id,
    classroom,
    lesson,
    quizId: submission.quizId,
    score: 0,
    feedbackMarkdown: "",
    feedbackHtml: "",
    questions: Object.entries(options.correct).map(([questionId, correct]) => ({
      questionId,
      correct,
      feedback: correct ? "Right." : "Not quite.",
    })),
    gradedAt: options.at + 1,
  });
  return submission;
}

/** A `term` answer, the simplest typed answer. */
export function termAnswer(
  questionId: string,
  value: string,
  extra: Partial<store.QuizAnswer> = {},
): store.QuizAnswer {
  return { questionId, type: "term", prompt: `Prompt for ${questionId}`, value, ...extra };
}

/** A complete review document for browser and recovery fixtures. */
export function reviewDocument(
  items: import("../src/review.ts").ReviewItem[],
): import("../src/review-session.ts").ReviewDocument {
  const objectives: Record<string, unknown> = {};
  const questions: Record<string, unknown> = {};
  const rubric: Record<string, unknown> = {};
  const body = items
    .map((item, i) => {
      const id = `r${i + 1}`;
      objectives[id] = item.objective ?? { statement: "Explain ownership.", application: false };
      questions[id] = {
        objective: id,
        task: item.progress === "transfer-needed" ? "transfer" : "retrieval",
        support: "independent",
      };
      rubric[id] = {
        expected: "The new owner releases it.",
        points: 1,
        full: "Name the new owner.",
        partial: "Zero points if the owner is wrong.",
      };
      const prompt =
        item.progress === "transfer-needed"
          ? "A setup routine hands its resource handle to a long-running worker, then returns. Explain which scope determines when the resource is released and why."
          : "A String moves to a second binding. Who releases it?";
      return `<li class="cl-q" data-question-id="${id}" data-type="short" data-review-of="${item.key}"><p class="cl-q-prompt">${prompt}</p><textarea></textarea></li>`;
    })
    .join("\n");
  return {
    lesson_html: lessonHtml(
      "Ownership review",
      `<h1>Ownership review</h1><form class="cl-quiz" data-quiz-id="review" data-kind="review" data-evidence="report"><ol class="cl-questions">${body}</ol></form>`,
    ),
    rubric_json: JSON.stringify({ review: rubric }),
    teaching_plan_json: JSON.stringify({
      version: 1,
      objectives,
      quizzes: { review: { purpose: "assessment", questions } },
    }),
  };
}

/** A historical graded review with no panel conversation. Use only scratch roots. */
export function seedHistoricalReview(root: string): {
  classroom: string;
  lesson: string;
  submission_id: string;
} {
  const classroom = "rust",
    lesson = "999-historical-review";
  const dir = path.join(root, classroom, lesson);
  fs.mkdirSync(path.join(dir, "quiz"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "lesson.html"),
    lessonHtml(
      "Historical ownership review",
      `<p>Ownership controls cleanup. A move transfers ownership to a new binding.</p><form class="cl-quiz" data-quiz-id="review" data-kind="review"><ol class="cl-questions">${["Name the language used in this lesson.", "Name the owner before a move.", "What happens to a value when its owner leaves scope?"].map((prompt, i) => `<li class="cl-q" data-question-id="q${i + 1}" data-type="term" data-review-of="001-ownership/check-1/q${i + 1}"><p class="cl-q-prompt">${prompt}</p><input type="text"></li>`).join("")}</ol></form>`,
    ),
  );
  fs.writeFileSync(
    path.join(dir, "quiz/key.json"),
    JSON.stringify({
      review: {
        q1: { pointsPossible: 1, criteria: "Rust." },
        q2: { pointsPossible: 1, criteria: "The original binding." },
        q3: { pointsPossible: 1, criteria: "The value is dropped." },
      },
    }),
  );
  const input = { classroom, lesson };
  const submission = store.createSubmission({
    ...input,
    quizId: "review",
    quizTitle: "Historical ownership review",
    kind: "review",
    answers: [
      termAnswer("q1", "Rust", { reviewOf: "001-ownership/check-1/q1" }),
      termAnswer("q2", "original binding", { reviewOf: "001-ownership/check-1/q2" }),
      termAnswer("q3", "It lives forever", { reviewOf: "001-ownership/check-1/q3" }),
    ],
  });
  store.writeGrade({
    submissionId: submission.id,
    ...input,
    quizId: "review",
    score: 67,
    feedbackMarkdown: "Two correct. The missed idea is cleanup when the owner leaves scope.",
    feedbackHtml: "<p>Two correct. Check cleanup.</p>",
    questions: [1, 2, 3].map((i) => ({
      questionId: `q${i}`,
      correct: i !== 3,
      feedback: i === 3 ? "The value is dropped when its owner leaves scope." : "Correct.",
    })),
    gradedAt: Date.now(),
  });
  return { ...input, submission_id: submission.id };
}

/** Three independent retrieval occasions leave an application objective needing transfer. */
export function seedTransferObjective(prepare = false, history = true): void {
  if (prepare) {
    const root = classroomsRoot();
    seedPreparedReviewSource(root, "rust", "001-ownership", "transfer-history", ["q1", "q2", "q3"]);
    const file = path.join(root, "rust/001-ownership/quiz/plan.json");
    const plan = JSON.parse(fs.readFileSync(file, "utf8"));
    plan.objectives = {
      ownership: {
        statement: "Explain when the current owner releases a value.",
        application: true,
      },
    };
    for (const question of Object.values(plan.quizzes["transfer-history"].questions) as any[]) {
      question.objective = "ownership";
      question.variants.v2.task = "transfer";
    }
    fs.writeFileSync(file, JSON.stringify(plan));
  }
  if (!history) return;
  const start = Date.now() - 20 * DAY_MS;
  for (const day of [0, 2, 9])
    writeGradedAttempt({
      at: start + day * DAY_MS,
      quizId: "transfer-history",
      answers: (day === 0 ? ["q1", "q2", "q3"] : ["q1"]).map((id) =>
        termAnswer(id, "dropped", {
          prompt: "What happens when a value's owner leaves scope?",
          learning: {
            objectiveId: "ownership",
            objective: {
              statement: "Explain when the current owner releases a value.",
              application: true,
            },
            task: "retrieval",
            support: "independent",
            assistance: "none",
          },
        }),
      ),
      correct: { q1: true, ...(day === 0 ? { q2: true, q3: true } : {}) },
    });
}

/** A preauthored private pool, shared by browser and host verification. */
export function seedPreparedReviewSource(
  root: string,
  classroom = "rust",
  lesson = "001-ownership",
  quizId = "check-1",
  ids = ["q1"],
): void {
  const write = (name: string, value: unknown) => {
    const file = path.join(root, classroom, lesson, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
  };
  const rubric = {
    expected: "The new owner releases the value.",
    points: 1,
    full: "Name the owner and release.",
    partial: "Zero without the owner.",
  };
  const question = (id: string, fresh = false) =>
    `<li class="cl-q" data-question-id="${id}" data-type="short"><p class="cl-q-prompt">${fresh ? "A value moves into a new scope. Who releases it?" : "Explain ownership."}</p><textarea></textarea></li>`;
  write(
    "lesson.html",
    lessonHtml(
      "Ownership",
      `<form class="cl-quiz" data-quiz-id="${quizId}" data-kind="check"><ol>${ids.map((id) => question(id)).join("")}</ol></form>`,
    ),
  );
  write("lesson.json", {
    title: "Ownership",
    summary: "One owner at a time.",
    createdAt: 2,
    assessmentContract: 1,
    instructionalContract: 1,
    reviewVariantContract: 1,
  });
  write("quiz/key.json", {
    [quizId]: Object.fromEntries(
      ids.map((id) => [
        id,
        {
          ...rubric,
          variants: ["v1", "v2"].map((v) => ({ id: v, html: question(v, true), rubric })),
        },
      ]),
    ),
  });
  write("quiz/plan.json", {
    version: 1,
    objectives: { owner: { statement: "Explain ownership.", application: false } },
    quizzes: {
      [quizId]: {
        purpose: "assessment",
        questions: Object.fromEntries(
          ids.map((id) => [
            id,
            {
              objective: "owner",
              task: "retrieval",
              support: "independent",
              variants: Object.fromEntries(
                ["v1", "v2"].map((v) => [
                  v,
                  { objective: "original", task: "retrieval", support: "independent" },
                ]),
              ),
            },
          ]),
        ),
      },
    },
  });
}

/** Saved pre-pool requests still need the old authoring recovery contract. */
export function legacyReview(classroom: string, id: string, owner: "pi" | "service") {
  const target = path.join(classroomsRoot(), classroom, ".reviews.json");
  const requests = fs.existsSync(target)
    ? JSON.parse(fs.readFileSync(target, "utf8")).requests
    : [];
  const existing = requests.find((r: { id: string }) => r.id === id) ?? requests.at(-1);
  if (existing) return { session: existing as ReviewSession, added: false };
  const session: ReviewSession = {
    owner,
    ownerPid: process.pid,
    id,
    classroom,
    lesson: `002-review-${id.slice(0, 8)}`,
    at: Date.now(),
    items: store
      .reviewItems(classroom)
      .filter((item) => item.dueAt <= Date.now())
      .slice(0, 5),
    status: "queued",
  };
  fs.writeFileSync(target, JSON.stringify({ version: 1, requests: [session] }));
  return { session, added: true };
}

/** Fixture model response at the production teacher-plan boundary. */
export function refillPlan(request: RefillRequest) {
  const [lesson, quiz, question] = request.key.split("/");
  const source = lessonPools(request.classroom, lesson).get(`${quiz}/${question}`)![0];
  const variants = Array.from({ length: request.reason === "miss" ? 1 : 2 }, (_, i) => {
    const id = `fresh-${request.id.slice(-12)}-${i + 1}`;
    return {
      id,
      html: `<li class="cl-q" data-question-id="${id}" data-type="short"><p class="cl-q-prompt">A value moves through scope ${i + 1} into a new scope. Who releases the value?</p><textarea></textarea></li>`,
      rubric: source.rubric,
      plan: { objective: "original", task: "retrieval", support: "independent" },
    };
  });
  return {
    calls: [
      {
        name: "save_review_variants",
        arguments_json: JSON.stringify({
          classroom: request.classroom,
          request_id: request.id,
          variants,
        }),
      },
    ],
    message: "",
    learning_record: "",
    notes_markdown: "",
  };
}
