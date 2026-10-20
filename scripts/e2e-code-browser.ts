/** Real browser execution of untrusted learner source; never execute it in Node. */
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { makeFixture, seedClassroom, lessonHtml } from "../test/helpers.ts";
import { exercise, source, codeForm, codeRubric } from "../test/code-fixture.ts";
import * as server from "../src/server.ts";
import * as store from "../src/store.ts";
import { playwright, playwrightCode } from "./playwright.ts";
import { codeBrowserProbes } from "./code-browser-actions.ts";
import { classroomTools, PI_HOST, isFailure } from "../src/tools.ts";

export async function verifyCodeBrowser(artifacts: string | null): Promise<void> {
  const f = makeFixture();
  seedClassroom(f, { title: "JavaScript" });
  if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
  f.write(
    "rust/001-ownership/lesson.json",
    JSON.stringify({ title: "Ownership", assessmentContract: 1, criterionContract: 1 }),
  );
  f.write(
    "rust/001-ownership/lesson.html",
    lessonHtml(
      "Summing values",
      `<h1>Summing values</h1><p>Implement a function that totals the finite numbers in an array.</p>${codeForm(source)}`,
    ),
  );
  f.write("rust/001-ownership/quiz/key.json", JSON.stringify({ check: { sum: codeRubric } }));
  f.write(
    "rust/002-neighbor/lesson.html",
    lessonHtml(
      "Neighbor",
      '<form class="cl-quiz" data-quiz-id="neighbor"><li class="cl-q" data-question-id="one" data-type="choice"><p class="cl-q-prompt">Choose one.</p><label><input type="radio" name="neighbor" value="a">One</label><label><input type="radio" name="neighbor" value="b">Two</label></li></form>',
    ),
  );
  f.write(
    "rust/002-neighbor/lesson.json",
    JSON.stringify({ title: "Neighbor", assessmentContract: 1 }),
  );
  f.write(
    "rust/002-neighbor/quiz/key.json",
    JSON.stringify({
      neighbor: { one: { expected: "a", points: 1, full: "One", partial: "None." } },
    }),
  );
  const jsonExercise = {
    ...exercise,
    tests: [
      {
        id: "object-key",
        args: [JSON.parse('{"__proto__":{"flag":1},"label":"ordinary"}')],
        expected: [true, 1, "ordinary"],
      },
    ],
  };
  const jsonSource =
    'JSON.parse = () => { throw new Error("Learner replaced parser"); }; function sum(x) { return [Object.hasOwn(x,"__proto__"), x.__proto__.flag, x.label]; }';
  f.write(
    "rust/003-json-input/lesson.json",
    JSON.stringify({ title: "JSON arguments", assessmentContract: 1, criterionContract: 1 }),
  );
  f.write(
    "rust/003-json-input/lesson.html",
    lessonHtml("JSON arguments", codeForm(jsonSource, jsonExercise)),
  );
  f.write("rust/003-json-input/quiz/key.json", JSON.stringify({ check: { sum: codeRubric } }));
  const session = `studens-code-${process.pid}`;
  let opened = false,
    turns = 0;
  server.setHooks({
    onAsk() {},
    onFollowUp() {},
    onReflect() {},
    onQuizSubmit() {
      turns++;
    },
  });
  try {
    const base = await server.start(0);
    await playwright(session, f.root, "open", `${base}/c/rust/002-neighbor`);
    opened = true;
    const loading = await playwrightCode<any>(
      session,
      f.root,
      `async page=>{
      const engine=[],internet=[],escape=[];
      page.on('request',r=>{if(r.url().includes('/vendor/quickjs/')||r.url().includes('/code-worker.mjs'))engine.push(r.url());if(r.url().includes('/api/code-escape-sentinel'))escape.push(r.url());});
      await page.context().route('**/*',async route=>{if(new URL(route.request().url()).origin!==${JSON.stringify(base)}){internet.push(route.request().url());await route.abort();}else await route.continue();});
      await page.reload();await page.locator('form[data-state="fresh"]').waitFor();if(engine.length)throw new Error('Unrelated quiz loaded the engine');
      await page.goto(${JSON.stringify(base)}+'/c/rust/001-ownership');await page.locator('form[data-state="fresh"]').waitFor();if(engine.length)throw new Error('Engine loaded before Run');
      const probes=await (${codeBrowserProbes.toString()})(page, ${JSON.stringify(source)}, ${JSON.stringify(artifacts)});
      if(!engine.length||internet.length||escape.length)throw new Error('Lazy/offline/guest network boundary failed '+JSON.stringify({engine,internet,escape}));
      return {unrelatedEngineRequests:0,beforeRunEngineRequests:0,internetBlocked:true,engine,internet,escape,probes};
    }`,
    );
    const probes = loading.probes;
    if (artifacts)
      await playwright(
        session,
        f.root,
        "video-start",
        path.join(artifacts, "execution.webm"),
        "--size=1280x900",
      );
    await playwrightCode(
      session,
      f.root,
      `async page=>{
      const q=page.locator('[data-question-id="sum"]');await page.setViewportSize({width:1280,height:900});
      await q.locator('textarea').fill('function sum(values) { return 99; }');await q.locator('[data-cl-code-run]').click();await q.locator('.cl-code-runner[data-run-state="complete"]').waitFor();await page.waitForTimeout(600);
      await q.locator('textarea').fill(${JSON.stringify(source)});await q.locator('[data-cl-code-run]').click();await q.locator('.cl-code-runner[data-run-state="complete"]').waitFor();await page.waitForTimeout(600);return true;
    }`,
    );
    if (artifacts) await playwright(session, f.root, "video-stop");
    const result = await playwrightCode(
      session,
      f.root,
      `async page => {
      await page.setViewportSize({width:1280,height:900});
      await page.locator('form[data-state="fresh"]').waitFor();
      const q=page.locator('[data-question-id="sum"]');
      await q.locator('[data-cl-code-run]').click();
      await q.locator('.cl-code-runner[data-run-state="complete"]').waitFor();
      if(await q.locator('[data-outcome="passed"]').count()!==3) throw new Error(await q.innerText());
      ${artifacts ? `for(const [name,width,height,theme] of [['desktop-light',1280,900,'light'],['desktop-dark',1280,900,'dark'],['mobile-light',375,812,'light'],['mobile-dark',375,812,'dark']]){await page.setViewportSize({width,height});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);await page.screenshot({path:${JSON.stringify(artifacts)}+'/after-'+name+'.png',fullPage:true});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Mobile code overflow');}` : ""}
      return {text:await q.innerText(), state:await (await page.request.get(${JSON.stringify(base)}+'/api/state?classroom=rust&lesson=001-ownership')).json()};
    }`,
    );
    if (
      turns ||
      store.listSubmissions("rust", "001-ownership").length ||
      store.listGrades("rust", "001-ownership").length
    )
      throw new Error("Run created assessment work.");
    if (artifacts)
      fs.writeFileSync(
        path.join(artifacts, "smoke.json"),
        JSON.stringify({ exercise, result, turns, probes, loading }, null, 2),
      );
    const submit = await playwrightCode<{ body: store.QuizSubmission; repeatStatus: number }>(
      session,
      f.root,
      `async page=>{
      const second=await page.context().newPage();await second.goto(${JSON.stringify(base)}+'/c/rust/001-ownership');await second.locator('form[data-state="fresh"]').waitFor();
      const response=page.waitForResponse(r=>r.url().endsWith('/api/quiz/submit')&&r.request().method()==='POST');
      await page.getByRole('button',{name:'Submit for grading',exact:true}).click();const r=await response;if(r.status()!==201)throw new Error(await r.text());const body=await r.json();
      await second.getByLabel('JavaScript source',{exact:true}).fill(${JSON.stringify(source)});
      const duplicate=second.waitForResponse(r=>r.url().endsWith('/api/quiz/submit')&&r.request().method()==='POST');await second.getByRole('button',{name:'Submit for grading',exact:true}).click();if((await duplicate).status()!==409)throw new Error('Second tab duplicate accepted');
      await second.reload();await second.locator('form[data-state="submitted"]').waitFor();if(!await second.getByLabel('JavaScript source',{exact:true}).isDisabled())throw new Error('Second tab did not lock after reload');await second.close();
      const repeat=await page.request.post(${JSON.stringify(base)}+'/api/quiz/submit',{data:{classroom:'rust',lesson:'001-ownership',quizId:'check',kind:'check',answers:body.answers}});
      if(repeat.status()!==409)throw new Error('Duplicate submission accepted');
      await page.reload();await page.locator('form[data-state="submitted"]').waitFor();
      if(await page.getByLabel('JavaScript source',{exact:true}).inputValue()!==${JSON.stringify(source)})throw new Error('Submitted source changed');
      if(await page.locator('[data-outcome="passed"]').count()!==3)throw new Error('Saved run disappeared');return {body,repeatStatus:repeat.status()};
    }`,
    );
    const original = store.listSubmissions("rust", "001-ownership")[0];
    const hash = (value: unknown) =>
      createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const originalHash = hash(original);
    if (
      turns !== 1 ||
      original.answers[0].value !== source ||
      !original.answers[0].code?.run ||
      original.deterministicGrades?.length ||
      !original.rubricCriteria?.sum
    )
      throw new Error("Incorrect immutable code snapshot");
    const gradeTool = classroomTools(PI_HOST).find((t) => t.name === "grade_lesson_quiz")!;
    const graded = await gradeTool.execute({
      submission_id: original.id,
      score: 100,
      feedback_markdown:
        "The saved function accumulates every value with the correct zero identity.",
      questions: [
        {
          question_id: "sum",
          correct: true,
          points_earned: 2,
          points_possible: 2,
          feedback: "Your reduce uses zero as its initial value and adds every array member.",
          criteria: [
            { criterion_id: "accumulate", points_earned: 1, feedback: "Every element is added." },
            {
              criterion_id: "empty",
              points_earned: 1,
              feedback: "The initial zero also handles an empty array.",
            },
          ],
        },
      ],
    });
    if (isFailure(graded)) throw new Error(JSON.stringify(graded));
    const locked = await playwrightCode(
      session,
      f.root,
      `async page=>{
      await page.locator('form[data-state="graded"]').waitFor();
      if(await page.locator('.cl-q-criteria li').count()!==2)throw new Error('Code criterion feedback missing');
      await page.reload();await page.locator('form[data-state="graded"]').waitFor();
      if(!await page.getByRole('button',{name:'Run again',exact:true}).isDisabled()||!await page.getByLabel('JavaScript source',{exact:true}).isDisabled())throw new Error('Graded code unlocked');
      if(await page.getByLabel('JavaScript source',{exact:true}).inputValue()!==${JSON.stringify(source)})throw new Error('Reload changed source');
      ${artifacts ? `await page.evaluate(()=>{document.documentElement.dataset.theme='dark';window.scrollTo(0,0);});await page.waitForFunction(()=>scrollY===0);await page.screenshot({path:${JSON.stringify(path.join(artifacts, "graded-mobile-dark.png"))},fullPage:true});` : ""}
      for(const p of ['quiz/key.json','quiz/plan.json','quiz/submissions/missing.json'])if((await page.request.get(${JSON.stringify(base)}+'/c/rust/001-ownership/'+p)).status()!==404)throw new Error('Private code state served');
      const state=await(await page.request.get(${JSON.stringify(base)}+'/api/state?classroom=rust&lesson=001-ownership')).json();if(JSON.stringify(state).includes('rubricCriteria')||JSON.stringify(state).includes('deterministicGrades'))throw new Error('Private criterion snapshot leaked');
      await page.goto(${JSON.stringify(base)}+'/c/rust/002-neighbor');await page.locator('input[value="a"]').check();await page.getByRole('button',{name:'Submit for grading',exact:true}).click();await page.locator('form[data-state="graded"]').waitFor();return state;
    }`,
    );
    if (
      hash(store.listSubmissions("rust", "001-ownership")[0]) !== originalHash ||
      store.listSubmissions("rust", "001-ownership").length !== 1 ||
      store.listGrades("rust", "001-ownership").length !== 1 ||
      turns !== 1
    )
      throw new Error("Reload/adjacent quiz changed code attempt or teacher count");
    const jsonInput = await playwrightCode(
      session,
      f.root,
      `async page=>{await page.goto(${JSON.stringify(base)}+'/c/rust/003-json-input');await page.locator('form[data-state="fresh"]').waitFor();const observed=[];for(const source of [${JSON.stringify(jsonSource)}, 'const sum = x => [Object.hasOwn(x,"__proto__"), x.__proto__.flag, x.label];', 'JSON.parse = () => { throw new Error("Learner replaced parser"); }; let sum = x => [Object.hasOwn(x,"__proto__"), x.__proto__.flag, x.label];']){await page.getByLabel('JavaScript source',{exact:true}).fill(source);await page.locator('[data-cl-code-run]').click();await page.locator('.cl-code-runner[data-run-state="complete"]').waitFor();if(await page.locator('[data-outcome="passed"]').count()!==1)throw new Error('JSON property/lexical entry/parser fidelity failed: '+await page.locator('.cl-code-results').innerText());observed.push({source,text:await page.locator('.cl-code-results').innerText()});}return observed;}`,
    );
    if (store.listSubmissions("rust", "003-json-input").length || turns !== 1)
      throw new Error("JSON argument Run created assessment work");
    await playwrightCode(
      session,
      f.root,
      `async page=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/quiz/submit')&&r.request().method()==='POST');await page.getByRole('button',{name:'Submit for grading',exact:true}).click();const r=await response;if(r.status()!==201)throw new Error(await r.text());return true;}`,
    );
    const jsonSaved = store.listSubmissions("rust", "003-json-input")[0];
    if (
      JSON.stringify(jsonSaved.answers[0].code?.exercise) !== JSON.stringify(jsonExercise) ||
      !Object.hasOwn(jsonSaved.answers[0].code!.exercise.tests[0].args[0] as object, "__proto__") ||
      Number(turns) !== 2
    )
      throw new Error("Saved public JSON inputs differ from the authored contract");
    const jsonHash = hash(jsonSaved);
    await playwrightCode(
      session,
      f.root,
      `async page=>{await page.reload();await page.locator('form[data-state="submitted"]').waitFor();if(!await page.getByLabel('JavaScript source',{exact:true}).isDisabled())throw new Error('JSON source unlocked');if(await page.locator('[data-outcome="passed"]').count()!==1)throw new Error('JSON run lost on reload');return true;}`,
    );
    if (hash(store.listSubmissions("rust", "003-json-input")[0]) !== jsonHash)
      throw new Error("JSON snapshot changed after reload");
    if (artifacts)
      fs.writeFileSync(
        path.join(artifacts, "submission.json"),
        JSON.stringify(
          {
            submit,
            original,
            originalHash,
            afterHash: hash(store.listSubmissions("rust", "001-ownership")[0]),
            grade: store.listGrades("rust", "001-ownership"),
            locked,
            jsonInput,
            jsonSaved,
            jsonHash,
          },
          null,
          2,
        ),
      );
    console.log(
      "PASS: isolated browser execution/error/security probes, no Run assessment work, immutable submit, duplicate refusal, two tabs, criterion grade, locked reload, private routes and adjacent closed quiz.",
    );
  } finally {
    if (opened) await playwright(session, f.root, "close");
    await server.close();
    f.cleanup();
  }
}

if (process.argv[1]?.endsWith("/e2e-code-browser.ts"))
  await verifyCodeBrowser(process.argv[2] ?? null);
