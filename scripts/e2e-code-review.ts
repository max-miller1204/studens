/** Prepared code variants and durable grade retry through the review UI (fixture teacher). */
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { makeFixture, seedClassroom, lessonHtml, writeGradedAttempt } from "../test/helpers.ts";
import { codeForm, codeQuestion, codeRubric, exercise, source } from "../test/code-fixture.ts";
import * as server from "../src/server.ts";
import * as store from "../src/store.ts";
import { TeacherService } from "../src/teacher-service.ts";
import { readTeacherState } from "../src/service-state.ts";
import { currentReview } from "../src/review-session.ts";
import { DAY_MS } from "../src/review.ts";
import { playwright, playwrightCode } from "./playwright.ts";

export async function verifyCodeReview(artifacts: string | null): Promise<void> {
  const f = makeFixture();
  seedClassroom(f);
  if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
  const objective = {
    statement: "Implement a function that accumulates all numbers, using zero for empty input",
    application: true,
  };
  const variantExercise = {
    ...exercise,
    tests: [
      { id: "empty", args: [[]], expected: 0 },
      { id: "new-values", args: [[7, -2, 1]], expected: 6 },
    ],
  };
  const variants = ["v1", "v2", "v3"].map((id) => ({
    id,
    html: codeQuestion(undefined, variantExercise, id),
    rubric: codeRubric,
  }));
  const mapping = {
    objective: "sum",
    task: "application",
    support: "independent",
    variants: Object.fromEntries(
      variants.map((v) => [
        v.id,
        { objective: "original", task: "application", support: "independent" },
      ]),
    ),
  };
  f.write("rust/001-ownership/lesson.html", lessonHtml("Sum values", codeForm()));
  f.write(
    "rust/001-ownership/lesson.json",
    JSON.stringify({
      title: "Sum values",
      assessmentContract: 1,
      criterionContract: 1,
      instructionalContract: 1,
      reviewVariantContract: 1,
    }),
  );
  f.write(
    "rust/001-ownership/quiz/key.json",
    JSON.stringify({ check: { sum: { ...codeRubric, variants } } }),
  );
  f.write(
    "rust/001-ownership/quiz/plan.json",
    JSON.stringify({
      version: 1,
      objectives: { sum: objective },
      quizzes: { check: { purpose: "assessment", questions: { sum: mapping } } },
    }),
  );
  writeGradedAttempt({
    quizId: "check",
    at: Date.now() - 2 * DAY_MS,
    answers: [
      {
        questionId: "sum",
        type: "code",
        value: source,
        code: { exercise },
        assistance: "none",
        learning: {
          objectiveId: "sum",
          objective,
          task: "application",
          support: "independent",
          assistance: "none",
        },
      },
    ],
    correct: { sum: true },
  });
  let turns = 0,
    opened = false;
  const teacher = new TeacherService(async (_identity, prompt) => {
    turns++;
    const id = /submission_id: "([^"]+)"/.exec(prompt)?.[1];
    if (!id) throw new Error("Unexpected non-grade fixture turn");
    const s = store.findSubmission(id);
    if (!s) throw new Error("Missing review submission");
    const a = s.answers[0];
    if (a.type !== "code" || a.value !== source)
      throw new Error("Review lost original code source");
    const criteria =
      turns === 1
        ? []
        : [
            {
              criterion_id: "accumulate",
              points_earned: 1,
              feedback: "The source adds every input value.",
            },
            {
              criterion_id: "empty",
              points_earned: 1,
              feedback: "The zero initial accumulator handles empty input.",
            },
          ];
    return {
      calls: [
        {
          name: "grade_quiz_answers",
          arguments_json: JSON.stringify({
            submission_id: id,
            feedback_markdown: "The saved source implements both rubric components.",
            questions: [
              {
                question_id: a.questionId,
                correct: true,
                points_earned: 2,
                points_possible: 2,
                feedback: "The reducer accumulates every value and starts at zero.",
                criteria,
              },
            ],
          }),
        },
      ],
      message:
        "For a new list containing 8 and -3, explain how the accumulator changes after each value.",
      learning_record: "",
      notes_markdown: "",
    };
  });
  teacher.attach("rust", "codex");
  teacher.connect();
  const session = `studens-code-review-${process.pid}`;
  try {
    const base = await server.start(0);
    await playwright(session, f.root, "open", base + "/c/rust");
    opened = true;
    await playwrightCode(
      session,
      f.root,
      `async page=>{
      await page.getByRole('button',{name:'Start review',exact:true}).click();await page.locator('form.cl-quiz[data-state="fresh"]').waitFor();
      if(await page.locator('.cl-q[data-type="code"]').count()!==1)throw new Error('Prepared review did not preserve code type');
      await page.locator('textarea.cl-code-source').fill(${JSON.stringify(source)});await page.locator('[data-cl-code-run]').click();await page.locator('.cl-code-runner[data-run-state="complete"]').waitFor();if(await page.locator('[data-outcome="passed"]').count()!==2)throw new Error('Prepared code tests did not run');
      await page.getByRole('button',{name:'Submit for grading',exact:true}).click();await page.getByRole('button',{name:'Retry request',exact:true}).waitFor();return true;
    }`,
    );
    await teacher.idle();
    const review = currentReview("rust")!;
    const saved = store.listSubmissions("rust", review.lesson)[0];
    const digest = (value: unknown) =>
      createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const snapshot = digest(saved);
    if (turns !== 1 || store.listGrades("rust", review.lesson).length)
      throw new Error("Invalid code criterion plan graded or retried automatically");
    if (artifacts)
      fs.writeFileSync(
        path.join(artifacts, "failed-plan.json"),
        JSON.stringify(readTeacherState("rust"), null, 2),
      );
    await playwrightCode(
      session,
      f.root,
      `async page=>{
      await page.reload();await page.getByRole('button',{name:'Retry request',exact:true}).waitFor();if(!await page.locator('[data-cl-code-run]').isDisabled())throw new Error('Pending review code unlocked');
      await page.getByRole('button',{name:'Retry request',exact:true}).click();await page.locator('form.cl-quiz[data-state="graded"]').waitFor();await page.reload();await page.locator('form.cl-quiz[data-state="graded"]').waitFor();if(await page.locator('.cl-q-criteria li').count()!==2)throw new Error('Review criteria missing');if(await page.locator('textarea.cl-code-source').inputValue()!==${JSON.stringify(source)})throw new Error('Review source changed');
      ${artifacts ? `await page.setViewportSize({width:375,height:812});await page.screenshot({path:${JSON.stringify(path.join(artifacts, "code-review-graded.png"))},fullPage:true});` : ""}
      return true;
    }`,
    );
    await teacher.idle();
    if (
      Number(turns) !== 2 ||
      store.listGrades("rust", review.lesson).length !== 1 ||
      digest(store.listSubmissions("rust", review.lesson)[0]) !== snapshot
    )
      throw new Error("Code review retry duplicated grading or changed source/run snapshot");
    if (artifacts)
      fs.writeFileSync(
        path.join(artifacts, "report.json"),
        JSON.stringify(
          {
            verdict: "PASS",
            kind: "fixture-teacher-browser",
            turns,
            review,
            submission: saved,
            submissionHash: snapshot,
            teacher: readTeacherState("rust"),
            grades: store.listGrades("rust", review.lesson),
          },
          null,
          2,
        ),
      );
    console.log(
      "PASS: prepared private code variant, actual browser tests, review submission, failed criterion plan, explicit retry and one immutable grade after reload (fixture teacher).",
    );
  } finally {
    await teacher.stop();
    if (opened) await playwright(session, f.root, "close");
    await server.close();
    f.cleanup();
  }
}

if (process.argv[1]?.endsWith("/e2e-code-review.ts"))
  await verifyCodeReview(process.argv[2] ?? null);
