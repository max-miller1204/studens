/** Evaluate rubric fidelity with alternate, partial, uncertain, assisted, and old answers. */
import * as fs from "node:fs";
import { createHash } from "node:crypto";
import { submissionsDir } from "../src/paths.ts";
import * as server from "../src/server.ts";
import { playwright, playwrightCode } from "./playwright.ts";
import { hasQuestionExplanation, questionFeedbackText } from "./feedback-explanation.ts";
import * as path from "node:path";
import { makeFixture, seedClassroom, lessonHtml } from "../test/helpers.ts";
import { dedicatedTeacherPrompt, gradePrompt } from "../src/prompts.ts";
import { classroomTools, PI_HOST, isFailure } from "../src/tools.ts";
import { answerGradingTool, GRADE_ANSWERS } from "../src/teacher-grading.ts";
import { parsePlan, runTeacher } from "../src/teacher.ts";
import * as store from "../src/store.ts";
import { parseHarness, useTestModel } from "./harness.ts";

const backend = parseHarness(
  process.argv[2],
  "Usage: node scripts/e2e-feedback.ts <claude|codex> [artifacts] [saved-plan-replay]",
);
const replayPath = process.argv[4] ? path.resolve(process.argv[4]) : null;
const artifacts = process.argv[3] ? path.resolve(process.argv[3]) : null;
if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
const fixture = makeFixture();
seedClassroom(fixture);
const questions = [
  {
    id: "alternate",
    prompt:
      "Two threads each read x, add one locally, then write x. Initially x=0. Give a legal schedule that ends at x=1. Thread names and independent read order may vary.",
    answer: "B reads 0; A reads 0; B writes 1; A writes 1.",
    expected: "Both reads happen before either write. Either thread can read or write first.",
    points: 4,
    earned: 4,
    partial:
      "2 points for a legal order of each thread; 2 for final value 1 with both reads before writes.",
  },
  {
    id: "partial",
    prompt:
      "Residuals are 2 and -1. Calculate mean squared error. Show the sum and the averaging step.",
    answer: "The squared errors sum to 5. Therefore the mean squared error is 5.",
    expected: "Sum 5; divide by 2; mean 2.5.",
    points: 4,
    earned: 2,
    partial: "2 points for sum 5; 2 points for dividing by 2 to get 2.5.",
  },
  {
    id: "uncertain",
    prompt: "Residuals are 2 and -1. Calculate mean squared error.",
    answer: "(4+1)/2=2.5.",
    expected: "2.5",
    points: 2,
    earned: 2,
    confidence: "unsure" as const,
    partial: "1 point for correct sum 5 without the mean; otherwise 0.",
  },
  {
    id: "sure",
    prompt: "Residuals are 2 and -1. Calculate mean squared error.",
    answer: "(4+1)/2=2.5.",
    expected: "2.5",
    points: 2,
    earned: 2,
    confidence: "sure" as const,
    partial: "1 point for correct sum 5 without the mean; otherwise 0.",
  },
  {
    id: "assisted",
    prompt: "Residuals are 2 and -1. Calculate mean squared error.",
    answer: "(4+1)/2=2.5.",
    expected: "2.5",
    points: 2,
    earned: 2,
    assistance: "hint" as const,
    partial: "1 point for correct sum 5 without the mean; otherwise 0.",
  },
  {
    id: "historical",
    prompt: "Residuals are 2 and -1. Calculate mean squared error.",
    answer: "(4+1)/2=2.5.",
    expected: "2.5",
    points: 2,
    earned: 2,
    partial: "1 point for correct sum 5 without the mean; otherwise 0.",
  },
];
const html = `<form class="cl-quiz" data-quiz-id="check"><li class="cl-q" data-question-id="closed" data-type="choice"><p class="cl-q-prompt">Which value is the mean squared error?</p><label><input type="radio" name="closed" value="a">2.5</label><label><input type="radio" name="closed" value="b">5</label></li>${questions.map((q) => `<li class="cl-q" data-question-id="${q.id}" data-type="short"><p class="cl-q-prompt">${q.prompt}</p><textarea></textarea></li>`).join("")}</form>`;
const rubric = {
  check: {
    closed: {
      criteria: [{ id: "selection", description: "Select the mean squared error", points: 2 }],
      expected: "a",
      points: 2,
      full: "The mean squared error is 2.5.",
      partial: "None.",
    },
    ...Object.fromEntries(
      questions.map((q) => [
        q.id,
        {
          expected: q.expected,
          points: q.points,
          full: `Award ${q.points} for an equivalent correct solution. ${q.expected}`,
          partial: q.partial,
          criteria:
            q.id === "alternate"
              ? [
                  {
                    id: "legal",
                    description: "Preserve each thread's read-before-write order",
                    points: 2,
                  },
                  { id: "overlap", description: "Use both old reads to finish at one", points: 2 },
                ]
              : [
                  { id: "sum", description: "Square and sum the residuals", points: q.points / 2 },
                  {
                    id: "mean",
                    description: "Divide the squared sum by the residual count",
                    points: q.points / 2,
                  },
                ],
        },
      ]),
    ),
  },
};
fixture.write("rust/001-ownership/lesson.html", html);
fixture.write(
  "rust/001-ownership/lesson.json",
  JSON.stringify({ title: "Feedback evaluation", assessmentContract: 1 }),
);
fixture.write("rust/001-ownership/quiz/key.json", JSON.stringify(rubric));
const restoreModel = replayPath ? () => {} : useTestModel(backend);
try {
  const submission = store.createSubmission({
    classroom: "rust",
    lesson: "001-ownership",
    quizId: "check",
    quizTitle: "Feedback evaluation",
    kind: "check",
    answers: [
      { questionId: "closed", type: "choice", value: "a", label: "2.5" },
      ...questions.map((q) => ({
        questionId: q.id,
        type: "short" as const,
        prompt: q.prompt,
        value: q.answer,
        ...(q.confidence ? { confidence: q.confidence } : {}),
        ...(q.assistance ? { assistance: q.assistance } : {}),
      })),
    ],
  });
  const definitions = classroomTools(PI_HOST)
    .filter((t) => t.name === "grade_lesson_quiz")
    .map(answerGradingTool);
  const plan = replayPath
    ? parsePlan(JSON.parse(fs.readFileSync(replayPath, "utf8")))
    : await runTeacher(
        { backend },
        dedicatedTeacherPrompt(
          "feedback-evaluation",
          gradePrompt(submission, "service"),
          { lesson: html, privateRubric: rubric, submission },
          definitions,
        ),
        fixture.root,
        () => {},
        undefined,
        { operations: [GRADE_ANSWERS], required: true, messageRequired: true },
        (raw) => {
          if (artifacts)
            fs.writeFileSync(
              path.join(artifacts, `${backend}-feedback-raw.json`),
              JSON.stringify(raw, null, 2),
            );
        },
      );
  if (artifacts)
    fs.writeFileSync(
      path.join(artifacts, `${backend}-feedback-plan.json`),
      JSON.stringify(plan, null, 2),
    );
  if (plan.calls.length !== 1 || plan.calls[0].name !== GRADE_ANSWERS)
    throw new Error("Feedback evaluation needs one grade call.");
  const args = JSON.parse(plan.calls[0].arguments_json);
  if (replayPath) {
    if (typeof args.submission_id !== "string" || !/^[a-f0-9-]{36}$/.test(args.submission_id))
      throw new Error("The saved feedback plan has no valid original submission id.");
    // Recreate the isolated fixture under the exact retained plan identity. This is
    // plan replay, not a fresh model run or recovery of the deleted original fixture.
    const dir = submissionsDir(submission.classroom, submission.lesson);
    const before = path.join(dir, `${submission.submittedAt}-${submission.id}.json`);
    submission.id = args.submission_id;
    const after = path.join(dir, `${submission.submittedAt}-${submission.id}.json`);
    fs.renameSync(before, after);
    fs.writeFileSync(after, JSON.stringify(submission, null, 2));
  }

  if (Object.hasOwn(args, "score")) throw new Error("The dedicated teacher must omit score.");
  if (
    args.questions.length !== questions.length ||
    args.questions.some((q: { question_id: string }) => q.question_id === "closed")
  )
    throw new Error("The teacher must grade only judgment questions.");
  for (const q of questions) {
    const verdict = args.questions.find((g: { question_id: string }) => g.question_id === q.id);
    if (!verdict || verdict.points_earned !== q.earned || verdict.points_possible !== q.points)
      throw new Error(
        `Rubric disagreement for ${q.id}: ${JSON.stringify(verdict)}. Expected ${q.earned}/${q.points}.`,
      );
    const expectedCriteria = rubric.check[q.id as keyof typeof rubric.check].criteria;
    if (verdict.criteria?.length !== expectedCriteria.length)
      throw new Error(`Missing criterion evidence for ${q.id}.`);
    for (const c of expectedCriteria) {
      const allocation = verdict.criteria.find(
        (v: { criterion_id: string }) => v.criterion_id === c.id,
      );
      const earned = q.id === "partial" && c.id === "mean" ? 0 : c.points;
      if (!allocation || allocation.points_earned !== earned || !allocation.feedback?.trim())
        throw new Error(
          `Criterion disagreement for ${q.id}/${c.id}: ${JSON.stringify(allocation)}`,
        );
    }
    if (!verdict.feedback.trim()) throw new Error(`Missing feedback for ${q.id}.`);
  }
  const uncertain = args.questions.find(
    (g: { question_id: string }) => g.question_id === "uncertain",
  );
  const uncertainFeedback = uncertain.feedback;
  if (!hasQuestionExplanation(uncertain))
    throw new Error("Uncertain correct answer needs explanatory reinforcement.");
  const result = await definitions[0].execute(args);
  if (isFailure(result)) throw new Error(result.content[0].text);
  const expectedScore = (100 * 16) / 18;
  if (result.details.score !== expectedScore)
    throw new Error(`Feedback score is ${result.details.score}, expected ${expectedScore}.`);
  if (store.reviewItems("rust").some((i) => i.progress === "retained-evidence"))
    throw new Error("Immediate or old answers cannot prove retained knowledge.");
  let visibleExplanation: unknown;
  if (replayPath) {
    fixture.write("rust/001-ownership/lesson.html", lessonHtml("Feedback evaluation", html));
    const session = `studens-feedback-replay-${process.pid}`;
    let opened = false;
    try {
      const base = await server.start(0);
      await playwright(session, fixture.root, "open", `${base}/c/rust/001-ownership`);
      opened = true;
      visibleExplanation = await playwrightCode(
        session,
        fixture.root,
        `async page=>{
        await page.locator('form[data-state="graded"]').waitFor();
        const verdict=page.locator('.cl-q[data-question-id="uncertain"] .cl-q-verdict');
        const expected=${JSON.stringify(uncertain.criteria.map((c: { feedback: string }) => c.feedback))};
        for(const explanation of expected)if(!await verdict.getByText(explanation,{exact:true}).isVisible())throw new Error('A retained criterion explanation is not visible on its question');
        if(!await page.locator('.cl-q[data-question-id="uncertain"] > textarea').isDisabled())throw new Error('Replayed graded answer unlocked');
        await page.setViewportSize({width:1280,height:900});
        ${artifacts ? `await page.screenshot({path:${JSON.stringify(path.join(artifacts, "feedback-replay-desktop.png"))},fullPage:true});` : ""}
        await page.setViewportSize({width:375,height:812});
        ${artifacts ? `await page.screenshot({path:${JSON.stringify(path.join(artifacts, "feedback-replay-mobile.png"))},fullPage:true});` : ""}
        return {questionId:'uncertain',feedback:await verdict.locator('.cl-q-verdict-feedback').innerText(),criteria:await verdict.locator('.cl-q-criteria').innerText(),allCriteriaVisible:true};
      }`,
      );
    } finally {
      if (opened) await playwright(session, fixture.root, "close");
      await server.close();
    }
  }
  const report = {
    backend,
    kind: replayPath ? "saved-model-plan-replay" : "agent-adherence",
    inference: !replayPath,
    ...(replayPath
      ? {
          replaySource: replayPath,
          replaySourceSha256: createHash("sha256")
            .update(fs.readFileSync(replayPath))
            .digest("hex"),
          fixtureLimit:
            "Recreated scratch attempt with original plan id and current fixture time. No new model inference and no recovery of the original deleted fixture.",
        }
      : {}),
    questionExplanation: questionFeedbackText(uncertain),
    visibleExplanation,
    humanLearningEvidence: false,
    expectedScore,
    machineQuestions: submission.deterministicGrades?.length,
    actualScore: result.details.score,
    cases: questions.map((q) => ({ id: q.id, expected: `${q.earned}/${q.points}` })),
    uncertainFeedback,
    savedGrades: store.listGrades("rust", "001-ownership"),
    savedSubmission: submission,
  };
  if (artifacts)
    fs.writeFileSync(
      path.join(artifacts, `${backend}-feedback-report.json`),
      JSON.stringify(report, null, 2),
    );
  console.log(JSON.stringify(report, null, 2));
} finally {
  fixture.cleanup();
  restoreModel();
}
