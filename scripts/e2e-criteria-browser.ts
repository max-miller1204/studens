/** Exercise saved criterion feedback, historical limits, revisions and explicit retry. */
import * as fs from "node:fs";
import * as path from "node:path";
import { makeFixture, seedClassroom, lessonHtml } from "../test/helpers.ts";
import * as server from "../src/server.ts";
import * as store from "../src/store.ts";
import { classroomTools, PI_HOST, isFailure } from "../src/tools.ts";
import { TeacherService } from "../src/teacher-service.ts";
import { readTeacherState } from "../src/service-state.ts";
import { playwright, playwrightCode } from "./playwright.ts";

export async function verifyCriteriaBrowser(artifacts: string | null): Promise<void> {
  const f = makeFixture();
  seedClassroom(f);
  if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
  const session = `studens-criteria-${process.pid}`;
  const key = {
    check: {
      mse: {
        expected: "Sum 5; divide by 2; mean 2.5.",
        points: 4,
        full: "Both steps correct.",
        partial: "2 for sum; 2 for mean.",
        criteria: [
          { id: "sum", description: "Square and sum the residuals", points: 2 },
          { id: "mean", description: "Divide by the number of residuals", points: 2 },
        ],
      },
    },
  };
  const input = (id: string) => ({
    submission_id: id,
    score: 50,
    feedback_markdown: "Your squared errors sum correctly. The mean needs an averaging step.",
    questions: [
      {
        question_id: "mse",
        correct: false,
        points_earned: 2,
        points_possible: 4,
        feedback: "The squared residuals total 5. Divide by 2 to obtain the mean, 2.5.",
        criteria: [
          { criterion_id: "sum", points_earned: 2, feedback: "2² + (-1)² = 5, as you wrote." },
          {
            criterion_id: "mean",
            points_earned: 0,
            feedback: "The sum is not the mean. Divide 5 by the two residuals to get 2.5.",
          },
        ],
      },
    ],
  });
  const pageHtml = lessonHtml(
    "Mean squared error",
    '<h1>Mean squared error</h1><p>Show your calculation and explain the final step.</p><form class="cl-quiz" data-quiz-id="check" data-title="Explain your calculation"><ol class="cl-questions"><li class="cl-q" data-question-id="mse" data-type="short"><p class="cl-q-prompt">Residuals are 2 and -1. Calculate the mean squared error.</p><textarea rows="3"></textarea></li></ol></form>',
  );
  f.write(
    "rust/001-ownership/lesson.json",
    JSON.stringify({ title: "Mean squared error", assessmentContract: 1, criterionContract: 1 }),
  );
  f.write("rust/001-ownership/lesson.html", pageHtml);
  const saveKey = () => f.write("rust/001-ownership/quiz/key.json", JSON.stringify(key));
  saveKey();
  const tool = classroomTools(PI_HOST).find((t) => t.name === "grade_lesson_quiz")!;
  const writes: Promise<unknown>[] = [];
  server.setHooks({
    onAsk() {},
    onReflect() {},
    onFollowUp() {},
    onQuizSubmit(s) {
      writes.push(
        tool.execute(input(s.id)).then((r) => {
          if (isFailure(r)) throw new Error(JSON.stringify(r));
        }),
      );
    },
  });
  const evidence = (name: string, value: unknown) => {
    if (artifacts)
      fs.writeFileSync(path.join(artifacts, `${name}.json`), JSON.stringify(value, null, 2));
  };
  const shot = (name: string) =>
    artifacts
      ? `await page.locator("[data-cl-grade], .cl-q-verdict").evaluateAll(elements=>Promise.all(elements.flatMap(el=>el.getAnimations({subtree:true})).map(a=>a.finished)));await page.evaluate(()=>window.scrollTo({top:0,behavior:"instant"}));await page.screenshot({path:${JSON.stringify(path.join(artifacts, `${name}.png`))},fullPage:true});`
      : "";
  let opened = false,
    teacher: TeacherService | undefined;
  try {
    const base = await server.start(0);
    await playwright(session, f.root, "open", `${base}/c/rust/001-ownership`);
    opened = true;
    await playwrightCode(
      session,
      f.root,
      `async page=>{
      await page.setViewportSize({width:1280,height:900});
      const state=await (await page.request.get(${JSON.stringify(base)}+'/api/state?classroom=rust&lesson=001-ownership')).text();
      if(state.includes('rubricCriteria') || (await page.content()).includes('Square and sum the residuals')) throw new Error('Private criterion leak before submission');
      await page.locator('form.cl-quiz textarea').fill('The squared errors sum to 5. Therefore the mean squared error is 5.'); return true;
    }`,
    );
    key.check.mse.points = 0;
    saveKey();
    await playwrightCode(
      session,
      f.root,
      `async page=>{
      await page.getByRole('button',{name:'Submit for grading',exact:true}).click();
      await page.getByText('Invalid assessment contract:',{exact:false}).waitFor();
      ${shot("error-desktop")}
      await page.setViewportSize({width:375,height:812});${shot("error-mobile")}
      return true;
    }`,
    );
    if (store.listSubmissions("rust", "001-ownership").length)
      throw new Error("Invalid rubric saved an attempt");
    key.check.mse.points = 4;
    saveKey();
    const result = await playwrightCode<{ state: { quizzes: store.QuizState[] }; text: string }>(
      session,
      f.root,
      `async page=>{
      await page.getByRole('button',{name:'Submit for grading',exact:true}).click();
      await page.locator('form[data-state="graded"]').waitFor();
      await page.locator('.cl-criteria-disclosure > summary').click();
      const criteria=page.locator('.cl-q-criteria li');
      if(await criteria.count()!==2) throw new Error('Missing criterion rows');
      if(!await criteria.nth(0).innerText().then(t=>t.includes('Met')&&t.includes('2/2 points'))) throw new Error('Met allocation missing');
      if(!await criteria.nth(1).innerText().then(t=>t.includes('Missed')&&t.includes('0/2 points'))) throw new Error('Missed allocation missing');
      await page.setViewportSize({width:1280,height:900});${shot("partial-desktop")}
      await page.setViewportSize({width:375,height:812});${shot("partial-mobile")}
      if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) throw new Error('Mobile overflow');
      const first=await criteria.allTextContents();
      await page.reload();await page.locator('form[data-state="graded"]').waitFor();
      await page.locator('.cl-criteria-disclosure > summary').click();
      if(JSON.stringify(first)!==JSON.stringify(await page.locator('.cl-q-criteria li').allTextContents()))throw new Error('Reload changed criteria');
      if(!await page.getByRole('button',{name:'Graded',exact:true}).isDisabled())throw new Error('Graded form unlocked');
      ${shot("reload-mobile")}
      await page.setViewportSize({width:1280,height:900});${shot("reload-desktop")}
      const state=await (await page.request.get(${JSON.stringify(base)}+'/api/state?classroom=rust&lesson=001-ownership')).json();
      if(JSON.stringify(state).includes('rubricCriteria') || JSON.stringify(state).includes('deterministicGrades'))throw new Error('Private snapshot exposed');
      for(const privatePath of ['quiz/key.json','quiz/plan.json','quiz/submissions/missing.json']){
        if((await page.request.get(${JSON.stringify(base)}+'/c/rust/001-ownership/'+privatePath)).status()!==404)throw new Error('Private route served');
      }
      return {state,text:await page.locator('form.cl-quiz').innerText()};
    }`,
    );
    await Promise.all(writes);
    const submission = store.listSubmissions("rust", "001-ownership")[0];
    const original = store.listGrades("rust", "001-ownership")[0];
    if (
      original.score !== 50 ||
      JSON.stringify(original) !== JSON.stringify(result.state.quizzes[0].grade)
    )
      throw new Error("Saved and public grades disagree");
    evidence("partial", { result, submission, original });
    // Explicit teacher revision: clarify an explanation, preserve the original allocations.
    await new Promise((resolve) => setTimeout(resolve, 2));
    const revision = input(submission.id);
    revision.questions[0].criteria[1].feedback =
      "The averaging step is missing: divide the squared sum 5 by the two residuals to get 2.5.";
    const revised = await tool.execute(revision);
    if (isFailure(revised)) throw new Error(JSON.stringify(revised));
    await playwrightCode(
      session,
      f.root,
      `async page=>{
      await page.reload();await page.locator('form[data-state="graded"]').waitFor();
      await page.locator('.cl-criteria-disclosure > summary').click();
      await page.locator('.cl-q-criteria').getByText('The averaging step is missing:',{exact:false}).waitFor();
      ${shot("revision-desktop")}
      await page.setViewportSize({width:375,height:812});${shot("revision-mobile")}
      return true;
    }`,
    );
    const history = store.listGrades("rust", "001-ownership");
    if (history.length !== 2 || JSON.stringify(history[0]) !== JSON.stringify(original))
      throw new Error("Revision overwrote history");
    evidence("history", history);

    f.write(
      "rust/003-component/lesson.json",
      JSON.stringify({ title: "Partial reasoning", assessmentContract: 1, criterionContract: 1 }),
    );
    f.write("rust/003-component/lesson.html", pageHtml);
    f.write("rust/003-component/quiz/key.json", JSON.stringify(key));
    server.setHooks({
      onAsk() {},
      onReflect() {},
      onFollowUp() {},
      onQuizSubmit(s) {
        const allocation = input(s.id);
        allocation.score = 25;
        allocation.questions[0].points_earned = 1;
        allocation.questions[0].criteria[0].points_earned = 1;
        allocation.questions[0].criteria[0].feedback =
          "The first square is correct. Square -1 too, then add the two squares.";
        allocation.questions[0].feedback =
          "One square is correct; finish the sum before averaging.";
        allocation.feedback_markdown = "Some reasoning earns credit; finish both steps.";
        writes.push(
          tool.execute(allocation).then((r) => {
            if (isFailure(r)) throw new Error(JSON.stringify(r));
          }),
        );
      },
    });
    const component = await playwrightCode(
      session,
      f.root,
      `async page=>{
      await page.goto(${JSON.stringify(base)}+'/c/rust/003-component');
      await page.locator('form.cl-quiz textarea').fill('2 squared is 4. I did not finish the other residual or the average.');
      await page.getByRole('button',{name:'Submit for grading',exact:true}).click();
      await page.locator('form[data-state="graded"]').waitFor();
      await page.locator('.cl-criteria-disclosure > summary').click();
      await page.locator('.cl-q-criteria li').first().getByText('Partly met',{exact:false}).waitFor();
      if(!await page.locator('.cl-q-criteria li').first().innerText().then(t=>t.includes('1/2 points')))throw new Error('Partial component allocation missing');
      await page.setViewportSize({width:375,height:812});${shot("partly-met-mobile")}
      await page.reload();await page.locator('form[data-state="graded"]').waitFor();
      await page.locator('.cl-criteria-disclosure > summary').click();
      return (await page.request.get(${JSON.stringify(base)}+'/api/state?classroom=rust&lesson=003-component')).json();
    }`,
    );
    await Promise.all(writes);
    if ((component as { quizzes: store.QuizState[] }).quizzes[0].grade?.score !== 25)
      throw new Error("Partial component total changed after reload");
    evidence("partly-met", component);

    f.write(
      "rust/002-retry/lesson.json",
      JSON.stringify({ title: "Criterion retry", assessmentContract: 1, criterionContract: 1 }),
    );
    f.write("rust/002-retry/lesson.html", pageHtml);
    f.write("rust/002-retry/quiz/key.json", JSON.stringify(key));
    let turns = 0;
    teacher = new TeacherService(async (_identity, prompt) => {
      const id = /submission_id: "([^"]+)"/.exec(prompt)?.[1];
      if (!id) throw new Error("Missing submission id");
      const { score, ...args } = input(id);
      turns++;
      await new Promise((resolve) => setTimeout(resolve, 700));
      if (turns === 1) args.questions[0].criteria.pop();
      return {
        calls: [{ name: "grade_quiz_answers", arguments_json: JSON.stringify(args) }],
        message:
          "The squared sum earns credit; the averaging step is missing. How would you find the mean for three residuals?",
        learning_record: "",
        notes_markdown: "",
      };
    });
    teacher.attach("rust", "codex");
    teacher.connect();
    await playwrightCode(
      session,
      f.root,
      `async page=>{
      await page.goto(${JSON.stringify(base)}+'/c/rust/002-retry');
      await page.locator('form.cl-quiz textarea').fill('The squared errors sum to 5. Therefore the mean squared error is 5.');
      await page.getByRole('button',{name:'Submit for grading',exact:true}).click();
      await page.locator('[data-cl-quiz-status]').filter({hasText:'Grading your quiz… Your answers are saved.'}).waitFor();
      await page.getByRole('button',{name:'Retry request',exact:true}).waitFor();
      await page.locator('[data-cl-quiz-status]').filter({hasText:'Grading failed:'}).waitFor();
      await page.locator('.cl-teacher-requests').getByText('allocate every declared criterion exactly once.',{exact:false}).waitFor();
      await page.setViewportSize({width:1280,height:900});${shot("teacher-error-desktop")}
      await page.setViewportSize({width:375,height:812});${shot("teacher-error-mobile")}
      await page.reload();await page.getByRole('button',{name:'Retry request',exact:true}).waitFor(); return true;
    }`,
    );
    await teacher.idle();
    if (turns !== 1 || store.listGrades("rust", "002-retry").length)
      throw new Error("Invalid plan wrote a grade or retried silently");
    evidence("rejected-plan", readTeacherState("rust"));
    await playwrightCode(
      session,
      f.root,
      `async page=>{
      await page.getByRole('button',{name:'Retry request',exact:true}).click();
      await page.locator('form[data-state="graded"]').waitFor();
      await page.locator('.cl-criteria-disclosure > summary').click();
      await page.locator('.cl-q-criteria li').nth(1).waitFor();
      await page.getByText('The squared sum earns credit;',{exact:false}).waitFor();
      ${shot("teacher-retried-mobile")}
      await page.reload();await page.locator('form[data-state="graded"]').waitFor();
      await page.locator('.cl-criteria-disclosure > summary').click();return true;
    }`,
    );
    await teacher.idle();
    if (Number(turns) !== 2 || store.listGrades("rust", "002-retry").length !== 1)
      throw new Error("Explicit retry did not save exactly one grade");
    evidence("retried-plan", {
      turns,
      teacher: readTeacherState("rust"),
      grades: store.listGrades("rust", "002-retry"),
    });
    console.log(
      "PASS: private fixed criteria, partial allocations, reload, locked form, revision history, invalid rubric, durable teacher error and explicit retry",
    );
  } catch (error) {
    evidence("failure", { error: String(error), teacher: readTeacherState("rust") });
    throw error;
  } finally {
    await teacher?.stop();
    if (opened) await playwright(session, f.root, "close");
    await server.close();
    f.cleanup();
  }
}
