import { afterEach, beforeEach, expect, it } from "vitest";
import { makeFixture, seedClassroom, type Fixture } from "./helpers.ts";
import * as store from "../src/store.ts";
import * as server from "../src/server.ts";
import { ClassroomBridge } from "../src/bridge.ts";
import { completeClosedSubmission } from "../src/quiz-grading.ts";
import { TeacherService } from "../src/teacher-service.ts";
import { readTeacherState, saveTeacherState } from "../src/service-state.ts";
import { classroomTools, PI_HOST, isFailure } from "../src/tools.ts";
import { gradePrompt } from "../src/prompts.ts";
import { LearnerInbox, recoverLearnerRequests } from "../src/mcp.ts";

let fixture: Fixture;
const location = { classroom: "rust", lesson: "001-ownership" };
const choice: store.QuizAnswer = { questionId: "closed", type: "choice", value: "a", label: "a" };
const short: store.QuizAnswer = { questionId: "open", type: "short", value: "A partial reason." };
const criteria = (expected: unknown, points: number) => ({
  expected,
  points,
  full: "Private full credit explanation.",
  partial: "Reasoning earns partial credit.",
});
function seed(mixed = false, kind = "check") {
  fixture.write(
    "rust/001-ownership/lesson.json",
    JSON.stringify({ title: "Quiz", assessmentContract: 1 }),
  );
  fixture.write(
    "rust/001-ownership/lesson.html",
    `<form class="cl-quiz" data-quiz-id="check" data-kind="${kind}"><li class="cl-q" data-question-id="closed" data-type="choice"></li>${mixed ? '<li class="cl-q" data-question-id="open" data-type="short"></li>' : ""}</form>`,
  );
  fixture.write(
    "rust/001-ownership/quiz/key.json",
    JSON.stringify({
      check: {
        closed: criteria("a", 2),
        ...(mixed ? { open: criteria("A complete reason.", 4) } : {}),
      },
    }),
  );
}
function submit(mixed = false) {
  return store.createSubmission({
    ...location,
    quizId: "check",
    quizTitle: "Check",
    kind: "check",
    answers: mixed ? [choice, short] : [choice],
  });
}
const tool = () => classroomTools(PI_HOST).find((t) => t.name === "grade_lesson_quiz")!;
const teacherGrade = (id: string) => ({
  submission_id: id,
  score: 50,
  feedback_markdown: "Keep the reason.",
  questions: [
    {
      question_id: "open",
      correct: false,
      points_earned: 2,
      points_possible: 4,
      feedback: "Explain the missing step.",
    },
  ],
});
beforeEach(() => {
  fixture = makeFixture();
  seedClassroom(fixture);
});
afterEach(async () => {
  await server.close();
  fixture.cleanup();
});

it("saves a private grading plan before writes and recovers it once despite a changed key", async () => {
  seed();
  const s = submit();
  expect(store.listGrades(...(Object.values(location) as [string, string]))).toHaveLength(0);
  expect(store.findSubmission(s.id)!.deterministicGrades).toEqual(s.deterministicGrades);
  expect(store.publicSubmission(s)).not.toHaveProperty("deterministicGrades");
  fixture.write("rust/001-ownership/quiz/key.json", "changed after submission");
  const base = await server.start(0);
  expect(store.latestGrades(location.classroom, location.lesson)[0]).toMatchObject({
    submissionId: s.id,
    score: 100,
  });
  const first = store.listGrades(location.classroom, location.lesson);
  const state = await (await fetch(`${base}/api/state?classroom=rust&lesson=001-ownership`)).json();
  expect(JSON.stringify(state)).not.toContain("deterministicGrades");
  for (const url of [
    "/c/rust/001-ownership/quiz/key.json",
    "/c/rust/001-ownership/quiz/submissions/anything.json",
  ])
    expect((await fetch(base + url)).status).toBe(404);
  const bridge = new ClassroomBridge({
    sendUserMessage: () => {
      throw new Error("Unexpected Pi turn");
    },
  });
  bridge.grade(store.findSubmission(s.id)!);
  const inbox = new LearnerInbox();
  recoverLearnerRequests(inbox, ["rust"]);
  expect(inbox.size).toBe(0);
  const service = new TeacherService(async () => {
    throw new Error("Unexpected service turn");
  });
  try {
    service.attach("rust", "codex");
    await service.idle();
    expect(readTeacherState("rust")!.requests).toEqual([]);
  } finally {
    await service.stop();
  }
  await server.close();
  await server.start(0);
  expect(store.listGrades(location.classroom, location.lesson)).toEqual(first);
});

it("grades HTTP closed submissions before dispatch and rejects malformed keys before saving", async () => {
  seed();
  let turns = 0;
  server.setHooks({
    onQuizSubmit: () => {
      turns++;
    },
    onAsk: () => {},
    onFollowUp: () => {},
    onReflect: () => {},
  });
  const base = await server.start(0);
  const post = () =>
    fetch(base + "/api/quiz/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...location, quizId: "check", kind: "check", answers: [choice] }),
    });
  fixture.write(
    "rust/001-ownership/quiz/key.json",
    JSON.stringify({ check: { closed: criteria(["a"], 2) } }),
  );
  const invalid = await post();
  expect(invalid.status).toBe(400);
  expect((await invalid.json()).error).toContain("machine-checkable");
  expect(store.listSubmissions(location.classroom, location.lesson)).toEqual([]);
  seed();
  const response = await post();
  expect(response.status).toBe(201);
  const result = await response.json();
  expect(result).not.toHaveProperty("deterministicGrades");
  expect(store.latestGrades(location.classroom, location.lesson)).toHaveLength(1);
  expect(turns).toBe(0);
});

