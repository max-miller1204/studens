/** A shared real-host criterion probe appended after each host's lifecycle checks. */
import * as fs from "node:fs";
import * as path from "node:path";
import * as store from "../src/store.ts";
import { lessonHtml } from "../test/helpers.ts";
import { until } from "./harness.ts";
import { playwrightCode } from "./playwright.ts";

export async function driveCriterionProbe(
  session: string,
  root: string,
  base: string,
  artifacts: string | null,
): Promise<void> {
  const lesson = "998-criterion-probe";
  const dir = path.join(root, "rust", lesson);
  fs.mkdirSync(path.join(dir, "quiz"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "lesson.json"),
    JSON.stringify({
      title: "Explain mean squared error",
      assessmentContract: 1,
      criterionContract: 1,
    }),
  );
  fs.writeFileSync(
    path.join(dir, "lesson.html"),
    lessonHtml(
      "Explain mean squared error",
      '<h1>Explain mean squared error</h1><form class="cl-quiz" data-quiz-id="check" data-title="Mean squared error" data-confidence="optional"><ol class="cl-questions"><li class="cl-q" data-question-id="mse" data-type="short"><p class="cl-q-prompt">Residuals are 2 and -1. Calculate mean squared error and show your work.</p><textarea></textarea></li></ol></form>',
    ),
  );
  fs.writeFileSync(
    path.join(dir, "quiz/key.json"),
    JSON.stringify({
      check: {
        mse: {
          expected: "Squares 4 and 1 sum to 5; divide by 2 to get mean 2.5.",
          points: 4,
          full: "Accept equivalent correct reasoning and calculations.",
          partial: "2 points for the squared sum 5, 2 for averaging it to 2.5.",
          criteria: [
            { id: "sum", description: "Square and sum the residuals", points: 2 },
            { id: "mean", description: "Average the squared residuals", points: 2 },
          ],
        },
      },
    }),
  );
  const evidence = (name: string, value: unknown) => {
    if (artifacts) {
      fs.mkdirSync(artifacts, { recursive: true });
      fs.writeFileSync(path.join(artifacts, `${name}.json`), JSON.stringify(value, null, 2));
    }
  };
  await playwrightCode(
    session,
    root,
    `async page=>{
    await page.goto(${JSON.stringify(`${base}/c/rust/${lesson}`)});
    await page.locator('form.cl-quiz textarea').fill('The squared errors are 4 and 1, and their sum is 5. Therefore the mean squared error is 5.');
    await page.getByRole('button',{name:'Submit for grading',exact:true}).click();return true;
  }`,
  );
  try {
    const state = await until("real host criterion grade", 185_000, async () => {
      const state = await (await fetch(`${base}/api/state?classroom=rust&lesson=${lesson}`)).json();
      const failed = state.teacher?.requests?.find(
        (r: { status: string }) => r.status === "failed",
      );
      if (failed) throw new Error(failed.error);
      return state.quizzes[0]?.grade ? state : null;
    });
    evidence("stored-criteria", {
      state,
      submissions: store.listSubmissions("rust", lesson),
      grades: store.listGrades("rust", lesson),
    });
    const grade = state.quizzes[0].grade;
    if (
      grade.score !== 50 ||
      grade.questions[0].criteria?.length !== 2 ||
      grade.questions[0].criteria[0].pointsEarned !== 2 ||
      grade.questions[0].criteria[1].pointsEarned !== 0
    )
      throw new Error(`Real host criterion disagreement: ${JSON.stringify(grade)}`);
    await playwrightCode(
      session,
      root,
      `async page=>{
      await page.locator('form[data-state="graded"]').waitFor();
      await page.locator('.cl-teacher-messages').getByText('?',{exact:false}).waitFor();
      await page.setViewportSize({width:1280,height:900});await page.evaluate(()=>scrollTo(0,0));
      ${artifacts ? `await page.screenshot({path:${JSON.stringify(path.join(artifacts, "criteria-desktop.png"))},fullPage:true});` : ""}
      await page.setViewportSize({width:375,height:812});
      ${artifacts ? `await page.screenshot({path:${JSON.stringify(path.join(artifacts, "criteria-mobile.png"))},fullPage:true});` : ""}
      await page.reload();await page.locator('form[data-state="graded"]').waitFor();
      if(await page.locator('.cl-q-criteria li').count()!==2)throw new Error('Real criterion feedback lost on reload');
      if(!await page.getByRole('button',{name:'Graded',exact:true}).isDisabled())throw new Error('Real criterion quiz unlocked');return true;
    }`,
    );
    const finalState = await (
      await fetch(`${base}/api/state?classroom=rust&lesson=${lesson}`)
    ).json();
    evidence("criteria-reloaded", finalState);
    if (store.listGrades("rust", lesson).length !== 1)
      throw new Error("Real host duplicated a criterion grade");
    console.log(
      "PASS: real host criterion allocations 2/2 + 0/2 = 2/4, explanatory feedback, panel question, locked form and reload",
    );
  } catch (error) {
    evidence("criteria-failure", {
      error: String(error),
      state: await (await fetch(`${base}/api/state?classroom=rust&lesson=${lesson}`)).json(),
    });
    throw error;
  }
}
