/** Local practice uses real quiz controls without entering the assessment lifecycle. */
import * as fs from "node:fs";
import * as path from "node:path";
import assert from "node:assert/strict";
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
      contract.indexOf('<form class="cl-quiz cl-card-box" data-quiz-id="check-1" data-title='),
      contract.indexOf("</form>") + 7,
    )
    .replace(/\s*<li\s+class="cl-q"\s+data-question-id="q(?:4|5|11)"[\s\S]*?<\/li>/g, "")
    .replace(
      'class="cl-quiz cl-card-box" data-quiz-id="check-1"',
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
    JSON.stringify({ title: "Practice", assessmentContract: 1, criterionContract: 1 }),
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
          criteria: [{ id: "selection", description: "Private graded selection.", points: 1 }],
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
      store.listGrades("rust", "001-ownership")[0].questions[0].criteria?.[0].pointsEarned !== 1 ||
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
  await verifyNumericPracticeBrowser(artifacts);
}

/** Numeric public keys must have a control capable of supplying the exact unit. */
export async function verifyNumericPracticeBrowser(artifacts: string | null): Promise<void> {
  const fixture = makeFixture();
  seedClassroom(fixture);
  if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
  const session = `studens-numeric-practice-${process.pid}`;
  const cases = [
    { id: "missing", control: "", unit: "m", broken: true },
    { id: "element", control: '<span class="cl-unit">m</span>', unit: "m", broken: true },
    {
      id: "disabled",
      control: '<input class="cl-unit" type="text" disabled>',
      unit: "m",
      broken: true,
    },
    {
      id: "readonly",
      control: '<input class="cl-unit" type="text" readonly>',
      unit: "m",
      broken: true,
    },
    {
      id: "options",
      control: '<select class="cl-unit"><option>cm</option></select>',
      unit: "m",
      broken: true,
    },
    {
      id: "disabled-option",
      control: '<select class="cl-unit"><option disabled>m</option><option>cm</option></select>',
      unit: "m",
      broken: true,
    },
    {
      id: "scalar-options",
      control: '<select class="cl-unit"><option>m</option></select>',
      broken: true,
    },
    {
      id: "text",
      control: '<label>Unit <input class="cl-unit" type="text"></label>',
      unit: "m",
      broken: false,
    },
    {
      id: "select",
      control:
        '<label>Unit <select class="cl-unit"><option>cm</option><option value=" m ">Meters</option></select></label>',
      unit: " m ",
      broken: false,
    },
    {
      id: "fixed",
      control: '<label>Unit <input class="cl-unit" type="text" readonly value="m"></label>',
      unit: "m",
      broken: false,
    },
    { id: "scalar", control: "", broken: false },
    {
      id: "scalar-select",
      control:
        '<label>Unit <select class="cl-unit"><option value="">None</option><option>m</option></select></label>',
      broken: false,
    },
  ];
  const forms = cases
    .map(
      (c) =>
        `<form class="cl-practice" data-practice-id="${c.id}"><ol class="cl-questions"><li class="cl-q" data-question-id="p" data-type="numeric"><p class="cl-q-prompt">Enter two${c.unit ? " meters" : ""}.</p><label>Number <input class="cl-number" type="text"></label>${c.control}</li></ol><script type="application/json" data-cl-practice-key>${JSON.stringify({ p: { expected: { value: 2, ...(c.unit ? { unit: c.unit } : {}) }, correct: "Two is the required value.", incorrect: "Check the value and unit." } })}</script></form>`,
    )
    .join("");
  fixture.write("rust/001-ownership/lesson.html", lessonHtml("Numeric practice", forms));
  fixture.write(
    "rust/002-checker/lesson.html",
    lessonHtml(
      "Supported numeric practice",
      forms.replace(/<form[\s\S]*?<\/form>/g, (form) =>
        cases.some((c) => c.broken && form.includes(`data-practice-id="${c.id}"`)) ? "" : form,
      ),
    ),
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
  const files = (dir: string): Record<string, string> =>
    Object.fromEntries(
      fs
        .readdirSync(dir, { recursive: true })
        .map(String)
        .filter((name) => fs.statSync(path.join(dir, name)).isFile())
        .map((name) => [name, fs.readFileSync(path.join(dir, name)).toString("base64")]),
    );
  try {
    const base = await server.start(0);
    const before = files(path.join(fixture.root, "rust"));
    await playwright(session, fixture.root, "open", base + "/c/rust/001-ownership");
    opened = true;
    const result = await playwrightCode(
      session,
      fixture.root,
      `async page=>{
      await page.waitForFunction(()=>[...document.querySelectorAll('form.cl-practice')].every(f=>f.dataset.state));
      const writes=[],errors=[];page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push({url:r.url(),method:r.method()})});page.on('pageerror',e=>errors.push(e.message));
      const cases=${JSON.stringify(cases)},observations=[];
      for(const c of cases){
        const form=page.locator('[data-practice-id="'+c.id+'"]'),button=form.getByRole('button',{name:'Check answer',exact:true});
        const state=await form.getAttribute('data-state'),contract=await form.locator('.cl-contract-error').allTextContents();
        if(c.broken){if(state!=='broken'||!await button.isDisabled()||!contract.join(' ').includes(c.id==='missing'?'requires one .cl-unit':'cannot supply'))throw Error('Missing configuration error '+c.id);}
        else {
          if(state!=='fresh'||contract.length)throw Error('Valid numeric rejected '+c.id);
          await button.click();if(!await form.getByRole('status').innerText().then(t=>t.includes('Answer every question')))throw Error('Blank numeric accepted');
          await form.locator('.cl-number').fill('2 m');await button.click();if(!await form.getByRole('status').innerText().then(t=>t.includes('not a number')))throw Error('Combined numeric accepted');
          await form.locator('.cl-number').fill('2');
          if(c.id==='text'){await form.locator('.cl-unit').fill('cm');await button.click();if(await form.locator('.cl-practice-feedback[data-correct="false"]').count()!==1)throw Error('Wrong unit accepted');await form.locator('.cl-unit').fill(' m ');if(await form.locator('.cl-practice-feedback').count())throw Error('Stale unit feedback');}
          if(c.id==='select')await form.locator('.cl-unit').selectOption(' m ');
          await button.focus();await page.keyboard.press('Enter');
          if(await form.locator('.cl-practice-feedback[data-correct="true"]').count()!==1)throw Error('Valid numeric answer rejected '+c.id);
          if(await form.locator('.cl-number').isDisabled()||await button.isDisabled())throw Error('Numeric retry locked');
        }
        observations.push({id:c.id,state,contract,feedback:await form.locator('.cl-practice-feedback').allTextContents()});
      }
      await page.waitForTimeout(600);if(writes.length||errors.length)throw Error(JSON.stringify({writes,errors}));
      const state=await(await page.request.get(${JSON.stringify(base)}+'/api/state?classroom=rust&lesson=001-ownership')).json();
      if(state.quizzes.length||state.annotations.length||state.reflections.length||Object.keys(state.drafts).length||state.reteach.length)throw Error('Practice saved learner state');
      await page.reload();await page.locator('[data-practice-id="text"][data-state="fresh"]').waitFor();
      if(await page.locator('.cl-practice-feedback').count()||await page.locator('[data-practice-id="text"] .cl-number').inputValue()||await page.locator('[data-practice-id="text"] .cl-unit').inputValue())throw Error('Numeric practice restored on reload');
      await page.goto(${JSON.stringify(base)}+'/c/rust/002-checker');
      await page.locator('form.cl-practice[data-state="fresh"]').first().waitFor();
      const checkerForms=await (${checkPractice.toString()})(page);
      if(checkerForms!==5)throw Error('Packaged checker missed supported numeric controls');
      if(writes.length||errors.length)throw Error(JSON.stringify({writes,errors}));
      return {observations,writes,errors,state,reloadReset:true,checkerForms};
    }`,
    );
    assert.equal(turns, 0);
    assert.deepEqual(store.listSubmissions("rust", "001-ownership"), []);
    assert.deepEqual(store.listGrades("rust", "001-ownership"), []);
    assert.deepEqual(store.reviewItems("rust"), []);
    assert.deepEqual(files(path.join(fixture.root, "rust")), before);
    if (artifacts)
      fs.writeFileSync(
        path.join(artifacts, "numeric-result.json"),
        JSON.stringify(
          {
            result,
            turns,
            persistedFilesUnchanged: true,
            submissions: [],
            grades: [],
            reviews: [],
          },
          null,
          2,
        ),
      );
    console.log(
      "PASS: numeric practice required units, usable controls, scalar, wrong unit, parser errors, keyboard retry, reload, no HTTP or persisted writes",
    );
  } finally {
    if (opened) await playwright(session, fixture.root, "close");
    await server.close();
    fixture.cleanup();
  }
}