it("merges mixed quiz points and forbids regrading a closed answer", async () => {
  seed(true);
  const s = submit(true);
  expect(completeClosedSubmission(s)).toBe(false);
  const prompt = gradePrompt(s, "push");
  expect(prompt).toContain("[open]");
  expect(prompt).not.toContain("[closed]");
  for (const params of [
    {
      ...teacherGrade(s.id),
      questions: [
        ...teacherGrade(s.id).questions,
        {
          question_id: "closed",
          correct: true,
          feedback: "Override",
          points_earned: 2,
          points_possible: 2,
        },
      ],
    },
    { ...teacherGrade(s.id), score: 100 },
    { ...teacherGrade(s.id), questions: [] },
    {
      ...teacherGrade(s.id),
      questions: teacherGrade(s.id).questions.map((q) => ({ ...q, question_id: "unknown" })),
    },
  ])
    expect(isFailure(await tool().execute(params))).toBe(true);
  expect(store.latestGrades(location.classroom, location.lesson)).toEqual([]);
  expect(isFailure(await tool().execute(teacherGrade(s.id)))).toBe(false);
  const g = store.latestGrades(location.classroom, location.lesson)[0];
  expect(g.score).toBeCloseTo((100 * 4) / 6);
  expect(g.questions.map((q) => [q.questionId, q.pointsEarned, q.pointsPossible])).toEqual([
    ["closed", 2, 2],
    ["open", 2, 4],
  ]);
});

it("recovers a mixed service plan with only judgment allocations without another model turn", async () => {
  seed(true);
  const s = submit(true);
  let runs = 0;
  const teacher = new TeacherService(async () => {
    runs++;
    const { score, ...args } = teacherGrade(s.id);
    return {
      calls: [{ name: "grade_quiz_answers", arguments_json: JSON.stringify(args) }],
      message: "Explain the missing step with another example.",
      learning_record: "",
      notes_markdown: "",
    };
  });
  try {
    teacher.attach("rust", "codex");
    await teacher.idle();
  } finally {
    await teacher.stop();
  }
  expect(runs).toBe(1);
  expect(store.latestGrades(location.classroom, location.lesson)[0].score).toBeCloseTo(
    (100 * 4) / 6,
  );
  const prior = store.listGrades(location.classroom, location.lesson);
  const savedState = readTeacherState("rust")!;
  savedState.requests[0].status = "planned";
  savedState.requests[0].applied = 0;
  saveTeacherState("rust", savedState);
  const recovered = new TeacherService(async () => {
    throw new Error("Unexpected recovery turn");
  });
  try {
    recovered.attach("rust", "codex");
    await recovered.idle();
  } finally {
    await recovered.stop();
  }
  expect(store.listGrades(location.classroom, location.lesson)).toEqual(prior);
  expect(readTeacherState("rust")!.requests[0].status).toBe("done");
});

it("applies a saved mixed plan before its first grade write without a model call", async () => {
  seed(true);
  const s = submit(true);
  const { score, ...args } = teacherGrade(s.id);
  saveTeacherState("rust", {
    version: 1,
    identity: { backend: "codex" },
    messages: [],
    requests: [
      {
        id: `quiz:${s.id}`,
        classroom: "rust",
        lesson: location.lesson,
        kind: "quiz",
        target: s.id,
        status: "planned",
        at: Date.now(),
        prompt: gradePrompt(s, "service"),
        planVersion: 2,
        planRubricDigest: s.rubricDigest,
        applied: 0,
        plan: {
          calls: [{ name: "grade_quiz_answers", arguments_json: JSON.stringify(args) }],
          message: "Explain the missing step.",
          learning_record: "",
          notes_markdown: "",
        },
      },
    ],
  });
  const teacher = new TeacherService(async () => {
    throw new Error("Saved plans must not call the model");
  });
  try {
    teacher.attach("rust", "codex");
    await teacher.idle();
  } finally {
    await teacher.stop();
  }
  expect(readTeacherState("rust")!.requests[0].status).toBe("done");
  const grades = store.latestGrades(location.classroom, location.lesson);
  expect(grades).toHaveLength(1);
  expect(grades[0].score).toBeCloseTo((100 * 4) / 6);
  expect(grades[0].questions[0]).toMatchObject(s.deterministicGrades![0]);
});

it("keeps the original rubric contract for attempts saved before machine grading", async () => {
  seed();
  fixture.write(
    "rust/001-ownership/lesson.html",
    '<form class="cl-quiz" data-quiz-id="check"><li class="cl-q" data-question-id="closed" data-type="numeric"></li></form>',
  );
  fixture.write(
    "rust/001-ownership/quiz/key.json",
    JSON.stringify({ check: { closed: criteria("2.5", 2) } }),
  );
  const saved: store.QuizSubmission = {
    ...location,
    id: "historical",
    quizId: "check",
    quizTitle: "Historical",
    submittedAt: 1,
    assessmentContract: 1,
    answers: [{ questionId: "closed", type: "numeric", value: "2.5" }],
  };
  fixture.write("rust/001-ownership/quiz/submissions/1-historical.json", JSON.stringify(saved));
  expect(completeClosedSubmission(saved)).toBe(false);
  const result = await tool().execute({
    submission_id: "historical",
    score: 100,
    feedback_markdown: "Correct.",
    questions: [
      {
        question_id: "closed",
        correct: true,
        points_earned: 2,
        points_possible: 2,
        feedback: "The mean is 2.5.",
      },
    ],
  });
  expect(isFailure(result)).toBe(false);
  expect(store.latestGrades(location.classroom, location.lesson)[0].score).toBe(100);
});
