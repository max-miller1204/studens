/** Worked example -> increasing completion -> all-step practice, through the real lesson runtime. */
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { makeFixture, seedClassroom } from "../test/helpers.ts";
import * as server from "../src/server.ts";
import * as store from "../src/store.ts";
import { playwright, playwrightCode } from "./playwright.ts";
import { checkFaded } from "./faded-browser-actions.ts";

function inventory(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else
        result[path.relative(root, file)] = createHash("sha256")
          .update(fs.readFileSync(file))
          .digest("hex");
    }
  }
  walk(root);
  return result;
}

export async function verifyFadedBrowser(artifacts: string | null): Promise<void> {
  const fixture = makeFixture();
  seedClassroom(fixture);
  if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
  const session = `studens-faded-${process.pid}`;
  const template = fs.readFileSync(
    new URL("../assets/templates/faded.html", import.meta.url),
    "utf8",
  );
  const widget = template.slice(template.indexOf('<section class="cl-faded"'));
  const body = `<header><h1>Keep an equation balanced</h1><p class="cl-lede">Learn to undo operations while preserving equality.</p></header><section><h2>Equal changes preserve equality</h2><p>Think of both sides as balanced pans. Undo an operation on both sides, then check the result in the original equation.</p></section>${widget}<footer><p>Practice stays on this page. Your graded check uses a separate problem.</p><p><a href="./">Back to the classroom</a></p></footer>`;
  const shell = (content: string) =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Keep an equation balanced</title></head><body><main class="cl-lesson-shell" data-cl-content>${content}</main></body></html>`;
  fixture.write("rust/001-ownership/lesson.html", shell(body));
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
    // Matching capture data and viewport: this sample section was inert on the base.
    await playwrightCode(
      session,
      fixture.root,
      `async page=>{
      await page.locator('.cl-faded[data-state="ready"]').waitFor();
      for(const [name,width,height] of [['desktop',1280,900],['mobile',390,844]]) {
        await page.setViewportSize({width,height});
        for(const theme of ['light','dark']) {
          await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
          if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Horizontal clipping');
          ${artifacts ? `await page.screenshot({path:${JSON.stringify(artifacts)}+'/after-'+name+'-'+theme+'.png',fullPage:true});` : ""}
        }
      }
      return true;
    }`,
    );
    const pretest =
      '<form class="cl-quiz" data-quiz-id="before" data-kind="pretest"><ol class="cl-questions"><li class="cl-q" data-question-id="p" data-type="choice"><p class="cl-q-prompt">Which action preserves equality?</p><label><input type="radio" name="p" value="one">Change just the left side</label><label><input type="radio" name="p" value="both">Apply the same operation to both sides</label></li></ol></form>';
    const graded =
      '<form class="cl-quiz" data-quiz-id="check" data-confidence="optional" data-evidence="report"><ol class="cl-questions"><li class="cl-q" data-question-id="q" data-type="numeric"><p class="cl-q-prompt">Solve 7x + 14 = 77. Give x.</p><label>x<input class="cl-number" type="text"></label></li></ol></form>';
    fixture.write(
      "rust/001-ownership/lesson.json",
      JSON.stringify({ title: "Equation practice", assessmentContract: 1, criterionContract: 1 }),
    );
    fixture.write(
      "rust/001-ownership/quiz/key.json",
      JSON.stringify({
        before: {
          p: {
            expected: "both",
            points: 1,
            full: "Equality needs matching operations.",
            partial: "Change both sides.",
            criteria: [{ id: "equality", description: "Apply matching operations.", points: 1 }],
          },
        },
        check: {
          q: {
            expected: { value: 9 },
            points: 1,
            full: "Private unrelated graded case.",
            partial: "Private graded reasoning.",
            criteria: [{ id: "value", description: "Private correct value.", points: 1 }],
          },
        },
      }),
    );
    const second = widget.replace('data-faded-id="balance"', 'data-faded-id="balance-second"');
    fixture.write(
      "rust/001-ownership/lesson.html",
      shell(
        pretest +
          '<template data-cl-after-pretest="before">' +
          body +
          second +
          graded +
          "</template>",
      ),
    );
    await playwrightCode(
      session,
      fixture.root,
      `async page=>{
      await page.reload();await page.locator('form.cl-quiz[data-state="fresh"]').waitFor();
      if(await page.locator('.cl-faded').count())throw Error('Gated widget was exposed');
      const response=await (await page.request.get(${JSON.stringify(base)}+'/c/rust/001-ownership')).text();
      if(response.includes('3x + 6')||response.includes('data-cl-faded'))throw Error('Gated practice solution leaked');
      await page.locator('input[value="both"]').check();
      await page.getByRole('button',{name:'Submit for grading',exact:true}).click();
      await page.locator('.cl-faded[data-state="ready"]').first().waitFor();
      if(await page.locator('.cl-faded[data-state="ready"]').count()!==2)throw Error('Two widgets did not initialize on pretest release');
      return true;
    }`,
    );
    const before = inventory(fixture.root);
    const result = await playwrightCode(
      session,
      fixture.root,
      `async page=>{
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      const writes=[];const record=r=>{if(!['GET','HEAD'].includes(r.method()))writes.push(r.url())};page.on('request',record);
      const a=page.locator('[data-faded-id="balance"]'),b=page.locator('[data-faded-id="balance-second"]');
      await page.emulateMedia({reducedMotion:'reduce'});
      await a.getByLabel('Explain the method:',{exact:false}).fill('Equal operations preserve equality. Substitution checks the original relation.');
      await a.getByRole('button',{name:'Try the next case',exact:true}).focus();await page.keyboard.press('Enter');
      if(await a.getAttribute('data-round')!=='1'||await a.locator('[data-support="attempt"]').count()!==1||await a.locator('.cl-faded-solution').count()!==2)throw Error('First handover incorrect');
      if(!await a.locator('h3').evaluate(e=>e===document.activeElement))throw Error('Advance did not focus new case');
      if(await b.getAttribute('data-round')!=='0')throw Error('Sibling widget advanced');
      await a.getByRole('button',{name:'Compare with solution',exact:true}).click();
      if(!await a.locator('.cl-faded-feedback').innerText().then(t=>t.includes('Write an attempt')))throw Error('Blank comparison accepted');
      await a.getByRole('button',{name:'Check my work',exact:true}).click();
      if(!await a.locator('.cl-faded-status').innerText().then(t=>t.includes('every step')))throw Error('Blank check accepted');
      await a.locator('textarea').fill('I substitute in the original equation.');
      await a.getByRole('button',{name:'Check my work',exact:true}).click();
      if(await a.locator('[data-correct]').count())throw Error('Open reasoning claimed correctness');
      if(!await a.getByRole('button',{name:'Hand over one more step',exact:true}).isDisabled())throw Error('Uncompared open reasoning advanced');
      await a.getByRole('button',{name:'Compare with solution',exact:true}).click();
      if(!await a.locator('.cl-faded-feedback').innerText().then(t=>t.includes('assisted practice')))throw Error('Solution exposure not labeled');
      await a.getByRole('button',{name:'Hand over one more step',exact:true}).click();
      if(await a.locator('[data-support="attempt"]').count()!==2||await a.locator('.cl-faded-solution').count()!==1)throw Error('Second handover incorrect');
      const inputs=a.locator('textarea');await inputs.nth(0).fill('not a number');await inputs.nth(1).fill('I check both sides.');
      await a.getByRole('button',{name:'Check my work',exact:true}).click();
      if(!await a.locator('.cl-faded-status').innerText().then(t=>t.includes('not a finite number')))throw Error('Invalid number accepted');
      await inputs.nth(0).fill('99');await a.getByRole('button',{name:'Check my work',exact:true}).click();
      if(await a.locator('[data-correct="false"]').count()!==1)throw Error('Wrong numeric answer did not get honest feedback');
      await inputs.nth(0).fill('7');
      if(await a.locator('[data-correct]').count())throw Error('Edited answer kept stale verdict');
      await a.getByRole('button',{name:'Check my work',exact:true}).click();
      if(await a.locator('[data-correct="true"]').count()!==1)throw Error('Correct numeric answer failed');
      await a.getByRole('button',{name:'Compare with solution',exact:true}).last().click();
      await a.getByRole('button',{name:'Hand over one more step',exact:true}).click();
      if(await a.locator('.cl-faded-solution').count()||await a.locator('textarea').count()!==3)throw Error('Final case provided worked answers');
      await a.locator('textarea').nth(0).fill('  6X   = 48  ');await a.locator('textarea').nth(1).fill('8');await a.locator('textarea').nth(2).fill('Substitute 8: both sides equal 60.');
      await a.getByRole('button',{name:'Check my work',exact:true}).click();
      if(await a.locator('[data-correct="true"]').count()!==2)throw Error('Term normalization or final numeric contract failed');
      ${artifacts ? `await page.evaluate(()=>document.documentElement.dataset.theme="dark");await a.screenshot({path:${JSON.stringify(path.join(artifacts, "all-steps-mobile-dark.png"))}});` : ""}
      await a.getByRole('button',{name:'Compare with solution',exact:true}).last().click();
      await a.getByRole('button',{name:'Finish local practice',exact:true}).click();
      if(!await a.locator('.cl-faded-status').innerText().then(t=>t.includes('No score or learning credit')))throw Error('Finish claimed credit');
      await a.getByRole('button',{name:'Revisit previous case',exact:true}).click();
      if(await a.locator('textarea').first().inputValue()||await a.locator('[data-correct]').count())throw Error('Revisit restored stale response');
      if(!await a.innerText().then(t=>t.includes('Revisited case')))throw Error('Missing revisit warning');
      await a.getByRole('button',{name:'Reset to worked example',exact:true}).click();
      if(await a.getAttribute('data-round')!=='0'||await a.locator('textarea').inputValue())throw Error('Reset retained response');
      await a.getByLabel('Explain the method:',{exact:false}).fill('A new study explanation.');await a.getByRole('button',{name:'Try the next case',exact:true}).click();
      if(!await a.innerText().then(t=>t.includes('Revisited case')))throw Error('Reset erased exposure history');
      await page.reload();await a.locator('.cl-faded-runtime').waitFor();
      if(await a.getAttribute('data-round')!=='0'||await a.locator('textarea').inputValue()||await a.locator('[data-correct]').count())throw Error('Reload restored progress or answers');
      await page.goto(${JSON.stringify(base)}+'/c/rust');await page.goto(${JSON.stringify(base)}+'/c/rust/001-ownership');await a.locator('.cl-faded-runtime').waitFor();
      if(await a.getAttribute('data-round')!=='0')throw Error('Navigation retained progress');
      const authored=await (${checkFaded.toString()})(page);if(authored!==2)throw Error('Authoring driver missed instance');
      await page.waitForTimeout(600);page.off('request',record);
      if(writes.length)throw Error('Widget wrote HTTP state: '+writes.join(','));if(errors.length)throw Error(errors.join(' '));
      const state=await(await page.request.get(${JSON.stringify(base)}+'/api/state?classroom=rust&lesson=001-ownership')).json();
      if(state.quizzes.length!==1||Object.keys(state.drafts).length||state.reflections.length)throw Error('Widget changed learner state');
      return {writes,authored,errors,state};
    }`,
    );
    const after = inventory(fixture.root);
    assert.deepEqual(after, before, "Local widget changed classroom files");
    assert.equal(turns, 0, "Local widget woke teacher");
    // The adjacent assessment remains a normal code-owned grade with immutable private rubric.
    const neighbor = await playwrightCode(
      session,
      fixture.root,
      `async page=>{
      const form=page.locator('form[data-quiz-id="check"]');await form.locator('.cl-number').fill('9');
      await form.getByRole('button',{name:'Submit for grading',exact:true}).click();await form.locator('[data-cl-grade]').waitFor();
      if(await form.getAttribute('data-state')!=='graded')throw Error('Neighbor assessment failed');
      const refused=await page.request.post(${JSON.stringify(base)}+'/api/quiz/submit',{data:{classroom:'rust',lesson:'001-ownership',quizId:'balance',kind:'check',answers:[{questionId:'q',type:'numeric',value:'8'}]}});
      if(refused.status()!==400)throw Error('Widget identity accepted as assessment');
      const html=await(await page.request.get(${JSON.stringify(base)}+'/c/rust/001-ownership')).text();if(html.includes('Private unrelated'))throw Error('Private graded key leaked');
      if((await page.request.get(${JSON.stringify(base)}+'/c/rust/001-ownership/quiz/key.json')).status()!==404)throw Error('Private file served');
      return {widgetSubmission:refused.status(),privateRoute:404};
    }`,
    );
    assert.equal(store.listSubmissions("rust", "001-ownership").length, 2);
    const grades = store.listGrades("rust", "001-ownership");
    assert.equal(grades.find((g) => g.quizId === "check")?.score, 100);
    assert.equal(turns, 0);
    for (const name of ["lesson.html", "lesson.json", "quiz/key.json"])
      assert.equal(
        inventory(fixture.root)[`rust/001-ownership/${name}`],
        before[`rust/001-ownership/${name}`],
      );
    // Invalid configs are visible and isolated; authored text never becomes HTML.
    const invalid = widget.replace('"version": 1', '"version": 99');
    const malformed = widget
      .replace('data-faded-id="balance"', 'data-faded-id="bad-json"')
      .replace('"version": 1', '"version":');
    const safe = widget
      .replace('data-faded-id="balance"', 'data-faded-id="safe"')
      .replace('"Balance an equation"', '"\\u003cimg src=x onerror=alert(1)\\u003e"');
    fixture.write("rust/001-ownership/lesson.html", shell(invalid + malformed + safe));
    const invalidResult = await playwrightCode(
      session,
      fixture.root,
      `async page=>{
      await page.reload();await page.locator('[data-faded-id="safe"][data-state="ready"]').waitFor();
      if(await page.locator('.cl-faded[data-state="broken"]').count()!==2)throw Error('Malformed widgets not isolated');
      const errors=await page.locator('.cl-contract-error').allTextContents();
      if(!errors.some(t=>t.includes('version must be 1'))||!errors.some(t=>t.includes('Invalid faded example JSON')))throw Error('Specific errors missing');
      if(await page.locator('[data-faded-id="safe"] img').count())throw Error('Author text executed as HTML');
      return {errors,safeTitle:await page.locator('[data-faded-id="safe"] h3').innerText()};
    }`,
    );
    const unitConfig = JSON.parse(
      /<script[^>]*data-cl-faded[^>]*>([\s\S]*?)<\/script>/.exec(widget)![1],
    );
    unitConfig.title = "Unit input contract probe";
    for (const round of unitConfig.rounds)
      for (const step of round.steps)
        if (step.response.type === "numeric") step.response.expected.unit = "m";
    fixture.write(
      "rust/001-ownership/lesson.html",
      shell(
        `<section class="cl-faded" data-faded-id="unit"><script type="application/json" data-cl-faded>${JSON.stringify(unitConfig)}</script></section>`,
      ),
    );
    const unitResult = await playwrightCode(
      session,
      fixture.root,
      `async page=>{
      await page.reload();const widget=page.locator('.cl-faded[data-state="ready"]');await widget.waitFor();
      await widget.getByLabel('Explain the method:',{exact:false}).fill('Apply matching changes.');await widget.getByRole('button',{name:'Try the next case',exact:true}).click();
      await widget.locator('textarea').fill('Check the original relation.');await widget.getByRole('button',{name:'Compare with solution',exact:true}).click();await widget.getByRole('button',{name:'Hand over one more step',exact:true}).click();
      await widget.locator('textarea').first().fill('7');await widget.locator('textarea').last().fill('Check the original relation.');
      await widget.getByLabel('Unit',{exact:true}).fill('cm');await widget.getByRole('button',{name:'Check my work',exact:true}).click();
      if(await widget.locator('[data-correct="false"]').count()!==1)throw Error('Wrong unit accepted');
      await widget.getByLabel('Unit',{exact:true}).fill(' m ');await widget.getByRole('button',{name:'Check my work',exact:true}).click();
      if(await widget.locator('[data-correct="true"]').count()!==1)throw Error('Trimmed correct unit rejected');
      await widget.getByRole('button',{name:'Compare with solution',exact:true}).first().click();
      await widget.locator('textarea').first().fill('99');await widget.getByRole('button',{name:'Check my work',exact:true}).click();
      if(await widget.locator('[data-correct="false"]').count()!==1||!await widget.locator('.cl-faded-feedback').first().innerText().then(t=>t.includes('assisted practice')))throw Error('Edited compared answer lost assistance or kept stale verdict');
      await widget.locator('textarea').first().fill('7 m');await widget.getByRole('button',{name:'Check my work',exact:true}).click();
      if(!await widget.locator('.cl-faded-status').innerText().then(t=>t.includes('not a finite number')))throw Error('Unit suffix parsed as number');
      return {wrongUnitRejected:true,trimmedUnitAccepted:true,editedComparisonAssisted:true,numberSuffixRejected:true};
    }`,
    );
    if (artifacts)
      fs.writeFileSync(
        path.join(artifacts, "result.json"),
        JSON.stringify(
          {
            result,
            neighbor,
            before,
            after,
            persistedFilesUnchanged: true,
            turns,
            grades,
            invalidResult,
            unitResult,
          },
          null,
          2,
        ),
      );
    console.log(
      "PASS: faded worked example, 1/2/3-step handover, exact/open feedback, keyboard, two instances, pretest, reset/revisit/reload/navigation, malformed config/text safety, unchanged files/no teacher/no credit, graded neighbor/private key",
    );
  } finally {
    if (opened) await playwright(session, fixture.root, "close");
    await server.close();
    fixture.cleanup();
  }
}
