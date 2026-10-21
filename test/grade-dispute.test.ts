import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { randomUUID } from "node:crypto";
import {
  makeFixture,
  seedClassroom,
  seedPreparedReviewSource,
  writeGradedAttempt,
  termAnswer,
  refillPlan,
  type Fixture,
} from "./helpers.ts";
import { refillRequests } from "../src/review-refill.ts";
import * as store from "../src/store.ts";
import * as server from "../src/server.ts";
import { applyGrade } from "../src/quiz-grading.ts";
import { allocateCriteria } from "../src/criteria.ts";
import { TeacherService } from "../src/teacher-service.ts";
import { readTeacherState, saveTeacherState } from "../src/service-state.ts";
import { snapshotDispute, resolveDispute, disputePrompt } from "../src/grade-dispute.ts";
import { DAY_MS } from "../src/review.ts";
import type { TeacherPlan } from "../src/teacher.ts";
import { planSchema } from "../src/teacher.ts";
import { disputeOutputPlan } from "../src/dispute-output.ts";

const location = { classroom: "rust", lesson: "001-ownership" };
let f: Fixture;
let teachers: TeacherService[];
const key = {
  check: {
    q: {
      expected: "5/2 = 2.5",
      points: 4,
      full: "Both steps",
      partial: "2 for sum, 2 for mean",
      criteria: [
        { id: "sum", description: "Square and sum", points: 2 },
        { id: "mean", description: "Average", points: 2 },
      ],
    },
    closed: {
      expected: "a",
      points: 1,
      full: "a",
      partial: "0",
      criteria: [{ id: "exact", description: "Correct choice", points: 1 }],
    },
  },
};
const criteria = (mean = 2) => [
  { criterion_id: "sum", points_earned: 2, feedback: "The squared sum is 5." },
  { criterion_id: "mean", points_earned: mean, feedback: "The original answer divides by 2." },
];
const revision = () => ({
  question_id: "q",
  correct: true,
  points_earned: 4,
  points_possible: 4,
  feedback: "The original answer correctly averages the squares.",
  criteria: criteria(),
});
const plan = (id: string, decision = "accepted", question: unknown = revision()): TeacherPlan => ({
  calls: [
    {
      name: "resolve_grade_dispute",
      arguments_json: JSON.stringify({
        dispute_id: id,
        decision,
        ...(question ? { question } : {}),
      }),
    },
  ],
  message: "Your original answer includes both steps. Credit revised under the original criteria.",
  learning_record: "",
  notes_markdown: "",
});
function seed() {
  f.write(
    "rust/001-ownership/lesson.json",
    JSON.stringify({ title: "MSE", assessmentContract: 1, criterionContract: 1 }),
  );
  f.write(
    "rust/001-ownership/lesson.html",
    '<form class="cl-quiz" data-quiz-id="check"><li class="cl-q" data-question-id="q" data-type="short"></li><li class="cl-q" data-question-id="closed" data-type="choice"><label><input type="radio" value="a">a</label><label><input type="radio" value="b">b</label></li></form>',
  );
  f.write("rust/001-ownership/quiz/key.json", JSON.stringify(key));
  const submission = store.createSubmission({
    ...location,
    quizId: "check",
    quizTitle: "MSE",
    kind: "check",
    answers: [
      {
        questionId: "q",
        type: "short",
        value: "(4+1)/2=2.5",
        assistance: "hint",
        confidence: "unsure",
      },
      { questionId: "closed", type: "choice", value: "b" },
    ],
  });
  const grade = applyGrade(submission, {
    score: 40,
    feedbackMarkdown: "Original",
    questions: [
      ...submission.deterministicGrades!,
      {
        questionId: "q",
        correct: false,
        feedback: "Average missing",
        pointsEarned: 2,
        pointsPossible: 4,
        criteria: allocateCriteria(submission, "q", criteria(0)),
      },
    ],
  });
  const input = {
    ...location,
    id: randomUUID(),
    quizId: "check",
    submissionId: submission.id,
    questionId: "q",
    gradedAt: grade.gradedAt,
    reason: "My original answer already divided by two.",
  };
  return { submission, grade, input };
}
function teacher(run: ConstructorParameters<typeof TeacherService>[0]) {
  const t = new TeacherService(run);
  teachers.push(t);
  t.attach("rust", "codex");
  return t;
}
beforeEach(() => {
  f = makeFixture();
  seedClassroom(f);
  teachers = [];
});
afterEach(async () => {
  for (const t of teachers) await t.stop();
  await server.close();
  vi.restoreAllMocks();
  vi.useRealTimers();
  f.cleanup();
});

