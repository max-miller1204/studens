/** Shared learner path for fixture and real dedicated Pi/Claude/Codex teachers. */
import * as fs from "node:fs";
import * as path from "node:path";
import * as store from "../src/store.ts";
import { applyGrade } from "../src/quiz-grading.ts";
import { allocateCriteria } from "../src/criteria.ts";
import { readTeacherState } from "../src/service-state.ts";
import { lessonHtml } from "../test/helpers.ts";
import { playwrightCode } from "./playwright.ts";

export const DISPUTE_LESSON = "997-grade-dispute";
export function seedDisputeProbe(root: string) {
  const dir = path.join(root, "rust", DISPUTE_LESSON);
  fs.mkdirSync(path.join(dir, "quiz"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "lesson.json"),
    JSON.stringify({ title: "Review a grade", assessmentContract: 1, criterionContract: 1 }),
  );
  fs.writeFileSync(
    path.join(dir, "lesson.html"),
    lessonHtml(
      "Review a grade",
      `
    <h1>Review a grade</h1><p>Your original answers stay saved while your teacher reviews a dispute.</p>
    <form class="cl-quiz" data-quiz-id="check" data-title="Mean squared error"><ol class="cl-questions">
    <li class="cl-q" data-question-id="mse" data-type="short"><p class="cl-q-prompt">Residuals are 2 and -1. Calculate mean squared error and show your work.</p><textarea></textarea></li>
    <li class="cl-q" data-question-id="exact" data-type="choice"><p class="cl-q-prompt">What is 2 + 2?</p><label><input type="radio" name="exact" value="a">4</label><label><input type="radio" name="exact" value="b">5</label></li>
    </ol></form>`,
    ),
  );
  fs.writeFileSync(
    path.join(dir, "quiz/key.json"),
    JSON.stringify({
      check: {
        mse: {
          expected: "(4+1)/2=2.5",
          points: 4,
          full: "Accept equivalent correct calculations. Both sum and average required.",
          partial: "2 for sum 5; 2 for average 2.5.",
          criteria: [
            { id: "sum", description: "Square and sum the residuals", points: 2 },
            { id: "mean", description: "Average the squared residuals", points: 2 },
          ],
        },
        exact: {
          expected: "a",
          points: 1,
          full: "4",
          partial: "0 for other answers",
          criteria: [{ id: "exact", description: "Correct sum", points: 1 }],
        },
      },
    }),
  );
  const submission = store.createSubmission({
    classroom: "rust",
    lesson: DISPUTE_LESSON,
    quizId: "check",
    quizTitle: "Mean squared error",
    kind: "check",
    answers: [
      {
        questionId: "mse",
        type: "short",
        prompt: "Residuals are 2 and -1. Calculate mean squared error and show your work.",
        value:
          "The squares are 4 and 1. Their sum is 5. Dividing by the two residuals gives 5/2 = 2.5.",
        assistance: "none",
      },
      {
        questionId: "exact",
        type: "choice",
        prompt: "What is 2 + 2?",
        value: "b",
        label: "5",
        assistance: "none",
      },
    ],
  });
  // Deliberate old misallocation at the production persistence boundary, not a claim about real first-pass grading.
  const grade = applyGrade(submission, {
    score: 40,
    feedbackMarkdown: "The squared sum earns credit. The average was not credited.",
    questions: [
      ...submission.deterministicGrades!,
      {
        questionId: "mse",
        correct: false,
        pointsEarned: 2,
        pointsPossible: 4,
        feedback: "The average was not credited.",
        criteria: allocateCriteria(submission, "mse", [
          { criterion_id: "sum", points_earned: 2, feedback: "The sum of squares is 5." },
          { criterion_id: "mean", points_earned: 0, feedback: "The average was not credited." },
        ]),
      },
    ],
  });
  return { submission, grade };
}
export async function driveDisputeProbe(
  session: string,
  root: string,
  base: string,
  artifacts: string | null,
  seed = seedDisputeProbe(root),
) {
  if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
  const save = (name: string, value: unknown) => {
    if (artifacts)
      fs.writeFileSync(path.join(artifacts, name + ".json"), JSON.stringify(value, null, 2));
  };
  const stateUrl = `${base}/api/state?classroom=rust&lesson=${DISPUTE_LESSON}`;
  const beforeEvents = store.reviewEvents("rust").filter((e) => e.attemptId === seed.submission.id);
  const original = JSON.stringify(seed.grade),
    originalSubmission = JSON.stringify(seed.submission);
  async function waitForDispute(question: string) {
    const deadline = Date.now() + 185_000;
    while (Date.now() < deadline) {
      const state = await (await fetch(stateUrl)).json();
      const dispute = state.teacher?.disputes?.filter((d: any) => d.questionId === question).at(-1);
      if (dispute?.status === "failed") {
        save("failed-" + question, { state, teacher: readTeacherState("rust") });
        throw new Error(dispute.error);
      }
      if (dispute?.status === "done") return state;
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error("Timed out waiting for dispute resolution: " + question);
  }
  const shot = (name: string) =>
    artifacts
      ? `await page.screenshot({path:${JSON.stringify(path.join(artifacts, name + ".png"))},fullPage:true});`
      : "";
  try {
    save("seed", {
      ...seed,
      fixtureLimit:
        "Original misallocation is a deliberate fixture. Only disputes use the real host in host targets.",
      beforeEvents,
    });
    await playwrightCode(
      session,
      root,
      `async page=>{
      await page.goto(${JSON.stringify(base + "/c/rust/" + DISPUTE_LESSON)});
      await page.locator('form[data-state="graded"]').waitFor();
      const q=page.locator('.cl-q[data-question-id="mse"]');
      await q.getByText('I think this deserves credit',{exact:true}).click();
      await q.getByRole('button',{name:'Send grade dispute',exact:true}).click();
      await q.getByRole('alert').getByText('Explain why your original answer deserves credit.',{exact:true}).waitFor();
      await q.getByLabel('Why does your original answer deserve credit?').fill('My original answer already says dividing by the two residuals gives 5/2 = 2.5. Please check that original averaging step under the original mean criterion. I am not changing my answer.');
      await q.getByLabel('Why does your original answer deserve credit?').press('Control+Enter'); return true;
    }`,
    );
    const revised = await waitForDispute("mse");
    save("judgment", { state: revised, teacher: readTeacherState("rust") });
    if (
      revised.quizzes[0].grade.score !== 80 ||
      revised.teacher.disputes[0].decision !== "accepted"
    )
      throw new Error(
        "The original correct averaging step did not receive its fixed criterion credit.",
      );
    const history = store.listGrades("rust", DISPUTE_LESSON);
    if (
      history.length !== 2 ||
      JSON.stringify(history[0]) !== original ||
      JSON.stringify(store.findSubmission(seed.submission.id)) !== originalSubmission
    )
      throw new Error("Dispute changed original history or answer snapshot.");
    const events = store.reviewEvents("rust").filter((e) => e.attemptId === seed.submission.id);
    if (
      events.length !== beforeEvents.length ||
      events.some(
        (e) => e.at !== seed.submission.submittedAt || e.feedbackAt !== seed.grade.gradedAt,
      )
    )
      throw new Error("Dispute created an exposure or newer elapsed-time evidence.");
    await playwrightCode(
      session,
      root,
      `async page=>{
      await page.reload(); await page.locator('form[data-state="graded"]').waitFor();
      await page.locator('.cl-q[data-question-id="mse"] .cl-dispute-response').waitFor();
      if(!await page.locator('.cl-q[data-question-id="mse"] > textarea').isDisabled())throw new Error('Original answer unlocked');
      await page.getByText('Grade history (2)',{exact:true}).click();
      await page.getByRole('heading',{name:/Original grade/}).waitFor();
      await page.setViewportSize({width:1280,height:900});${shot("judgment-desktop")}
      await page.setViewportSize({width:375,height:812});${shot("judgment-mobile")}
      if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Mobile dispute overflow');
      const q=page.locator('.cl-q[data-question-id="exact"]');
      await q.getByText('I think this deserves credit',{exact:true}).click();
      await q.getByLabel('Why does your original answer deserve credit?').fill('I chose 5 for 2 + 2. I think it deserves credit, but please explain the machine result. Do not change the key or my original answer.');
      await q.getByRole('button',{name:'Send grade dispute',exact:true}).click(); return true;
    }`,
    );
    const machine = await waitForDispute("exact");
    save("machine", { state: machine, teacher: readTeacherState("rust"), events });
    if (
      machine.teacher.disputes.find((d: any) => d.questionId === "exact").decision === "accepted" ||
      JSON.stringify(store.listGrades("rust", DISPUTE_LESSON)) !== JSON.stringify(history)
    )
      throw new Error("A machine dispute changed grade history.");
    await playwrightCode(
      session,
      root,
      `async page=>{
      await page.reload(); await page.locator('.cl-q[data-question-id="exact"] .cl-dispute-response').waitFor();
      await page.locator('.cl-q[data-question-id="mse"] .cl-dispute-response').waitFor();
      const state=await (await page.request.get(${JSON.stringify(stateUrl)})).text();
      for(const secret of ['rubricCriteria','deterministicGrades','privateRubric','"rubric":','"teachingPlan":'])if(state.includes(secret))throw new Error('Private dispute snapshot exposed: '+secret);
      if(!await page.getByRole('button',{name:'Graded',exact:true}).isDisabled())throw new Error('Grade unlocked');
      await page.setViewportSize({width:1280,height:900});${shot("machine-desktop")}
      await page.locator('[data-cl-theme-toggle]').click();${shot("machine-dark-desktop")}
      await page.setViewportSize({width:375,height:812});${shot("machine-dark-mobile")}
      return true;
    }`,
    );
    save("result", {
      verdict: "PASS",
      histories: history,
      events,
      schedules: store.reviewItems("rust").filter((i) => i.lesson === DISPUTE_LESSON),
      teacher: readTeacherState("rust"),
    });
    console.log(
      "PASS: learner dispute reason, real resolution, judgment 2/4 to 4/4 in mixed 4/5 grade, machine explanation without override, immutable history, original timing, reload and locks",
    );
  } catch (error) {
    save("failure", {
      error: String(error),
      state: await (await fetch(stateUrl)).json(),
      teacher: readTeacherState("rust"),
    });
    throw error;
  }
}
