import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { makeFixture, seedClassroom, lessonHtml, termAnswer } from "./helpers.ts";
import { codeQuestion, codeRubric, exercise, source } from "./code-fixture.ts";
import { expectedAnswers } from "../src/expected-answers.ts";
import { TeacherService } from "../src/teacher-service.ts";
import { readTeacherState, saveTeacherState } from "../src/service-state.ts";
import { applyGrade } from "../src/quiz-grading.ts";
import { allocateCriteria } from "../src/criteria.ts";
import * as store from "../src/store.ts";
import * as server from "../src/server.ts";
import type { QuizAnswer, QuizKind } from "../src/quiz.ts";
let f: ReturnType<typeof makeFixture>;
let teacher: TeacherService | undefined;
const loc = { classroom: "rust", lesson: "001-ownership", quizId: "check", quizTitle: "Check" };
const entry = {
  expected: "original-answer-sentinel",
  points: 1,
  full: "full-sentinel",
  partial: "partial-sentinel",
};
beforeEach(() => {
  f = makeFixture();
  seedClassroom(f);
});
afterEach(async () => {
  await teacher?.stop();
  teacher = undefined;
  await server.close();
  f.cleanup();
});
function seed(
  kind: QuizKind = "check",
  answers = [termAnswer("q1", "wrong")],
  entries: Record<string, unknown> = { q1: entry },
  questions = '<li class="cl-q" data-question-id="q1" data-type="term"><input></li>',
) {
  if (answers.some((a) => a.type === "code")) {
    f.write(
      `rust/${loc.lesson}/lesson.json`,
      JSON.stringify({ title: "Code", assessmentContract: 1, criterionContract: 1 }),
    );
  }
  f.write(
    `rust/${loc.lesson}/lesson.html`,
    lessonHtml(
      "Check",
      `<form class="cl-quiz" data-quiz-id="check" data-kind="${kind}">${questions}</form><form class="cl-quiz" data-quiz-id="neighbor"><li class="cl-q" data-question-id="private" data-type="short"><textarea></textarea></li></form>`,
    ),
  );
  f.write(
    `rust/${loc.lesson}/quiz/key.json`,
    JSON.stringify({
      check: entries,
      neighbor: {
        private: {
          ...entry,
          expected: "private-sibling-sentinel",
          criteria: [{ id: "private", description: "Private sibling criterion", points: 1 }],
        },
      },
      variants: { expected: "private-pool-sentinel" },
    }),
  );
  return store.createSubmission({ ...loc, kind, answers });
}
function grade(s: store.QuizSubmission, correct: boolean) {
  return applyGrade(s, {
    score: correct ? 100 : 0,
    feedbackMarkdown: "Saved feedback",
    questions: s.answers.map((a) => ({
      questionId: a.questionId,
      correct,
      feedback: "Saved feedback",
      pointsEarned: correct ? (a.type === "code" ? 2 : 1) : 0,
      pointsPossible: a.type === "code" ? 2 : 1,
      ...(s.rubricCriteria?.[a.questionId]
        ? {
            criteria: allocateCriteria(
              s,
              a.questionId,
              s.rubricCriteria[a.questionId].map((c) => ({
                criterion_id: c.id,
                points_earned: correct ? c.points : 0,
                feedback: "Saved feedback",
              })),
            ),
          }
        : {}),
    })),
  });
}
function tree(root: string): string {
  return fs
    .readdirSync(root)
    .sort()
    .map((name) => {
      const file = path.join(root, name);
      return (
        name +
        (fs.statSync(file).isDirectory() ? tree(file) : fs.readFileSync(file).toString("hex"))
      );
    })
    .join("\n");
}
it("keeps ungraded and partial grades private; reveals only correct originals without writes", () => {
  const s = seed(
    "check",
    [termAnswer("q1", "right"), termAnswer("q2", "wrong")],
    { q1: entry, q2: { ...entry, expected: "missed-answer-sentinel" } },
    '<li class="cl-q" data-question-id="q1" data-type="term"><input></li><li class="cl-q" data-question-id="q2" data-type="term"><input></li>',
  );
  expect(JSON.stringify(expectedAnswers(s))).not.toContain("sentinel");
  store.writeGrade({
    ...loc,
    submissionId: s.id,
    score: 100,
    questions: [{ questionId: "q1", correct: true, feedback: "Saved" }],
    feedbackMarkdown: "",
    feedbackHtml: "",
    gradedAt: Date.now(),
  });
  expect(JSON.stringify(expectedAnswers(s))).not.toContain("sentinel");
});
it.each(["check", "pretest"] as const)(
  "reveals the graded %s only under original policy and denies stale attempts",
  (kind) => {
    const s = seed(kind);
    grade(s, kind === "check");
    const before = tree(f.root);
    const value = expectedAnswers(s);
    expect(value.q1.status).toBe("available");
    expect(JSON.stringify(value)).toContain("original-answer-sentinel");
    expect(JSON.stringify(value)).not.toContain("private-sibling");
    expect(tree(f.root)).toBe(before);
    const next = store.createSubmission({ ...loc, kind, answers: [termAnswer("q1", "next")] });
    expect(() => expectedAnswers(s)).toThrow("stale");
    expect(expectedAnswers(next).q1.status).toBe("waiting");
    expect(store.publicSubmission(s)).not.toHaveProperty("answerSourceDigest");
  },
);
it("requires the validated exact corrective task/reply/check identity, survives reload, and does not revise evidence", async () => {
  const s = seed();
  let turn = 0;
  teacher = new TeacherService(async () =>
    ++turn === 1
      ? {
          calls: [
            {
              name: "grade_quiz_answers",
              arguments_json: JSON.stringify({
                submission_id: s.id,
                feedback_markdown: "Try a new example.",
                questions: [
                  {
                    question_id: "q1",
                    correct: false,
                    points_earned: 0,
                    points_possible: 1,
                    feedback: "Not yet.",
                  },
                ],
              }),
            },
          ],
          message: "A String moves to a new binding. Which binding releases it?",
          learning_record: "",
          notes_markdown: "",
        }
      : {
          calls: [
            {
              name: "record_retrieval_check",
              arguments_json: JSON.stringify({
                classroom: "rust",
                review_key: `${loc.lesson}/check/q1`,
                answer: "The new binding releases it. No help.",
                evidence: "Explains the new owner.",
                assistance: "none",
              }),
            },
          ],
          message: "The new binding owns it.",
          learning_record: "# New owner\nThe learner identified the new owner.",
          notes_markdown: "",
        },
  );
  teacher.attach("rust", "codex");
  await teacher.idle();
  expect(expectedAnswers(s).q1.status).toBe("waiting");
  const id = randomUUID();
  teacher.chat("rust", loc.lesson, "The new binding releases it. No help.", id);
  await teacher.idle();
  const state = readTeacherState("rust")!;
  expect(state.requests.every((r) => r.status === "done")).toBe(true);
  expect(state.messages.find((m) => m.role === "learner")?.replyTo).toBe(`quiz:${s.id}`);
  const before = tree(f.root);
  expect(expectedAnswers(s).q1.status).toBe("available");
  expect(tree(f.root)).toBe(before);
  const reply = state.messages.find((m) => m.role === "learner")!;
  delete reply.replyTo;
  saveTeacherState("rust", state);
  expect(expectedAnswers(s).q1.status).toBe("waiting");
  reply.replyTo = "unrelated-task";
  saveTeacherState("rust", state);
  expect(expectedAnswers(s).q1.status).toBe("waiting");
  expect(() => teacher!.chat("rust", loc.lesson, "changed reply", id)).toThrow(
    "different saved panel reply",
  );
});
it("does not let a dispute revision release an original miss", () => {
  const s = seed();
  const first = grade(s, false);
  store.writeGrade({
    ...first,
    disputeId: "dispute",
    gradedAt: first.gradedAt + 1,
    score: 100,
    questions: [
      { questionId: "q1", correct: true, feedback: "Revision", pointsEarned: 1, pointsPossible: 1 },
    ],
  });
  expect(expectedAnswers(s).q1.status).toBe("waiting");
});
it("explains unavailable legacy identity, changed/deleted/symlink sources, and explicit read retry", () => {
  const s = seed();
  grade(s, true);
  const key = path.join(f.root, "rust", loc.lesson, "quiz/key.json");
  const original = fs.readFileSync(key);
  fs.writeFileSync(key, JSON.stringify({ check: { q1: { ...entry, expected: "replacement" } } }));
  expect(expectedAnswers(s).q1).toMatchObject({
    status: "error",
    message: expect.stringContaining("rubric changed"),
  });
  expect(JSON.stringify(expectedAnswers(s))).not.toContain("replacement");
  fs.unlinkSync(key);
  expect(expectedAnswers(s).q1).toMatchObject({
    status: "error",
    message: expect.stringContaining("missing or unsafe"),
  });
  fs.symlinkSync(path.join(f.root, "rust/classroom.json"), key);
  expect(expectedAnswers(s).q1.status).toBe("error");
  fs.unlinkSync(key);
  fs.writeFileSync(key, original);
  expect(expectedAnswers(s).q1.status).toBe("available");
  const html = path.join(f.root, "rust", loc.lesson, "lesson.html");
  fs.appendFileSync(html, "changed");
  expect(expectedAnswers(s).q1).toMatchObject({
    status: "error",
    message: expect.stringContaining("lesson source changed"),
  });
  const saved = path.join(
    f.root,
    "rust",
    loc.lesson,
    "quiz/submissions",
    `${s.submittedAt}-${s.id}.json`,
  );
  delete s.answerSourceDigest;
  fs.writeFileSync(saved, JSON.stringify(s));
  expect(expectedAnswers(s).q1.status).toBe("unavailable");
});
const formats: [NonNullable<QuizAnswer["type"]>, unknown][] = [
  ["choice", "a"],
  ["multi", ["a", "b"]],
  ["numeric", { value: 6, unit: "N", tolerance: 0.1, privateFuture: "hidden" }],
  ["order", ["b", "a"]],
  ["match", { left: "right" }],
  ["cloze", { blank: ["one", "1"] }],
  ["locate", ["segment"]],
  ["term", ["term", "synonym"]],
  ["short", "A complete explanation."],
  ["code", codeRubric.expected],
];
it.each(formats)("projects the supported %s key and only allowed fields", (type, expected) => {
  const answer: QuizAnswer = {
    questionId: "q1",
    type,
    value: type === "code" ? source : "answer",
    ...(type === "code" ? { code: { exercise } } : {}),
  };
  const s = seed(
    "pretest",
    [answer],
    { q1: { ...entry, ...(type === "code" ? codeRubric : {}), expected, future: "hidden" } },
    type === "code"
      ? codeQuestion(source, exercise, "q1")
      : `<li class="cl-q" data-question-id="q1" data-type="${type}"><input></li>`,
  );
  grade(s, true);
  const projected = expectedAnswers(s);
  expect(projected.q1.status).toBe("available");
  expect(JSON.stringify(projected)).not.toContain("hidden");
});
it("rejects unknown, neighboring, and malformed HTTP targets without leaking on state or static routes", async () => {
  const s = seed();
  const base = await server.start(0);
  const query = new URLSearchParams({ ...loc, submissionId: s.id });
  let response = await fetch(`${base}/api/quiz/expected?${query}`);
  expect(response.status).toBe(200);
  expect(await response.text()).not.toContain("sentinel");
  grade(s, true);
  for (const patch of [
    { submissionId: "other" },
    { lesson: "other" },
    { classroom: "other" },
    { quizId: "neighbor" },
    { classroom: "../rust" },
  ]) {
    response = await fetch(
      `${base}/api/quiz/expected?${new URLSearchParams({ ...loc, submissionId: s.id, ...patch })}`,
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await response.text()).not.toContain("sentinel");
  }
  for (const suffix of ["quiz/key.json", "quiz/plan.json", ".teacher.json"]) {
    response = await fetch(`${base}/c/rust/${loc.lesson}/${suffix}`);
    expect(response.status).toBe(404);
  }
  response = await fetch(`${base}/api/state?classroom=rust&lesson=${loc.lesson}`);
  const publicText = await response.text();
  expect(publicText).not.toContain("sentinel");
  expect(publicText).not.toContain("answerSourceDigest");
});