it.each(["complete", "stop"])(
  "persists a dispute behind an active refill and drains it after refill %s",
  async (finish) => {
    const { input, grade } = seed();
    seedPreparedReviewSource(f.root, "rust", "002-pool");
    writeGradedAttempt({
      lesson: "002-pool",
      at: 1,
      answers: [termAnswer("q1", "old owner")],
      correct: { q1: false },
    });
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const order: string[] = [];
    const runDispute = async () => {
      order.push("dispute");
      return plan(input.id, "declined", null);
    };
    const t = teacher(async (_id, _prompt, _cwd, _save, signal, contract) => {
      if (!contract.operations.includes("save_review_variants")) return runDispute();
      order.push("refill");
      started();
      await new Promise<void>((resolve, reject) => {
        release = resolve;
        signal?.addEventListener("abort", () => reject(new Error("Controlled service stop.")), {
          once: true,
        });
      });
      return refillPlan(refillRequests("rust")[0]);
    });
    await entered;
    const id = t.dispute(input);
    // Inference has started: a later learner request must be durable, not concurrent.
    await Promise.resolve();
    expect(order).toEqual(["refill"]);
    expect(readTeacherState("rust")!.requests.find((r) => r.id === id)).toMatchObject({
      status: "queued",
    });
    if (finish === "stop") {
      await t.stop();
      expect(refillRequests("rust")[0].status).toBe("failed");
      expect(readTeacherState("rust")!.requests.find((r) => r.id === id)?.status).toBe("queued");
      const restarted = new TeacherService(runDispute);
      teachers.push(restarted);
      restarted.restore();
      await restarted.idle();
      expect(refillRequests("rust")[0].status).toBe("failed");
    } else {
      release();
      await t.idle();
      expect(refillRequests("rust")[0].status).toBe("done");
    }
    expect(order).toEqual(["refill", "dispute"]);
    expect(readTeacherState("rust")!.requests.find((r) => r.id === id)).toMatchObject({
      status: "done",
      disputeDecision: "declined",
    });
    expect(store.listGrades("rust", location.lesson)).toEqual([grade]);
  },
);

