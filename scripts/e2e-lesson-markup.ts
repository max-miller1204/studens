/** Matched template captures through public lesson/reference routes; no model inference. */
import assert from "node:assert/strict";
import { applyAnswer } from "../src/bridge.ts";
import { highlightText } from "./browser-actions.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import * as server from "../src/server.ts";
import { makeFixture, seedClassroom, lessonHtml } from "../test/helpers.ts";
import { playwright, playwrightCode } from "./playwright.ts";

const [directory, mode = "after"] = process.argv.slice(2);
if (!directory || !["before", "after"].includes(mode))
  throw new Error("Usage: node scripts/e2e-lesson-markup.ts <artifacts> [before|after]");
const out = path.resolve(directory);
fs.mkdirSync(out, { recursive: true });
const fixture = makeFixture();
const session = `studens-markup-${process.pid}`;
let opened = false;
try {
  seedClassroom(fixture);
  const read = (name: string) => fs.readFileSync(`assets/templates/${name}.html`, "utf8");
  // Shell placeholders are intentionally invalid; complete only their response controls.
  const complete = (html: string) =>
    html
      .replaceAll("CHOOSE-A-TYPE", "short")
      .replaceAll("REPLACE-selected-item-key", "001-original/check/q1")
      .replace(
        /(<li\b[^>]*data-type="short"[^>]*>)([\s\S]*?)(<\/li>)/g,
        '$1$2<label>Your explanation<textarea class="cl-input" rows="3"></textarea></label>$3',
      )
      .replaceAll("{{LESSON_TITLE}}", "Follow ownership")
      .replaceAll("{{REFERENCE_TITLE}}", "Ownership reference")
      .replaceAll("{{ONE_LINE_SUMMARY}}", "Track the owner before and after a move.")
      .replaceAll("{{WHEN_TO_REACH_FOR_THIS}}", "Use when tracing a move.")
      .replaceAll("{{CLASSROOM_NAME}}", "rust")
      .replaceAll("{{QUIZ_KIND}}", "check");
  for (const name of ["lesson", "assessment", "review"])
    fixture.write(`rust/002-${name}/lesson.html`, complete(read(name)));
  fixture.write("rust/reference/reference.html", complete(read("reference")));
  const fragments = ["quiz", "practice", "stepper", "faded"].map(read).join("\n");
  fixture.write(
    "rust/003-controls/lesson.html",
    lessonHtml("Ownership controls", fragments).replace(
      "<main data-cl-content>",
      `<main class="cl-lesson-shell" data-cl-content${mode === "after" ? ' data-cl-ui="2"' : ""}>`,
    ),
  );
  fixture.write(
    "rust/005-passage/lesson.html",
    lessonHtml(
      "Track a passage",
      '<p id="passage">Ownership moves once. The new owner releases the value.</p>',
    ).replace(
      "<main data-cl-content>",
      `<main class="cl-lesson-shell" data-cl-content${mode === "after" ? ' data-cl-ui="2"' : ""}>`,
    ),
  );
  server.setHooks({
    delivery: "wait",
    onAsk(annotation) {
      setTimeout(
        () => applyAnswer(annotation.id, "The new owner releases the value when its scope ends."),
        50,
      );
    },
    onFollowUp() {},
    onQuizSubmit() {
      throw new Error("The markup capture must not submit an assessment.");
    },
    onReflect() {
      throw new Error("The markup capture must not save a reflection.");
    },
  });
  const base = await server.start(0);
  await playwright(session, out, "open", base);
  opened = true;
  const result = await playwrightCode(
    session,
    out,
    `async page => {
    const errors=[], cases=[];
    page.on('pageerror', e=>errors.push(e.message));
    for(const width of [1280,390]) for(const theme of ['light','dark']) {
      await page.setViewportSize({width,height:900});
      await page.goto(${JSON.stringify(base)}+'/c/rust/settings');
      await page.getByLabel('Theme',{exact:true}).selectOption(theme);
      for(const [name,route] of [['lesson','/c/rust/002-lesson'],['assessment','/c/rust/002-assessment'],['review','/c/rust/002-review'],['reference','/r/rust/reference.html'],['controls','/c/rust/003-controls']]) {
        await page.goto(${JSON.stringify(base)}+route);
        await page.evaluate(()=>document.fonts.ready);
        if(name!=='reference') await page.waitForFunction(()=>[...document.querySelectorAll('form.cl-quiz')].every(f=>f.dataset.state));
        const contract=await page.locator('.cl-contract-error').allTextContents();
        if(contract.length) throw Error(contract.join(' '));
        if(name==='controls') {
          await page.locator('form.cl-practice input[value=delivery]').check();
          await page.locator('form.cl-practice').getByRole('button',{name:'Check answer'}).click();
          await page.locator('.cl-practice-feedback').waitFor();
          await page.locator('[data-stepper-id=prefix]').getByRole('button',{name:'Next',exact:true}).click();
        }
        const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
        if(dimensions.scroll>width) throw Error('Overflow '+name+' '+JSON.stringify(dimensions));
        if(name==='controls') for(const [part,selector] of [['question','[data-quiz-id=check-1] .cl-q:first-child'],['practice','form.cl-practice'],['stepper','[data-stepper-id=prefix]'],['faded','[data-faded-id=balance]']])
          await page.locator(selector).screenshot({path:${JSON.stringify(out)}+'/'+part+'-'+width+'-'+theme+'.png',style:'.cl-header { visibility: hidden !important; }'});
        await page.evaluate(()=>window.scrollTo(0,0));
        await page.screenshot({path:${JSON.stringify(out)}+'/'+name+'-'+width+'-'+theme+'.png',fullPage:true});
        cases.push({name,width,theme,contract,dimensions});
      }
    }
    return {errors,cases};
  }`,
  );
  fs.writeFileSync(path.join(out, "result.json"), JSON.stringify(result, null, 2));
  assert.deepEqual((result as { errors: string[] }).errors, []);
  await playwrightCode(
    session,
    out,
    `async page => {
    const highlightText=${highlightText.toString()};
    for(const width of [1280,390]) for(const theme of ['light','dark']) {
      await page.setViewportSize({width,height:900});
      await page.goto(${JSON.stringify(base)}+'/c/rust/settings');
      await page.getByLabel('Theme',{exact:true}).selectOption(theme);
      await page.goto(${JSON.stringify(base)}+'/c/rust/005-passage');
      await highlightText(page,'#passage','Ownership moves once.');
      await page.locator('.cl-ask-pill').click();
      await page.locator('[data-cl-question]').fill('Who releases it after the move?');
      await page.screenshot({path:${JSON.stringify(out)}+'/ask-'+width+'-'+theme+'.png',fullPage:true});
      await page.getByRole('button',{name:'Ask your teacher',exact:true}).click();
      await page.locator('.cl-card-inline:not([hidden]) .cl-card-answer').last().getByText('The new owner releases the value when its scope ends.',{exact:true}).waitFor();
      await page.locator('.cl-card-inline:not([hidden]) [data-cl-followup]').last().fill('What if the scope ends sooner?');
      await page.screenshot({path:${JSON.stringify(out)}+'/card-'+width+'-'+theme+'.png',fullPage:true});
      // Keep each matched state to one saved question; delete through its public control.
      await page.locator('.cl-card-inline:not([hidden]) [data-cl-delete]').last().click();
      await page.getByRole('button',{name:'Delete question',exact:true}).last().click();
      await page.locator('.cl-card-inline').waitFor({state:'detached'});
    }
    return {states:8};
  }`,
  );
  if (mode === "after") {
    const valid = complete(read("assessment"));
    fixture.write("rust/004-invalid/lesson.html", valid.replace("cl-q-prompt", "missing-prompt"));
    const rejected = await playwrightCode(
      session,
      out,
      `async page => {
      const writes=[]; page.on('request',r=>{if(r.method()==='POST')writes.push(r.url())});
      await page.goto(${JSON.stringify(base)}+'/c/rust/004-invalid');
      await page.locator('.cl-contract-error').waitFor();
      const errors=await page.locator('.cl-contract-error').allTextContents();
      if(!errors.join(' ').includes('cl-q-prompt'))throw Error('Missing specific hook error');
      if(await page.locator('main textarea:enabled').count())throw Error('Broken lesson remained editable');
      await page.screenshot({path:${JSON.stringify(out)}+'/missing-hook.png',fullPage:true});
      return {errors,writes};
    }`,
    );
    assert.deepEqual((rejected as { writes: string[] }).writes, []);
    fixture.write(
      "rust/004-invalid/lesson.html",
      valid.replace(
        "</main>",
        '<label>Speed<input type="range" aria-label="Speed"></label></main>',
      ),
    );
    const repaired = await playwrightCode(
      session,
      out,
      `async page => {
      await page.reload();
      await page.waitForFunction(()=>document.querySelector('form.cl-quiz')?.dataset.state==='fresh');
      if(await page.locator('.cl-contract-error').count())throw Error('Corrected source still broken');
      const slider=page.getByRole('slider',{name:'Speed'}), before=await slider.inputValue();
      await slider.focus(); await slider.press('ArrowRight');
      const after=await slider.inputValue(); if(before===after)throw Error('Local slider stopped working');
      return {state:await page.locator('form.cl-quiz').getAttribute('data-state'),slider:{before,after}};
    }`,
    );
    fs.writeFileSync(
      path.join(out, "missing-hook.json"),
      JSON.stringify({ rejected, repaired }, null, 2),
    );
  }
} finally {
  if (opened) await playwright(session, out, "close");
  await server.close();
  fixture.cleanup();
}
