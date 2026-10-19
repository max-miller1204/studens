/** Local practice uses real quiz controls without entering the assessment lifecycle. */
import * as fs from "node:fs";
import * as path from "node:path";
import { makeFixture, seedClassroom, lessonHtml } from "../test/helpers.ts";
import * as server from "../src/server.ts";
import * as store from "../src/store.ts";
import { playwright, playwrightCode } from "./playwright.ts";
import { checkPractice } from "./browser-actions.ts";

export async function verifyPracticeBrowser(artifacts: string | null): Promise<void> {
  const fixture = makeFixture();
  seedClassroom(fixture);
  if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
  const session = `studens-practice-${process.pid}`;
  const contract = fs.readFileSync(
    new URL("../assets/templates/quiz.html", import.meta.url),
    "utf8",
  );
  const quiz = contract
    .slice(
      contract.indexOf('<form class="cl-quiz" data-quiz-id="check-1" data-title='),
      contract.indexOf("</form>") + 7,
    )
    .replace(/\s*<li class="cl-q" data-question-id="q[45]"[\s\S]*?<\/li>/g, "")
    .replace(
      'class="cl-quiz" data-quiz-id="check-1"',
      'class="cl-practice" data-practice-id="practice-all"',
    );
  const key = Object.fromEntries(
    Object.entries({
      q1: "a",
      q2: ["a", "b"],
      q3: ["lifetime"],
      q6: { value: 4, tolerance: 0.1, unit: "bytes" },
      q7: { b1: ["owner", "holder"], b2: "scope" },
      q8: ["bind", "scope", "drop"],
      q9: { move: "r3", borrow: "r1", clone: "r2" },
      q10: ["s3"],
    }).map(([id, expected]) => [
      id,
      {
        expected,
        correct: "The answer follows the principle.",
        incorrect: "Revisit the principle and try a new answer.",
      },
    ]),
  );
  const practice = quiz.replace(
    "</form>",
    `<script type="application/json" data-cl-practice-key>${JSON.stringify(key)}</script></form>`,
  );
  const graded =
    '<form class="cl-quiz" data-quiz-id="check"><ol class="cl-questions"><li class="cl-q" data-question-id="q1" data-type="choice"><p class="cl-q-prompt">A separate graded example.</p><label><input type="radio" name="graded" value="a">First case</label><label><input type="radio" name="graded" value="b">Second case</label></li></ol></form>';
  fixture.write(
    "rust/001-ownership/lesson.json",
    JSON.stringify({ title: "Practice", assessmentContract: 1 }),
  );
  fixture.write(
    "rust/001-ownership/quiz/key.json",
    JSON.stringify({
      check: {
        q1: {
          expected: "a",
          points: 1,
          full: "Private graded criterion.",
          partial: "Private graded partial criterion.",
        },
      },
    }),
  );
  fixture.write(
    "rust/001-ownership/lesson.html",
    lessonHtml(
      "Practice",
      `<h1>Try the idea between sections</h1><section><h2>First idea</h2><p>Read the principle, then try it.</p></section>${practice}<section><h2>Next idea</h2><p>Continue after practice.</p></section>${graded}`,
    ).replace("<main data-cl-content>", '<main class="cl-lesson-shell" data-cl-content>'),
  );
  let turns = 0,
    opened = false;
  server.setHooks({
    onAsk: () => {
      turns++;
    },
    onFollowUp: () => {
      turns++;
    },
    onReflect: () => {
      turns++;
    },
    onQuizSubmit: () => {
      turns++;
    },
  });
  try {
    const base = await server.start(0);
    await playwright(session, fixture.root, "open", base + "/c/rust/001-ownership");
    opened = true;
    const result = await playwrightCode(
      session,
      fixture.root,
      `async page=>{
      await page.setViewportSize({width:1280,height:900});
      const practice=page.locator('form.cl-practice');
      await practice.locator('[data-question-id="q1"]').waitFor();
      const post=[];page.on('request',r=>{if(r.method()==='POST')post.push(r.url())});
      await practice.getByRole('button',{name:'Check answer',exact:true}).click();
      if(!await practice.getByRole('status').innerText().then(t=>t.includes('Answer every question')))throw Error('Missing answers accepted');
      await practice.locator('[data-question-id="q1"] input[value="b"]').check();
      for(const id of ['a','b'])await practice.locator('[data-question-id="q2"] input[value="'+id+'"]').check();
      await practice.locator('[data-question-id="q3"] input').fill(' LIFETIME ');
      await practice.locator('.cl-number').fill('not a number');
      await practice.getByRole('button',{name:'Check answer',exact:true}).click();
      if(!await practice.getByRole('status').innerText().then(t=>t.includes('not a number')))throw Error('Invalid number accepted');
      await practice.locator('.cl-number').fill('4.05');await practice.locator('.cl-unit').fill('bytes');
      await practice.locator('[data-blank="b1"]').fill('holder');await practice.locator('[data-blank="b2"]').fill('scope');
      await practice.locator('[data-item="bind"]').getByRole('button',{name:'Move up'}).focus();await page.keyboard.press('Enter');
      await practice.locator('[data-item="scope"]').getByRole('button',{name:'Move up'}).click();
      await practice.locator('[data-item="move"] select').selectOption('r3');await practice.locator('[data-item="borrow"] select').selectOption('r1');await practice.locator('[data-item="clone"] select').selectOption('r2');
      await practice.locator('[data-segment="s3"]').focus();await page.keyboard.press('Space');
      await practice.getByRole('button',{name:'Check answer',exact:true}).focus();await page.keyboard.press('Enter');
      if(await practice.locator('.cl-practice-feedback[data-correct="true"]').count()!==7 || await practice.locator('.cl-practice-feedback[data-correct="false"]').count()!==1)throw Error('Incorrect practice feedback');
      ${artifacts ? `await page.screenshot({path:${JSON.stringify(path.join(artifacts, "practice-feedback.png"))},fullPage:true});` : ""}
      await practice.locator('[data-question-id="q1"] input[value="a"]').check();
      if(await practice.locator('.cl-practice-feedback').count())throw Error('Stale feedback kept');
      await practice.getByRole('button',{name:'Check answer',exact:true}).click();
      if(await practice.locator('.cl-practice-feedback[data-correct="true"]').count()!==8)throw Error('Corrected practice not accepted');
      if(await practice.locator('input:disabled,button:disabled,select:disabled').count())throw Error('Practice locked');
      await page.waitForTimeout(600);
      if(post.length)throw Error('Practice wrote HTTP state: '+JSON.stringify(post));
      const state=await(await page.request.get(${JSON.stringify(base)}+'/api/state?classroom=rust&lesson=001-ownership')).json();
      if(state.quizzes.length||Object.keys(state.drafts).length)throw Error('Practice saved assessment or draft');
      const refused=await page.request.post(${JSON.stringify(base)}+'/api/quiz/submit',{data:{classroom:'rust',lesson:'001-ownership',quizId:'practice-all',kind:'check',answers:[{questionId:'q1',type:'choice',value:'a'}]}});
      if(refused.status()!==400)throw Error('Practice accepted as assessment: '+refused.status());
      const publicPage=await(await page.request.get(${JSON.stringify(base)}+'/c/rust/001-ownership')).text();
      if(publicPage.includes('Private graded'))throw Error('Private graded rubric leaked');
      if((await page.request.get(${JSON.stringify(base)}+'/c/rust/001-ownership/quiz/key.json')).status()!==404)throw Error('Private route served');
      await page.reload();await page.locator('form.cl-practice[data-state="fresh"]').waitFor();
      if(await page.locator('.cl-practice-feedback').count() || await practice.locator('input[type=radio]:checked').count())throw Error('Practice restored after reload');
      if(await (${checkPractice.toString()})(page)!==1)throw Error('Authoring practice check missed the form');
      const check=page.locator('form.cl-quiz');await check.locator('input[value="a"]').check();await check.getByRole('button',{name:'Submit for grading',exact:true}).click();await page.locator('form.cl-quiz[data-state="graded"]').waitFor();
      return {state,post,feedbackTypes:8,privateRoute:404};
    }`,
    );
    if (
      turns !== 0 ||
      store.listSubmissions("rust", "001-ownership").length !== 1 ||
      store.listGrades("rust", "001-ownership").length !== 1
    )
      throw Error("Practice entered teacher or grade lifecycle");
    const submissions = store.listSubmissions("rust", "001-ownership");
    if (
      submissions[0].quizId !== "check" ||
      store.listGrades("rust", "001-ownership")[0].score !== 100 ||
      store.reviewItems("rust").some((item) => JSON.stringify(item).includes("practice-all"))
    )
      throw Error("Practice changed score or review");
    // Malformed local key is an explicit contract error; never submit it as a quiz.
    fixture.write(
      "rust/001-ownership/lesson.html",
      lessonHtml(
        "Invalid practice",
        practice.replace('"expected":"a"', '"expected":"missing-option"'),
      ),
    );
    await playwrightCode(
      session,
      fixture.root,
      `async page=>{await page.reload();await page.locator('form.cl-practice[data-state="broken"]').waitFor();if(!await page.locator('.cl-contract-error').innerText().then(t=>t.includes('does not match its controls')))throw Error('Missing explicit practice error');if(!await page.getByRole('button',{name:'Check answer',exact:true}).isDisabled())throw Error('Broken practice enabled');return true;}`,
    );
    if (artifacts)
      fs.writeFileSync(
        path.join(artifacts, "practice-result.json"),
        JSON.stringify(
          {
            result,
            turns,
            submissions,
            grades: store.listGrades("rust", "001-ownership"),
            reviews: store.reviewItems("rust"),
          },
          null,
          2,
        ),
      );
    console.log(
      "PASS: local practice, eight exact types, feedback, keyboard retry, reload, private rubric isolation, no teacher or practice records, graded neighbor unchanged",
    );
  } finally {
    if (opened) await playwright(session, fixture.root, "close");
    await server.close();
    fixture.cleanup();
  }
}