it("records one revision, preserves original bytes and first-feedback provenance, replays once", async () => {
  const { submission, grade, input } = seed();
  const originalBytes = fs.readFileSync(
    `${f.root}/rust/001-ownership/quiz/grades/${grade.gradedAt}-${submission.id}.json`,
    "utf8",
  );
  const before = store.reviewEvents("rust");
  const t = teacher(async (_identity, prompt, _cwd, _save, _signal, contract) => {
    expect(contract).toMatchObject({
      operations: ["resolve_grade_dispute"],
      required: true,
      response: "dispute-resolution",
      disputeTarget: { id: input.id, questionId: "q", machine: false },
    });
    expect(planSchema(contract).properties).toMatchObject({ dispute_id: { enum: [input.id] } });
    expect(prompt).not.toContain('"closed":');
    expect(prompt).toContain(input.reason);
    expect(prompt).toContain(submission.answers[0].value);
    return disputeOutputPlan(
      {
        dispute_id: input.id,
        decision: "accepted",
        question: revision(),
        message: plan(input.id).message,
      },
      contract.disputeTarget,
    );
  });
  const future = Date.now() + 20 * DAY_MS;
  vi.spyOn(Date, "now").mockReturnValue(future);
  const id = t.dispute(input);
  expect(t.dispute(input)).toBe(id);
  await t.idle();
  const history = store.listGrades("rust", location.lesson);
  expect(history).toHaveLength(2);
  expect(history[0]).toEqual(grade);
  expect(history[1]).toMatchObject({ score: 80, disputeId: id, revisesGradedAt: grade.gradedAt });
  expect(history[1].questions.find((q) => q.questionId === "closed")).toEqual(
    grade.questions.find((q) => q.questionId === "closed"),
  );
  expect(
    fs.readFileSync(
      `${f.root}/rust/001-ownership/quiz/grades/${grade.gradedAt}-${submission.id}.json`,
      "utf8",
    ),
  ).toBe(originalBytes);
  expect(store.findSubmission(submission.id)).toEqual(submission);
  const after = store.reviewEvents("rust");
  expect(after).toHaveLength(before.length);
  for (const e of after)
    expect(e).toMatchObject({
      attemptId: submission.id,
      at: submission.submittedAt,
      feedbackAt: grade.gradedAt,
    });
  const items = store.reviewItems("rust");
  expect(
    items.every((i) => i.attempts === 1 && i.delayedSuccesses === 0 && i.delayedTransfers === 0),
  ).toBe(true);
  expect(store.listRetrievalChecks("rust")).toEqual([]);
  expect(store.listLearningRecords("rust")).toEqual([]);
  const state = readTeacherState("rust")!;
  expect(state.requests.at(-1)).toMatchObject({ status: "done", planValidated: true, applied: 1 });
  await t.stop();
  const restored = teacher(async () => {
    throw new Error("Unexpected inference");
  });
  await restored.idle();
  expect(store.reviewItems("rust")).toEqual(items);
  expect(store.listGrades("rust", location.lesson)).toEqual(history);
});

it.each(["declined", "authoring-defect"])(
  "saves a discoverable %s machine response without a grade revision",
  async (decision) => {
    const { input, grade } = seed();
    input.questionId = "closed";
    const t = teacher(async () => ({
      ...plan(input.id, decision, null),
      message: "The key requires a. The submitted answer was b. No score change.",
    }));
    t.dispute(input);
    await t.idle();
    expect(store.listGrades("rust", location.lesson)).toEqual([grade]);
    const publicState = t.publicState("rust", location.lesson) as any;
    expect(publicState.disputes[0]).toMatchObject({
      decision,
      reason: input.reason,
      response: expect.stringContaining("requires a"),
    });
    expect(JSON.stringify(publicState)).not.toMatch(
      /deterministicGrades|rubricCriteria|privateRubric|"rubric"|"submission"/,
    );
  },
);

it("rejects accepted machine overrides at the mergeGrades boundary", () => {
  const { input } = seed();
  input.questionId = "closed";
  const dispute = snapshotDispute(input);
  const q = {
    question_id: "closed",
    correct: true,
    points_earned: 1,
    points_possible: 1,
    feedback: "Override",
    criteria: [{ criterion_id: "exact", points_earned: 1, feedback: "Override" }],
  };
  expect(() => resolveDispute(dispute, plan(input.id, "accepted", q))).toThrow(
    /omit machine-graded/,
  );
});

it.each([
  { questionId: "unknown" },
  { quizId: "neighbor" },
  { lesson: "002-other" },
  { classroom: "other" },
  { submissionId: "unknown" },
  { gradedAt: 1 },
])("rejects a mismatched/stale target %j without a write", (change) => {
  const { input } = seed();
  const t = teacher(async () => {
    throw new Error("No inference");
  });
  const before = fs.readFileSync(`${f.root}/rust/.teacher.json`, "utf8");
  expect(() => t.dispute({ ...input, ...change })).toThrow();
  expect(fs.readFileSync(`${f.root}/rust/.teacher.json`, "utf8")).toBe(before);
});