it("never echoes private parser bytes through expected answers, state, HTML or SSE", async () => {
  const s = seed();
  grade(s, false);
  teacher = new TeacherService(async () => {
    throw new Error("Unexpected model turn");
  });
  teacher.attach("rust", "codex");
  await teacher.idle();
  server.setHooks({
    delivery: "service",
    onAsk() {
      throw new Error("Unexpected callback");
    },
    onFollowUp() {},
    onReflect() {},
    onQuizSubmit() {},
    teacherState() {
      return readTeacherState("rust");
    },
  });
  const base = await server.start(0);
  const canary = "SECRET_22_PRIVATE_PARSER";
  const privateFiles = [
    ".teacher.json",
    "quiz/retrieval-checks/corrupt.json",
    ".review-controls.json",
    ".reviews.json",
    ".lesson-requests.json",
    `${loc.lesson}/lesson.json`,
    `${loc.lesson}/annotations.json`,
    `${loc.lesson}/quiz/submissions/corrupt.json`,
    `${loc.lesson}/quiz/grades/corrupt.json`,
  ];
  for (const relative of privateFiles) {
    const target = path.join(f.root, "rust", relative);
    const saved = fs.existsSync(target) ? fs.readFileSync(target) : null;
    f.write(`rust/${relative}`, canary);
    const query = new URLSearchParams({ ...loc, submissionId: s.id });
    const expected = await fetch(`${base}/api/quiz/expected?${query}`);
    const body = await expected.text();
    expect(body).not.toContain(canary);
    if (expected.ok) expect(JSON.parse(body).questions.q1.status).toBe("error");
    else expect(expected.status).toBe(500);
    const state = await fetch(`${base}/api/state?classroom=rust&lesson=${loc.lesson}`);
    expect(await state.text()).not.toContain(canary);
    const html = await fetch(`${base}/c/rust/${loc.lesson}`);
    expect(await html.text()).not.toContain(canary);
    const controller = new AbortController();
    const events = await fetch(`${base}/api/events?classroom=rust&lesson=${loc.lesson}`, {
      signal: controller.signal,
    });
    const reader = events.body!.getReader();
    const frame = await reader.read();
    expect(new TextDecoder().decode(frame.value)).not.toContain(canary);
    controller.abort();
    await reader.cancel().catch(() => {});
    expect(fs.readFileSync(target, "utf8")).toBe(canary);
    if (saved) fs.writeFileSync(target, saved);
    else fs.unlinkSync(target);
  }
});

