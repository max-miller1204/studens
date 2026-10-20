/** Four local causal domains, computed input, async rendering, gates and immutable state. */
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { makeFixture, seedClassroom, lessonHtml } from "../test/helpers.ts";
import * as server from "../src/server.ts";
import * as store from "../src/store.ts";
import { playwright, playwrightCode } from "./playwright.ts";
import { checkPractice } from "./browser-actions.ts";
import { checkSteppers } from "./stepper-browser-actions.ts";
function inventory(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else
        files[path.relative(root, file)] = createHash("sha256")
          .update(fs.readFileSync(file))
          .digest("hex");
    }
  }
  walk(root);
  return files;
}
export async function verifyStepperBrowser(artifacts: string | null): Promise<void> {
  const f = makeFixture();
  seedClassroom(f);
  if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
  const session = `studens-stepper-${process.pid}`;
  const template = fs.readFileSync(
    new URL("../assets/templates/stepper.html", import.meta.url),
    "utf8",
  );
  const widgets = template.slice(template.indexOf('<section class="cl-stepper"'));
  const shell = (body: string) =>
    lessonHtml("Follow a changing system", body).replace(
      "<main data-cl-content>",
      '<main class="cl-lesson-shell" data-cl-content>',
    );
  const pipeline = widgets.slice(
    widgets.indexOf('<section class="cl-stepper" data-stepper-id="packet"'),
    widgets.indexOf('<section class="cl-stepper" data-stepper-id="prefix"'),
  );
  const intro =
    "<header><h1>Follow a changing system</h1><p>Inspect each transition and explain what changed.</p></header>";
  f.write("rust/001-ownership/lesson.html", shell(intro + pipeline));
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
    await playwright(session, f.root, "open");
    opened = true;
    await playwrightCode(
      session,
      f.root,
      `async page=>{
      await page.goto(${JSON.stringify(base)}+'/c/rust');
      for(const [name,width,height] of [['desktop',1280,900],['mobile',390,844]]) {
        await page.setViewportSize({width,height});
        for(const theme of ['light','dark']) {
          await page.emulateMedia({colorScheme:theme});
          await page.evaluate(t=>localStorage.setItem('pi-classroom-theme',t),theme);
          await page.goto(${JSON.stringify(base)}+'/c/rust/001-ownership');
          await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
          await page.locator('.cl-stepper[data-state="ready"]').waitFor();
          await page.waitForFunction(()=>!document.querySelector('.cl-diagram[aria-busy],.cl-math[aria-busy]'));
          if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Horizontal clipping');
          ${artifacts ? `await page.screenshot({path:${JSON.stringify(artifacts)}+'/after-'+name+'-'+theme+'.png',fullPage:true});` : ""}
        }
      }
      return true;
    }`,
    );
    if (artifacts) {
      await playwrightCode(
        session,
        f.root,
        `async page=>{await page.setViewportSize({width:1024,height:900});await page.evaluate(()=>document.documentElement.dataset.theme='light');return true;}`,
      );
      await playwright(session, f.root, "video-start", path.join(artifacts, "step-through.webm"));
      await playwrightCode(
        session,
        f.root,
        `async page=>{
        const w=page.locator('[data-stepper-id="packet"]');await w.scrollIntoViewIfNeeded();
        await page.waitForTimeout(700);await w.getByRole('button',{name:'Play',exact:true}).click();
        await page.waitForFunction(()=>document.querySelector('[data-stepper-id="packet"]').dataset.step==='2');
        await page.waitForTimeout(700);return true;
      }`,
      );
      await playwright(session, f.root, "video-stop");
    }
    const pretest =
      '<form class="cl-quiz" data-quiz-id="before" data-kind="pretest"><ol class="cl-questions"><li class="cl-q" data-question-id="p" data-type="choice"><p class="cl-q-prompt">Which prefix sum follows the first value 9?</p><label><input type="radio" name="p" value="nine">9</label><label><input type="radio" name="p" value="zero">0</label></li></ol></form>';
    const graded =
      '<form class="cl-quiz" data-quiz-id="check" data-confidence="optional" data-evidence="report"><ol class="cl-questions"><li class="cl-q" data-question-id="q" data-type="numeric"><p class="cl-q-prompt">Add 13 and 17.</p><label>Total<input class="cl-number" type="text"></label></li></ol></form>';
    const practice =
      '<form class="cl-practice" data-practice-id="local"><ol class="cl-questions"><li class="cl-q" data-question-id="p" data-type="term"><p class="cl-q-prompt">Type local.</p><input type="text"></li></ol><script type="application/json" data-cl-practice-key>{"p":{"expected":"local","correct":"Local feedback.","incorrect":"Try local."}}</script></form>';
    f.write(
      "rust/001-ownership/lesson.json",
      JSON.stringify({
        title: "Local state exploration",
        assessmentContract: 1,
        criterionContract: 1,
      }),
    );
    const key = {
      before: {
        p: {
          expected: "nine",
          points: 1,
          full: "A single value contributes itself.",
          partial: "Incorrect value.",
          criteria: [{ id: "value", description: "Identify the first prefix sum.", points: 1 }],
        },
      },
      check: {
        q: {
          expected: { value: 30 },
          points: 1,
          full: "Private unrelated result.",
          partial: "Private sum reasoning.",
          criteria: [{ id: "value", description: "Private correct result.", points: 1 }],
        },
      },
    };
    f.write("rust/001-ownership/quiz/key.json", JSON.stringify(key));
    f.write(
      "rust/001-ownership/lesson.html",
      shell(
        pretest +
          '<template data-cl-after-pretest="before">' +
          intro +
          widgets +
          practice +
          graded +
          "</template>",
      ),
    );
    await playwrightCode(
      session,
      f.root,
      `async page=>{
      await page.reload();await page.locator('form.cl-quiz[data-state="fresh"]').waitFor();
      if(await page.locator('.cl-stepper').count())throw Error('Gated widgets exposed');
      await page.reload();
      const html=await(await page.request.get(${JSON.stringify(base)}+'/c/rust/001-ownership')).text();
      if(html.includes('data-cl-stepper')||html.includes('Packet A:'))throw Error('Teaching source leaked before grade');
      await page.locator('input[value="nine"]').check();await page.getByRole('button',{name:'Submit for grading',exact:true}).click();
      await page.waitForFunction(()=>document.querySelectorAll('.cl-stepper[data-state="ready"]').length===4);
      return true;
    }`,
    );
    const before = inventory(f.root);
    const result = await playwrightCode(
      session,
      f.root,
      `async page=>{
      const writes=[],errors=[];const record=r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.url())};page.on('request',record);page.on('pageerror',e=>errors.push(e.message));
      const practice=await (${checkPractice.toString()})(page);
      if(practice!==1)throw Error("Neighbor practice missing");
      const matrix=[];
      for(const [viewport,width,height] of [['desktop',1280,900],['mobile',390,844]]) {
        await page.setViewportSize({width,height});
        for(const theme of ['light','dark']) {
          await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
          const count=await (${checkSteppers.toString()})(page);
          if(count!==4)throw Error('Four domains not exercised');
          if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Domain matrix horizontal clipping');
          matrix.push({viewport,theme,count});
        }
      }
      const exercised=4;
      const w=page.locator('[data-stepper-id="packet"]'), other=page.locator('[data-stepper-id="door"]'), sum=page.locator('[data-stepper-id="prefix"]');
      await w.getByRole('button',{name:'Next',exact:true}).focus();await page.keyboard.press('Enter');
      if(!await w.getByRole('button',{name:'Next',exact:true}).evaluate(e=>e===document.activeElement))throw Error('Keyboard focus was lost');
      await w.getByRole('button',{name:'Reset',exact:true}).click();
      await w.getByRole('button',{name:'Play',exact:true}).click();
      if(await w.getByRole('button',{name:'Pause',exact:true}).getAttribute('aria-pressed')!=='true')throw Error('Play did not expose pressed state');
      await page.waitForTimeout(1700);
      await w.getByRole('button',{name:'Pause',exact:true}).click();const paused=await w.getAttribute('data-step');await page.waitForTimeout(1700);
      if(await w.getAttribute('data-step')!==paused||await other.getAttribute('data-step')!=='0')throw Error('Pause or sibling isolation failed');
      await w.getByRole('button',{name:'Reset',exact:true}).click();
      await page.evaluate(()=>{const w=document.querySelector('[data-stepper-id="packet"]');for(let i=0;i<8;i++){w.querySelectorAll('button')[1].click();w.querySelectorAll('button')[2].click();}});
      await page.waitForFunction(()=>document.querySelector('[data-stepper-id="packet"]').dataset.state==='ready');
      if(!(await w.locator('svg').textContent()).includes('Receive A'))throw Error('Stale async diagram replaced reset');
      await page.evaluate(()=>{document.documentElement.dataset.theme='light';document.documentElement.dataset.theme='dark';document.documentElement.dataset.theme='light';});
      await page.waitForFunction(()=>!document.querySelector('.cl-diagram[aria-busy]'));
      const ids=await page.locator('svg [id],svg[id]').evaluateAll(es=>es.map(e=>e.id));
      if(new Set(ids).size!==ids.length)throw Error('SVG IDs collide across frames/instances');
      await page.emulateMedia({reducedMotion:'reduce'});
      await page.waitForFunction(()=>document.querySelector('[data-stepper-id="packet"] .cl-stepper-controls button:last-child').disabled);
      if(!await w.getByRole('button',{name:'Play',exact:true}).isDisabled())throw Error('Reduced motion autoplay enabled');
      await w.getByRole('button',{name:'Next',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('[data-stepper-id="packet"]').dataset.state==='ready');
      if((await w.locator('.cl-stepper-state').innerText()).split(String.fromCharCode(10)).length!==2)throw Error('State line breaks collapsed');
      await sum.locator('input').fill('3,,7');await sum.getByRole('button',{name:'Recompute',exact:true}).click();
      if(await sum.getAttribute('data-state')!=='invalid-input'||await sum.locator('.cl-stepper-frame').count()||!await sum.getByRole('alert').innerText().then(t=>t.includes('comma-separated')))throw Error('Invalid input kept stale computed results');
      await sum.locator('input').fill('5, -4');await sum.getByRole('button',{name:'Recompute',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('[data-stepper-id="prefix"]').dataset.state==='ready');
      await sum.getByRole('button',{name:'Next',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('[data-stepper-id="prefix"]').dataset.state==='ready');
      if(!await sum.locator('math').count())throw Error('Newly rendered formula left raw TeX');
      if(!await sum.locator('svg').count())throw Error('Computed frame has no diagram');
      await page.emulateMedia({reducedMotion:'no-preference'});
      await page.waitForFunction(()=>!document.querySelector('[data-stepper-id="packet"] .cl-stepper-controls button:last-child').disabled);
      // Fetch all local renderer assets before blocking every network request.
      await page.route('**/*',route=>route.abort());
      await sum.getByRole('button',{name:'Next',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('[data-stepper-id="prefix"]').dataset.state==='ready');
      if(!await sum.locator('.cl-stepper-state').innerText().then(t=>t.includes('Sum: 1'))||!await sum.locator('math').count()||!await sum.locator('svg').count())throw Error('Offline computed transition failed');
      await page.unroute('**/*');
      await w.getByRole('button',{name:'Reset',exact:true}).click();
      await w.getByRole('button',{name:'Play',exact:true}).click();
      const removed=await w.evaluate(el=>{window.removedStepper=el;el.remove();return el.dataset.step;});await page.waitForTimeout(1800);
      if(await page.evaluate(()=>window.removedStepper.dataset.step)!==removed)throw Error('Removed widget autoplay continued');
      await page.reload();await page.locator('[data-stepper-id="packet"][data-state="ready"]').waitFor();
      if(await w.getAttribute('data-step')!=='0'||await sum.locator('input').inputValue()!=='4, -1, 6')throw Error('Reload persisted widget state');
      for(let visit=0;visit<3;visit++) {
        await w.getByRole('button',{name:'Play',exact:true}).click();
        await page.goto(${JSON.stringify(base)}+'/c/rust');await page.goBack();await w.locator('.cl-stepper-runtime').waitFor();
        if(await w.getAttribute('data-step')!=='0')throw Error('Navigation retained widget progress');
        await page.waitForTimeout(1700);
        if(await w.getAttribute('data-step')!=='0')throw Error('Navigation retained an autoplay timer');
      }
      await page.waitForTimeout(600);page.off('request',record);
      if(writes.length||errors.length)throw Error(JSON.stringify({writes,errors}));
      return {exercised,matrix,writes,errors,paused,svgIdsUnique:true,offline:true,reducedMotion:true,removedTimerStopped:true};
    }`,
    );
    assert.deepEqual(inventory(f.root), before, "Widget activity changed classroom files");
    assert.equal(turns, 0);
    const neighbor = await playwrightCode(
      session,
      f.root,
      `async page=>{
      const form=page.locator('form[data-quiz-id="check"]');await form.locator('.cl-number').fill('30');await form.getByRole('button',{name:'Submit for grading',exact:true}).click();await form.locator('[data-cl-grade]').waitFor();
      const refusal=await page.request.post(${JSON.stringify(base)}+'/api/quiz/submit',{data:{classroom:'rust',lesson:'001-ownership',quizId:'packet',kind:'check',answers:[{questionId:'q',type:'numeric',value:'1'}]}});
      if(refusal.status()!==400)throw Error('Widget accepted as assessment');
      if((await page.request.get(${JSON.stringify(base)}+'/c/rust/001-ownership/quiz/key.json')).status()!==404)throw Error('Private route exposed');
      return {widgetSubmission:refusal.status(),privateRoute:404};
    }`,
    );
    assert.equal(
      store.listGrades("rust", "001-ownership").find((g) => g.quizId === "check")?.score,
      100,
    );
    assert.equal(turns, 0);
    // Isolate invalid config, math and Mermaid while keeping literal author text safe.
    const configs = [
      ...widgets.matchAll(/<script[^>]*data-cl-stepper[^>]*>([\s\S]*?)<\/script>/g),
    ].map((m) => JSON.parse(m[1]));
    const badConfig = { ...configs[0], version: 9 };
    const badMath = structuredClone(configs[0]);
    badMath.steps[0].explanation = "Bad \\(\\notARealCommand{x}\\)";
    const badMermaid = structuredClone(configs[0]);
    badMermaid.steps[0].mermaid = "flowchart LR\nA -->";
    const safe = structuredClone(configs[0]);
    safe.title = "<img src=x onerror=alert(1)>";
    safe.steps[0].state += String.raw`
Energy: \(x^2\)`;
    safe.steps[1].state += String.raw`
Energy: \(x^2+1\)`;
    const wrap = (id: string, c: unknown) =>
      `<section class="cl-stepper" data-stepper-id="${id}"><script type="application/json" data-cl-stepper>${JSON.stringify(c).replaceAll("<", "\\u003c")}</script></section>`;
    f.write(
      "rust/001-ownership/lesson.html",
      shell(
        wrap("config", badConfig) +
          wrap("math", badMath) +
          wrap("diagram", badMermaid) +
          wrap("safe", safe) +
          '<section class="cl-stepper" data-stepper-id="json"><script type="application/json" data-cl-stepper>{oops</script></section>',
      ),
    );
    const errors = await playwrightCode(
      session,
      f.root,
      `async page=>{
      await page.reload();await page.locator('[data-stepper-id="safe"][data-state="ready"]').waitFor();
      await page.waitForFunction(()=>document.querySelectorAll('.cl-stepper[data-state="broken"]').length===4);
      const errors=await page.locator('.cl-contract-error').allTextContents();
      for(const expected of ['version must be 1','Math did not render','Diagram did not render','Invalid stepper JSON'])if(!errors.some(t=>t.includes(expected)))throw Error('Specific error missing: '+expected);
      if(await page.locator('[data-stepper-id="safe"] img').count())throw Error('Authored text executed');
      const safe=page.locator('[data-stepper-id="safe"]');
      for(let step=0;step<2;step++) {
        if(step) {await safe.getByRole('button',{name:'Next',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-stepper-id="safe"]').dataset.state==='ready');}
        if(await safe.locator('.cl-stepper-status math').count()!==1||await safe.locator('.cl-stepper-state math').count()!==1||await safe.locator('.cl-stepper-status').innerText().then(t=>t.includes(String.fromCharCode(92)+'(')))throw Error('State formula left raw TeX in the announcement');
      }
      ${artifacts ? `await page.screenshot({path:${JSON.stringify(path.join(artifacts, "errors.png"))},fullPage:true});` : ""}
      return errors;
    }`,
    );
    if (artifacts)
      fs.writeFileSync(
        path.join(artifacts, "result.json"),
        JSON.stringify(
          { result, neighbor, errors, fileHashesUnchanged: true, teacherTurns: turns, before },
          null,
          2,
        ),
      );
    console.log(
      "PASS: four causal domains, computed inputs, controls, diagrams/math, keyboard, themes/mobile, offline, malformed contracts, pretest gate, immutable files/no teacher, graded neighbor/private paths",
    );
  } finally {
    if (artifacts) {
      fs.cpSync(f.root, path.join(artifacts, "classroom"), { recursive: true });
      if (opened)
        await playwrightCode(
          session,
          f.root,
          `async page=>{await page.screenshot({path:${JSON.stringify(path.join(artifacts, "final.png"))},fullPage:true});return true;}`,
        ).catch(() => {});
    }
    if (opened) await playwright(session, f.root, "close");
    await server.close();
    f.cleanup();
  }
}