it.each([
  (p: TeacherPlan) => {
    p.learning_record = "A new success";
  },
  (p: TeacherPlan) => {
    p.calls.push({ name: "grade_quiz_answers", arguments_json: "{}" });
  },
  (p: TeacherPlan) => {
    p.calls[0].arguments_json = JSON.stringify({ dispute_id: "other", decision: "declined" });
  },
  (p: TeacherPlan) => {
    const args = JSON.parse(p.calls[0].arguments_json);
    args.dispute_id = `dispute:${args.dispute_id}`;
    p.calls[0].arguments_json = JSON.stringify(args);
  },
  (p: TeacherPlan) => {
    const args = JSON.parse(p.calls[0].arguments_json);
    args.question.criteria[0].description = "New rubric";
    p.calls[0].arguments_json = JSON.stringify(args);
  },
  (p: TeacherPlan) => {
    const args = JSON.parse(p.calls[0].arguments_json);
    args.question.points_possible = 8;
    p.calls[0].arguments_json = JSON.stringify(args);
  },
  (p: TeacherPlan) => {
    const args = JSON.parse(p.calls[0].arguments_json);
    args.question.points_earned = 3;
    p.calls[0].arguments_json = JSON.stringify(args);
  },
])("preflights invalid resolution before writes", async (mutate) => {
  const { input, grade } = seed();
  const p = plan(input.id);
  mutate(p);
  const t = teacher(async () => p);
  t.dispute(input);
  await t.idle();
  expect(readTeacherState("rust")!.requests[0]).toMatchObject({
    status: "failed",
    planValidated: false,
  });
  expect(store.listGrades("rust", location.lesson)).toEqual([grade]);
});

it("retains storage-failed validated plans, explicitly retries once after restart without inference", async () => {
  const { input, grade } = seed();
  let calls = 0;
  const t = teacher(async () => {
    calls++;
    return plan(input.id);
  });
  const original = store.writeGrade;
  const spy = vi.spyOn(store, "writeGrade").mockImplementation(() => {
    throw Object.assign(new Error("fixture disk full"), { code: "ENOSPC" });
  });
  const id = t.dispute(input);
  await t.idle();
  expect(readTeacherState("rust")!.requests[0]).toMatchObject({
    status: "failed",
    planValidated: true,
  });
  expect(store.listGrades("rust", location.lesson)).toEqual([grade]);
  spy.mockImplementation(original);
  await t.stop();
  const restored = teacher(async () => {
    throw new Error("New model turn on recovery");
  });
  await restored.idle();
  expect(store.listGrades("rust", location.lesson)).toHaveLength(1);
  restored.retry("rust", id);
  expect(() => restored.retry("rust", id)).toThrow(/cannot be retried/);
  await restored.idle();
  expect(calls).toBe(1);
  expect(store.listGrades("rust", location.lesson)).toHaveLength(2);
});

it("recovers a grade written before the applied receipt without a second revision", async () => {
  const { input } = seed();
  const t = teacher(async () => plan(input.id));
  const id = t.dispute(input);
  await t.idle();
  await t.stop();
  const history = store.listGrades("rust", location.lesson),
    saved = readTeacherState("rust")!;
  saved.requests[0].status = "planned";
  saved.requests[0].applied = 0;
  saved.messages = [];
  saveTeacherState("rust", saved);
  const restored = teacher(async () => {
    throw new Error("Unexpected inference");
  });
  await restored.idle();
  expect(store.listGrades("rust", location.lesson)).toEqual(history);
  expect(readTeacherState("rust")!.messages.filter((m) => m.id === id)).toHaveLength(1);
});