it("releases one exact question alias at a time for two misses sharing an objective", async () => {
  f.write(
    `rust/${loc.lesson}/lesson.json`,
    JSON.stringify({ title: "Shared objective", instructionalContract: 1 }),
  );
  f.write(
    `rust/${loc.lesson}/quiz/plan.json`,
    JSON.stringify({
      version: 1,
      objectives: {
        ownership: { statement: "Explain which binding owns a moved value.", application: false },
      },
      quizzes: {
        check: {
          purpose: "assessment",
          questions: {
            q1: { objective: "ownership", task: "retrieval", support: "independent" },
            q2: { objective: "ownership", task: "retrieval", support: "independent" },
          },
        },
        neighbor: {
          purpose: "assessment",
          questions: {
            private: { objective: "ownership", task: "retrieval", support: "independent" },
          },
        },
      },
    }),
  );
  const s = seed(
    "check",
    [termAnswer("q1", "wrong"), termAnswer("q2", "wrong")],
    { q1: entry, q2: { ...entry, expected: "second-original-answer" } },
    '<li class="cl-q" data-question-id="q1" data-type="term"><input></li><li class="cl-q" data-question-id="q2" data-type="term"><input></li>',
  );
  let turn = 0;
  let reviewKey = `${loc.lesson}/@objective/ownership`;
  teacher = new TeacherService(async () => {
    const request = readTeacherState("rust")!.requests.find((r) => r.status === "running")!;
    if (++turn === 1)
      return {
        calls: [
          {
            name: "grade_quiz_answers",
            arguments_json: JSON.stringify({
              submission_id: s.id,
              feedback_markdown: "Try new examples.",
              questions: s.answers.map((a) => ({
                question_id: a.questionId,
                correct: false,
                points_earned: 0,
                points_possible: 1,
                feedback: "Not yet.",
              })),
            }),
          },
        ],
        message: "A String moves twice. Identify its owner after each move using a new example.",
        learning_record: "",
        notes_markdown: "",
      };
    const reply = readTeacherState("rust")!.messages.find(
      (m) => m.id === request.id && m.role === "learner",
    )!;
    return {
      calls: [
        {
          name: "record_retrieval_check",
          arguments_json: JSON.stringify({
            classroom: "rust",
            review_key: reviewKey,
            answer: reply.text,
            evidence: "The new example names the owner.",
            assistance: "none",
          }),
        },
      ],
      message: "Now identify the owner in another new move example.",
      learning_record: `# New owner ${turn}\n${reply.text}`,
      notes_markdown: "",
    };
  });
  teacher.attach("rust", "codex");
  await teacher.idle();
  teacher.chat("rust", loc.lesson, "Both examples move to the new owner. No help.", randomUUID());
  await teacher.idle();
  expect(readTeacherState("rust")!.requests.every((r) => r.status === "done")).toBe(true);
  expect(Object.values(expectedAnswers(s)).map((a) => a.status)).toEqual(["waiting", "waiting"]);
  reviewKey = `${loc.lesson}/check/q1`;
  teacher.chat(
    "rust",
    loc.lesson,
    "In the first new case, the destination owns it. No help.",
    randomUUID(),
  );
  await teacher.idle();
  expect(expectedAnswers(s).q1.status).toBe("available");
  expect(expectedAnswers(s).q2.status).toBe("waiting");
  reviewKey = `${loc.lesson}/check/q2`;
  teacher.chat(
    "rust",
    loc.lesson,
    "In the second new case, the last destination owns it. No help.",
    randomUUID(),
  );
  await teacher.idle();
  expect(expectedAnswers(s).q1.status).toBe("available");
  expect(expectedAnswers(s).q2.status).toBe("available");
  const before = tree(f.root);
  expectedAnswers(s);
  expect(tree(f.root)).toBe(before);
});