it("requires explicit retry after rejected inference, never infers on GET, and preserves request model snapshot", async () => {
  const { input, grade } = seed();
  let calls = 0;
  const t = teacher(async () => {
    if (++calls === 1) throw new Error("fixture unavailable model");
    return plan(input.id);
  });
  const id = t.dispute(input);
  await t.idle();
  const state = readTeacherState("rust")!;
  expect(state.requests[0].error).toContain("fixture unavailable model");
  t.publicState("rust", location.lesson);
  await t.idle();
  expect(calls).toBe(1);
  expect(store.listGrades("rust", location.lesson)).toEqual([grade]);
  t.setModel("rust", "chosen-model", 0);
  expect(readTeacherState("rust")!.requests[0].requestedModel).toBe(null);
  t.retry("rust", id);
  await t.idle();
  expect(calls).toBe(2);
  expect(readTeacherState("rust")!.requests[0].requestedModel).toBe("chosen-model");
});

it("rejects changed original answer or rubric at inference/application and omits gated/neighbor context", async () => {
  const { input, submission } = seed();
  const snapshot = snapshotDispute(input);
  const prompt = disputePrompt(snapshot, `dispute:${input.id}`, {});
  expect(prompt).not.toContain('"closed":');
  expect(prompt).not.toContain('"teachingPlan":');
  const t = teacher(async () => {
    f.write("rust/001-ownership/quiz/key.json", JSON.stringify({ ...key, changed: true }));
    return plan(input.id);
  });
  t.dispute(input);
  await t.idle();
  expect(readTeacherState("rust")!.requests[0].error).toMatch(/rubric changed/);
  expect(store.listGrades("rust", location.lesson)).toHaveLength(1);
  f.write("rust/001-ownership/quiz/key.json", JSON.stringify(key));
  f.write(
    `rust/001-ownership/quiz/submissions/${submission.submittedAt}-${submission.id}.json`,
    JSON.stringify({
      ...submission,
      answers: submission.answers.map((a, i) =>
        i === 0 ? { ...a, value: "A changed answer" } : a,
      ),
    }),
  );
  t.retry("rust", `dispute:${input.id}`);
  await t.idle();
  expect(readTeacherState("rust")!.requests[0].error).toMatch(/submission changed/);
});

it("keeps judgment no-change responses and rejects accepted no-change allocations", async () => {
  const { input, grade } = seed();
  const t = teacher(async () => ({
    ...plan(input.id, "declined", null),
    message: "The original answer was reviewed. The saved allocation remains unchanged.",
  }));
  t.dispute(input);
  await t.idle();
  expect(store.listGrades("rust", location.lesson)).toEqual([grade]);
  expect((t.publicState("rust", location.lesson) as any).disputes[0]).toMatchObject({
    decision: "declined",
    response: expect.stringContaining("unchanged"),
  });
  const unchanged = { ...revision(), correct: false, points_earned: 2, criteria: criteria(0) };
  expect(() =>
    resolveDispute(
      snapshotDispute({ ...input, id: randomUUID() }),
      plan(input.id, "accepted", unchanged),
    ),
  ).toThrow(/does not belong/);
  expect(() =>
    resolveDispute(snapshotDispute(input), plan(input.id, "accepted", unchanged)),
  ).toThrow(/must revise points/);
});

it("keeps private variant pools out of the targeted dispute prompt", () => {
  const { input } = seed();
  const snapshot = snapshotDispute(input);
  const rubric = JSON.parse(snapshot.rubric);
  rubric.check.q.variants = [
    { expected: "PRIVATE-FUTURE-VARIANT", question_html: "PRIVATE-SOURCE-PLAN" },
  ];
  snapshot.rubric = JSON.stringify(rubric);
  const prompt = disputePrompt(snapshot, `dispute:${input.id}`, {});
  expect(prompt).not.toContain("PRIVATE-FUTURE-VARIANT");
  expect(prompt).not.toContain("PRIVATE-SOURCE-PLAN");
});

it("preserves retirement and the early cap while replaying a revised original exposure", async () => {
  const { input, submission, grade } = seed();
  // Selection timing is code-owned before dispute creation, as on a prepared early review.
  const key = "001-ownership/check/q";
  const savedSubmission = { ...submission, earlyReviewKeys: [key] };
  f.write(
    `rust/001-ownership/quiz/submissions/${submission.submittedAt}-${submission.id}.json`,
    JSON.stringify(savedSubmission),
  );
  const item = store.reviewItems("rust").find((i) => i.key === key)!;
  store.setReviewRetired("rust", key, true, 0);
  const controls = fs.readFileSync(`${f.root}/rust/.review-controls.json`, "utf8");
  const t = teacher(async () => plan(input.id));
  t.dispute(input);
  await t.idle();
  const revised = store.reviewItems("rust").find((i) => i.key === key)!;
  expect(revised).toMatchObject({
    retiredAt: expect.any(Number),
    attempts: 1,
    lastAt: submission.submittedAt,
    lastFeedbackAt: grade.gradedAt,
    delayedSuccesses: 0,
  });
  expect(revised.dueAt).toBeLessThanOrEqual(item.dueAt);
  expect(fs.readFileSync(`${f.root}/rust/.review-controls.json`, "utf8")).toBe(controls);
});

it("revises a completed review without another completion or edits to a saved daily plan", async () => {
  const { submission, grade } = seed();
  const lesson = "002-review";
  for (const file of ["lesson.html", "lesson.json", "quiz/key.json"])
    f.write(
      `rust/${lesson}/${file}`,
      fs.readFileSync(`${f.root}/rust/001-ownership/${file}`, "utf8"),
    );
  const items = store.reviewItems("rust");
  const review = store.createSubmission({
    ...submission,
    lesson,
    kind: "review",
    answers: submission.answers.map((a) => ({
      ...a,
      reviewOf: `001-ownership/check/${a.questionId}`,
    })),
  });
  const firstGrade = applyGrade(review, {
    score: grade.score,
    questions: grade.questions,
    feedbackMarkdown: "Original review grade",
  });
  const selected = {
    id: randomUUID(),
    classroom: "rust",
    lesson,
    owner: "service",
    ownerPid: process.pid,
    at: review.submittedAt,
    items,
    status: "done",
  };
  f.write("rust/.reviews.json", JSON.stringify({ version: 1, requests: [selected] }));
  const dailyBytes = JSON.stringify({
    version: 1,
    requests: [
      {
        id: randomUUID(),
        at: selected.at,
        owner: "service",
        groups: [{ classroom: "rust", title: "Rust", plan: selected }],
      },
    ],
  });
  f.write(".daily-reviews.json", dailyBytes);
  const { rootReservations, rootWorkload } = await import("../src/review-workload.ts");
  const originalReservations = rootReservations();
  const beforeAllowance = rootWorkload(firstGrade.gradedAt + DAY_MS).allowance;
  const t = teacher(async () => plan("review-dispute"));
  t.dispute({
    ...location,
    lesson,
    id: "review-dispute",
    quizId: "check",
    submissionId: review.id,
    questionId: "q",
    gradedAt: firstGrade.gradedAt,
    reason: "The original review answer already averaged the squares.",
  });
  await t.idle();
  expect(readTeacherState("rust")!.requests.at(-1)).toMatchObject({
    kind: "dispute",
    status: "done",
  });
  expect(store.listGrades("rust", lesson)).toHaveLength(2);
  expect(rootReservations()).toEqual(originalReservations);
  expect(rootWorkload(firstGrade.gradedAt + DAY_MS).allowance).toBe(beforeAllowance);
  expect(fs.readFileSync(`${f.root}/.daily-reviews.json`, "utf8")).toBe(dailyBytes);
  expect(
    store
      .reviewEvents("rust")
      .filter((e) => e.attemptId === review.id)
      .every((e) => e.at === review.submittedAt && e.feedbackAt === firstGrade.gradedAt),
  ).toBe(true);
});
