/** Learner-owned marks through real controls and a controlled persistent teacher. */
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { makeFixture, seedClassroom, lessonHtml } from "../test/helpers.ts";
import * as server from "../src/server.ts";
import * as store from "../src/store.ts";
import { learnerMarksFile } from "../src/paths.ts";
import { readLearnerMarks } from "../src/store/learner-marks.ts";
import { TeacherService } from "../src/teacher-service.ts";
import { readTeacherState } from "../src/service-state.ts";
import { highlightText, selectLocateAnswer, checkPractice } from "./browser-actions.ts";
import { checkFaded } from "./faded-browser-actions.ts";
import { checkSteppers } from "./stepper-browser-actions.ts";
import { playwright, playwrightCode } from "./playwright.ts";
import { quizAnswerSnapshot } from "./quiz-answer-snapshot.ts";

function inventory(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (!entry.name.startsWith(".learner-marks.json") && !file.includes("/.playwright-cli/"))
        files[path.relative(root, file)] = createHash("sha256")
          .update(fs.readFileSync(file))
          .digest("hex");
    }
  }
  walk(root);
  return files;
}

export async function verifyLearnerMarksBrowser(artifacts: string | null): Promise<void> {
  const f = makeFixture();
  seedClassroom(f);
  if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
  const session = `studens-learner-marks-${process.pid}`;
  const shell = (body: string) =>
    lessonHtml("Read, remember, return", body).replace(
      "<main data-cl-content>",
      '<main class="cl-lesson-shell" data-cl-content>',
    );
  const reading = `<header><h1>Read, remember, return</h1><p>Make the lesson your own, one passage at a time.</p></header><section><h2>Ownership and scope</h2><p data-mark-passage>Every value has one owner. Moving a value transfers responsibility for its cleanup.</p><p data-mark-second>Borrowing lets another scope read a value without taking ownership.</p><p>Return to the passage when you need to explain the distinction in your own words.</p></section>`;
  f.write("rust/001-ownership/lesson.html", shell(reading));
  f.write("rust/NOTES.md", "# Notes\n\nA controlled transport fixture.");
  const turns: string[] = [];
  const teacher = new TeacherService(async (_identity, prompt) => {
    turns.push(prompt);
    const id = /annotation_id: "([^"]+)"/.exec(prompt)?.[1];
    if (!id) throw new Error("Learner marks fixture received unexpected model work.");
    return {
      calls: [
        {
          name: "answer_lesson_question",
          arguments_json: JSON.stringify({
            annotation_id: id,
            answer_markdown:
              turns.length === 1
                ? "The owner controls release."
                : "A move transfers responsibility.",
          }),
        },
      ],
      message: "",
      learning_record: "",
      notes_markdown: "",
    };
  });
  server.setHooks({ onAsk() {}, onFollowUp() {}, onReflect() {}, onQuizSubmit() {} });
  const result: Record<string, unknown> = { fixtureTeacher: true, modelCalls: 0 };
  const code = <T>(body: string) => playwrightCode<T>(session, f.root, `async page=>{${body}}`);
  const snap = async (name: string) => {
    if (artifacts)
      await code(
        `await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:${JSON.stringify(path.join(artifacts, name + ".png"))},fullPage:true});return true;`,
      );
  };
  const select = (selector: string, phrase: string, action: string) =>
    code(
      `await page.evaluate(()=>getSelection().removeAllRanges());await (${highlightText.toString()})(page,${JSON.stringify(selector)},${JSON.stringify(phrase)});await page.locator('.cl-selection-actions:not([hidden])').waitFor();await page.getByRole('button',{name:${JSON.stringify(action)},exact:true}).click();return true;`,
    );
  let opened = false;
  try {
    const base = await server.start(0),
      url = base + "/c/rust/001-ownership";
    await playwright(session, f.root, "open");
    opened = true;
    let before = inventory(f.root);
    result.matchingCaptures = await code(`
      page.__markPosts=[];page.__markErrors=[];
      page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))page.__markPosts.push({url:r.url(),body:r.postData()});});
      page.on('pageerror',e=>page.__markErrors.push(e.message));
      const matrix=[];
      for(const [name,width,height] of [['desktop',1280,900],['mobile',390,844]]) {
        await page.setViewportSize({width,height});
        for(const theme of ['light','dark']) {
          await page.emulateMedia({colorScheme:theme});
          await page.goto(${JSON.stringify(url)});
          await page.evaluate(t=>{localStorage.setItem('pi-classroom-theme',t);document.documentElement.dataset.theme=t},theme);
          await page.waitForFunction(()=>document.querySelector('[data-mark-status]')?.textContent.includes('refreshed'));
          await (${highlightText.toString()})(page,'[data-mark-passage]','Every value has one owner.');
          await page.locator('.cl-ask-pill').waitFor();await page.evaluate(()=>scrollTo(0,0));
          if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Selection toolbar clips');
          ${artifacts ? `await page.screenshot({path:${JSON.stringify(artifacts)}+'/after-'+name+'-'+theme+'.png',fullPage:true});` : ""}
          matrix.push({name,width,height,theme});
        }
      }
      if(page.__markPosts.length)throw Error('Selection dispatched work');return matrix;
    `);
    assert.deepEqual(inventory(f.root), before, "Reading and selection changed durable state");
    assert.equal(turns.length, 0);
    teacher.connect();
    teacher.attach("rust", "codex");
    before = inventory(f.root);
    await code(
      `await page.setViewportSize({width:1280,height:900});await page.evaluate(()=>document.documentElement.dataset.theme='light');return true;`,
    );
    await select("[data-mark-passage]", "Every value has one owner.", "Note");
    await code(
      `await page.getByLabel('Margin note',{exact:true}).fill('<img src=x onerror=alert(1)> My own reasoning.');return true;`,
    );
    const lock = learnerMarksFile("rust", "001-ownership") + ".lock";
    fs.writeFileSync(lock, "interrupted fixture owner\n");
    result.rejectedSave = await code(`
      await page.locator('[data-mark-save]').click();
      await page.locator('[data-mark-error]').filter({hasText:'locked'}).waitFor();
      if(await page.getByLabel('Margin note',{exact:true}).inputValue()!=='<img src=x onerror=alert(1)> My own reasoning.')throw Error('Failed save lost draft');
      ${artifacts ? `await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:${JSON.stringify(path.join(artifacts, "save-error.png"))},fullPage:true});` : ""}
      const exactError=await page.locator('[data-mark-error]').textContent();
      const posts=page.__markPosts.length;await page.reload();
      await page.waitForFunction(()=>document.querySelector('[data-mark-note]')?.value.includes('My own reasoning.'));
      if(page.__markPosts.length!==posts)throw Error('Reload retried a save');
      return {posts,draftRestored:true,exactError};
    `);
    assert.deepEqual(inventory(f.root), before);
    assert.equal(readLearnerMarks("rust", "001-ownership").length, 0);
    await snap("save-error-restored");
    fs.unlinkSync(lock);
    result.note = await code(`
      await page.waitForTimeout(200);if(page.__markPosts.length!==1)throw Error('Lock removal retried implicitly');
      await page.locator('[data-mark-save]').click();
      await page.locator('[data-mark-list] [data-mark-id]').waitFor();
      if(await page.locator('.cl-learner-marks img').count())throw Error('Note rendered as markup');
      return {text:await page.locator('.cl-mark-text').innerText()};
    `);
    await select("[data-mark-passage]", "value has one owner.", "Highlight");
    await code(
      `await page.waitForFunction(()=>document.querySelectorAll('[data-mark-id]').length===2);return true;`,
    );
    await select("[data-mark-second]", "another scope", "Bookmark");
    result.kinds = await code(`
      await page.waitForFunction(()=>document.querySelectorAll('[data-mark-id]').length===3);
      const colors=await page.evaluate(()=>['highlight','note','bookmark'].map(k=>({kind:k,ranges:CSS.highlights.get('cl-learner-'+k).size})));
      if(colors.some(c=>c.ranges!==1))throw Error('Overlapping mark paint lost a kind');
      await page.reload();await page.waitForFunction(()=>document.querySelectorAll('[data-mark-id]').length===3);
      await page.locator('.cl-learner-marks summary').click();
      await page.locator('[data-mark-id]').first().getByRole('button',{name:'Revisit passage',exact:true}).click();
      if(await page.evaluate(()=>getSelection().toString())!=='Every value has one owner.')throw Error('Revisit selected wrong text');
      return {colors,reload:3,revisit:true};
    `);
    assert.deepEqual(inventory(f.root), before, "Marks changed teacher/evidence/history state");
    assert.equal(turns.length, 0);
    assert.equal(readTeacherState("rust")!.requests.length, 0);
    for (const [name, width, height] of [
      ["desktop", 1280, 900],
      ["mobile", 390, 844],
    ] as const) {
      for (const theme of ["light", "dark"]) {
        await code(
          `await page.setViewportSize({width:${width},height:${height}});await page.evaluate(t=>{document.documentElement.dataset.theme=t;getSelection().removeAllRanges()},${JSON.stringify(theme)});await page.waitForFunction(()=>document.querySelector('.cl-selection-actions').hidden);if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Saved marks layout clips after resize');return true;`,
        );
        await snap(`saved-${name}-${theme}`);
      }
    }
    result.twoTabs = await code(`
      await page.setViewportSize({width:1280,height:900});
      const other=await page.context().newPage();page.__otherMarkTab=other;await other.goto(${JSON.stringify(url)});
      await other.waitForFunction(()=>document.querySelectorAll('[data-mark-id]').length===3);await other.locator('.cl-learner-marks summary').click();
      await page.getByRole('button',{name:'Edit note',exact:true}).click();await other.getByRole('button',{name:'Edit note',exact:true}).click();
      await page.getByLabel('Margin note',{exact:true}).fill('First tab edit');await page.locator('[data-mark-save]').click();
      await page.getByText('First tab edit',{exact:true}).waitFor();
      await other.getByLabel('Margin note',{exact:true}).fill('Second tab draft');await other.locator('[data-mark-save]').click();
      await other.locator('[data-mark-error]').filter({hasText:'another tab'}).waitFor();
      if(await other.getByLabel('Margin note',{exact:true}).inputValue()!=='Second tab draft')throw Error('Conflict lost draft');
      await other.getByRole('button',{name:'Refresh saved marks',exact:true}).click();
      await other.getByText('First tab edit',{exact:true}).waitFor();
      await other.getByRole('button',{name:'Use refreshed revision',exact:true}).click();await other.locator('[data-mark-save]').click();
      await other.getByText('Second tab draft',{exact:true}).waitFor();
      await page.getByRole('button',{name:'Refresh saved marks',exact:true}).click();await page.getByText('Second tab draft',{exact:true}).waitFor();
      const add=async(p,selector,phrase)=>{await p.evaluate(()=>getSelection().removeAllRanges());await (${highlightText.toString()})(p,selector,phrase);await p.locator('.cl-selection-actions:not([hidden])').waitFor();await p.getByRole('button',{name:'Highlight',exact:true}).click();await p.waitForFunction(()=>document.querySelector('[data-mark-status]')?.textContent==='Mark saved.');};
      await Promise.all([add(page,'[data-mark-second]','Borrowing lets'),add(other,'[data-mark-passage]','cleanup.')]);
      await page.getByRole('button',{name:'Refresh saved marks',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('[data-mark-id]').length===5);
      for(const phrase of ['Borrowing lets','cleanup.']){const item=page.locator('[data-mark-id]').filter({has:page.locator('blockquote').filter({hasText:phrase})});await item.getByRole('button',{name:'Delete mark',exact:true}).click();await item.waitFor({state:'detached'});}
      await other.close();delete page.__otherMarkTab;
      return {staleEdit:409,draftKept:true,explicitRefreshAndRevision:true,concurrentCreatesPreserved:true};
    `);
    // Real storage lock also refuses deletes; read failures never clear visible saved marks.
    fs.writeFileSync(lock, "delete fixture owner\n");
    await code(
      `await page.locator('[data-mark-id]').last().getByRole('button',{name:'Delete mark',exact:true}).click();await page.locator('[data-mark-error]').filter({hasText:'locked'}).waitFor();if(await page.locator('[data-mark-id]').count()!==3)throw Error('Failed deletion hid mark');return true;`,
    );
    fs.unlinkSync(lock);
    result.delete = await code(`
      await page.locator('[data-mark-id]').last().getByRole('button',{name:'Delete mark',exact:true}).click();
      await page.waitForFunction(()=>document.querySelectorAll('[data-mark-id]').length===2);await page.reload();await page.waitForFunction(()=>document.querySelectorAll('[data-mark-id]').length===2);
      return {failedRetained:true,deletedAfterExplicitRetry:true};
    `);
    const file = learnerMarksFile("rust", "001-ownership"),
      durable = fs.readFileSync(file);
    fs.writeFileSync(file, '{"version":99,"marks":[]}');
    result.readFailure = await code(`
      await page.locator('.cl-learner-marks summary').click();await page.getByRole('button',{name:'Refresh saved marks',exact:true}).click();
      await page.locator('[data-mark-error]').filter({hasText:'learner marks'}).waitFor();
      if(await page.locator('[data-mark-id]').count()!==2)throw Error('Failed read cleared marks');return {specificError:true,visibleMarksKept:true};
    `);
    fs.writeFileSync(file, durable);
    await code(
      `await page.getByRole('button',{name:'Refresh saved marks',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[data-mark-error]').textContent);return true;`,
    );
    assert.deepEqual(inventory(f.root), before);
    assert.equal(turns.length, 0);
    const quiz = `<form class="cl-quiz" data-quiz-id="check" data-confidence="optional" data-evidence="report"><ol class="cl-questions"><li class="cl-q" data-question-id="q" data-type="choice"><p class="cl-q-prompt">Which scope releases a moved value?</p><label><input type="radio" name="q" value="new">The new owner</label><label><input type="radio" name="q" value="old">The old owner</label></li></ol></form>`;
    const repeat =
      '<section><h2>Repeated words</h2><p data-repeat="a">Before the move: repeat passage. The original binding owns it.</p><p data-repeat="b">After the move: repeat passage. The new binding owns it.</p></section>';
    const content = reading + repeat + quiz;
    f.write("rust/001-ownership/lesson.html", shell(content));
    f.write(
      "rust/001-ownership/lesson.json",
      JSON.stringify({ title: "Ownership", assessmentContract: 1, criterionContract: 1 }),
    );
    f.write(
      "rust/001-ownership/quiz/key.json",
      JSON.stringify({
        check: {
          q: {
            expected: "new",
            points: 1,
            full: "The current owner releases it.",
            partial: "The original binding moved it.",
            criteria: [{ id: "owner", description: "Identify the current owner.", points: 1 }],
          },
        },
      }),
    );
    await code(
      `await page.reload();await page.locator('form.cl-quiz[data-state="fresh"]').waitFor();await page.waitForFunction(()=>document.querySelector('[data-mark-status]')?.textContent.includes('refreshed'));return true;`,
    );
    await select('[data-repeat="b"]', "repeat passage", "Bookmark");
    await code(
      `await page.waitForFunction(()=>document.querySelectorAll('[data-mark-id]').length===3);return true;`,
    );
    result.repeated = await code(`
      const ranges=await page.evaluate(()=>[...CSS.highlights.get('cl-learner-bookmark')].map(r=>r.startContainer.parentElement.closest('p')?.dataset.repeat));
      if(JSON.stringify(ranges)!=='["b"]')throw Error('Repeated passage chose wrong occurrence');return {ranges};
    `);
    await select("form.cl-quiz label:first-of-type", "The new owner", "Note");
    await code(
      `await page.getByLabel('Margin note',{exact:true}).fill('A private quiz margin note');await page.locator('[data-mark-save]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-mark-id]').length===4);if(await page.locator('input:checked').count())throw Error('Option highlight changed answer');return true;`,
    );
    // Keyboard selection actions have an explicit focus shortcut; selection itself does no writes.
    result.keyboard = await code(`
      const posts=page.__markPosts.length;
      await (${highlightText.toString()})(page,'.cl-q-prompt','Which');for(let i=0;i<6;i++)await page.keyboard.press('Shift+ArrowRight');if(await page.evaluate(()=>getSelection().toString())!=='Which scope')throw Error('Keyboard extension selected wrong passage');await page.locator('.cl-selection-actions:not([hidden])').waitFor();await page.keyboard.press('Alt+m');
      if(!await page.locator('.cl-ask-pill').evaluate(el=>el===document.activeElement))throw Error('Selection shortcut did not focus actions');
      await page.keyboard.press('Tab');await page.keyboard.press('Enter');
      await page.waitForFunction(()=>document.querySelectorAll('[data-mark-id]').length===5);
      if(page.__markPosts.length!==posts+1)throw Error('Keyboard selection duplicated a mark');return {explicitAction:true};
    `);
    const beforeAdjacent = inventory(f.root);
    result.privacy = await code(`
      const codes=[];
      for(const route of ['.learner-marks.json','quiz/key.json'])codes.push((await page.request.get(${JSON.stringify(url)}+'/'+route)).status());
      if(codes.some(s=>s!==404))throw Error('Private files exposed');
      const state=await(await page.request.get(${JSON.stringify(base)}+'/api/state?classroom=rust&lesson=001-ownership')).json();
      if(JSON.stringify(state).includes('private quiz margin'))throw Error('Mark leaked into teacher/quiz state');
      const dom=await page.evaluate(async()=>{const {buildTextIndex}=await import('/static/lesson-dom.mjs');return buildTextIndex(document.body).text});if(dom.includes('private quiz margin')||dom.includes('Second tab draft')||dom.includes('Saved marks'))throw Error('Learner UI entered canonical index');if(page.__markErrors.length)throw Error(page.__markErrors.join(';'));return {codes,pageErrors:page.__markErrors,canonicalIndexExcludesMarkUI:true};
    `);
    assert.deepEqual(inventory(f.root), beforeAdjacent);
    assert.equal(turns.length, 0);
    assert.equal(readTeacherState("rust")!.requests.length, 0);
    // Adjacent Ask exercises the actual durable service queue, with fixture plans only.
    await select("[data-mark-passage]", "Every value", "Ask");
    result.ask = await code(`
      await page.locator('[data-cl-question]').fill('Who controls release?');await page.getByRole('button',{name:'Ask your teacher',exact:true}).click();
      await page.getByText('The owner controls release.',{exact:true}).waitFor();
      await page.locator('[data-cl-followup]').fill('What changes after a move?');await page.locator('[data-cl-followup-form]').getByRole('button',{name:'Ask',exact:true}).click();
      await page.getByText('A move transfers responsibility.',{exact:true}).waitFor();await page.reload();await page.getByText('A move transfers responsibility.',{exact:true}).waitFor();
      return {original:true,followUp:true,reload:true};
    `);
    await teacher.idle();
    assert.equal(turns.length, 2);
    assert.equal(readTeacherState("rust")!.requests.length, 2);
    assert.ok(readTeacherState("rust")!.requests.every((r) => r.status === "done"));
    assert.equal(store.listAnnotations("rust", "001-ownership").length, 1);
    result.assessment = await code(`
      await page.locator('.cl-learner-marks summary').click();await page.getByRole('button',{name:'Edit note',exact:true}).last().click();
      await page.getByLabel('Margin note',{exact:true}).fill('Unsent private margin draft');
      const form=page.locator('form.cl-quiz');await form.locator('input[value="new"]').check();await form.getByRole('button',{name:'Submit for grading',exact:true}).click();
      await form.locator('[data-cl-grade]').waitFor();
      if(await page.getByLabel('Margin note',{exact:true}).isDisabled())throw Error('Grade locked note editor');
      if(await page.getByLabel('Margin note',{exact:true}).inputValue()!=='Unsent private margin draft')throw Error('Grade cleared note draft');
      if(await page.locator('form.cl-quiz .cl-learner-marks,form.cl-quiz [data-mark-note]').count())throw Error('Note UI nested in assessment');
      await page.reload();await page.locator('form.cl-quiz[data-state="graded"]').waitFor();
      if(await page.getByLabel('Margin note',{exact:true}).inputValue()!=='Unsent private margin draft')throw Error('Reload lost note draft');
      await page.locator('.cl-expected > summary').first().click();const expected=page.locator('.cl-expected-value').first();await expected.waitFor();
      await (${highlightText.toString()})(page,'.cl-expected-value',await expected.innerText());
      await page.waitForTimeout(50);if(await page.locator('.cl-selection-actions').isVisible())throw Error('Expected-answer runtime text offered passage actions');
      const excluded=await page.evaluate(async()=>{const {buildTextIndex}=await import('/static/lesson-dom.mjs');return buildTextIndex(document.body).segments.every(s=>!s.node.parentElement.closest('.cl-expected,.cl-learner-marks'));});
      if(!excluded)throw Error('Expected answer/note UI entered canonical index');
      // Negative probe: the ordinary saved-answer snapshot must still notice a real answer mutation.
      const snapshot=()=>page.locator('form.cl-quiz').evaluate(${quizAnswerSnapshot.toString()});
      const saved=await snapshot();await page.locator('input[value="new"]').evaluate(el=>el.checked=false);
      if(JSON.stringify(await snapshot())===JSON.stringify(saved))throw Error('Snapshot concealed saved-answer mutation');
      await page.reload();await page.locator('form.cl-quiz[data-state="graded"]').waitFor();
      if(!await page.locator('input[value="new"]').isChecked())throw Error('Durable answer mutated');
      return {graded:true,marginDraftUnlocked:true,negativeMutationDetected:true,expectedUIExcluded:true};
    `);
    const submission = store.listSubmissions("rust", "001-ownership")[0];
    assert.equal(submission.answers.length, 1);
    assert.equal(submission.answers[0].value, "new");
    assert.ok(!JSON.stringify(submission).includes("margin"));
    assert.equal(store.listGrades("rust", "001-ownership")[0].score, 100);
    assert.equal(turns.length, 2);
    // Probe every answer-control category and each excluded runtime owner in a real DOM.
    result.answerSnapshot = await code(`
      return page.evaluate(() => {
        const form=document.createElement('form');
        const controls='<input type="checkbox" checked value="checked"><input type="text" value="text"><input value="default"><textarea>textarea</textarea><select><option selected value="select">Select</option></select>';
        form.innerHTML='<div class="cl-q">'+controls+['cl-q-verdict','cl-card-panel','cl-expected','cl-learner-marks'].map(c=>'<div class="'+c+'">'+controls+'</div>').join('')+'</div>'+controls;
        const snapshot=${quizAnswerSnapshot.toString()};
        const before=snapshot(form);
        const expected={checked:['checked'],text:['text','default','textarea'],selects:['select']};
        if(JSON.stringify(before)!==JSON.stringify(expected))throw Error('Answer snapshot did not retain exactly the authored controls: '+JSON.stringify(before));
        const detected=[];
        for(const selector of ['.cl-q > input[type=checkbox]','.cl-q > input[type=text]','.cl-q > input:not([type])','.cl-q > textarea','.cl-q > select']) {
          const el=form.querySelector(selector),value=el.value,checked=el.checked;
          if(el.type==='checkbox')el.checked=false;else el.value='changed';
          if(JSON.stringify(snapshot(form))===JSON.stringify(before))throw Error('Answer snapshot concealed mutation of '+selector);
          detected.push(selector);el.value=value;if(el.type==='checkbox')el.checked=checked;
        }
        return {before,excluded:['cl-q-verdict','cl-card-panel','cl-expected','cl-learner-marks'],negativeMutationsDetected:detected};
      });
    `);
    // Exercise the exact maintained authoring browser templates without rerolling a model lesson.
    const authoring = fs.readFileSync(new URL("./e2e-authoring.ts", import.meta.url), "utf8");
    const template = (name: string) => {
      const declaration = authoring.match(new RegExp("const " + name + " = (`[\\s\\S]*?`);"));
      if (!declaration) throw new Error(`Missing authoring browser template ${name}.`);
      return runInNewContext(declaration[1], {
        selectLocateAnswer,
        quizAnswerSnapshot,
        checkPractice,
        checkFaded,
        checkSteppers,
      }) as string;
    };
    seedClassroom(f, { lesson: "002-authoring" });
    f.write("rust/002-authoring/lesson.html", shell(reading + quiz));
    f.write(
      "rust/002-authoring/lesson.json",
      fs.readFileSync(path.join(f.root, "rust/001-ownership/lesson.json"), "utf8"),
    );
    f.write(
      "rust/002-authoring/quiz/key.json",
      fs.readFileSync(path.join(f.root, "rust/001-ownership/quiz/key.json"), "utf8"),
    );
    await code(
      `await page.goto(${JSON.stringify(base + "/c/rust/002-authoring")});await page.locator('form.cl-quiz[data-state="fresh"]').waitFor();await page.waitForFunction(()=>document.querySelector('[data-mark-status]')?.textContent.includes('refreshed'));return true;`,
    );
    await select(".cl-q-prompt", "Which scope", "Note");
    await code(
      `await page.getByLabel('Margin note',{exact:true}).fill('Authoring snapshot must exclude this note draft');return true;`,
    );
    const submittedAuthoring = await playwrightCode<{ submitted: unknown[] }>(
      session,
      f.root,
      template("SUBMIT_LESSON"),
    );
    const gradedAuthoring = await playwrightCode<{
      quizzes: Array<{ saved: { checked: string[]; text: string[] } }>;
    }>(session, f.root, template("READ_GRADED"));
    assert.deepEqual(gradedAuthoring.quizzes[0].saved.checked, ["new"]);
    assert.deepEqual(gradedAuthoring.quizzes[0].saved.text, []);
    await code(
      `await page.locator('input[value="new"]').evaluate(el=>el.checked=false);return true;`,
    );
    const mutatedAuthoring = await playwrightCode<{ quizzes: Array<{ saved: unknown }> }>(
      session,
      f.root,
      template("READ_GRADED").replace("await page.reload();", ""),
    );
    assert.notDeepEqual(mutatedAuthoring.quizzes[0].saved, gradedAuthoring.quizzes[0].saved);
    result.authoringTemplates = {
      submittedAuthoring,
      gradedAuthoring,
      negativeMutationDetected: true,
      modelAuthoring: false,
    };
    await code(
      `await page.goto(${JSON.stringify(url)});await page.locator('form.cl-quiz[data-state="graded"]').waitFor();return true;`,
    );
    // Reflow and honest surrounding edits preserve exact passages; missing/tied quotes stay visible.
    f.write(
      "rust/001-ownership/lesson.html",
      shell(
        content
          .replace("<section><h2>Ownership", "<section><p>A new introduction.</p><h2>Ownership")
          .replace("Every value has one owner.", "Every   value has <strong>one owner.</strong>"),
      ),
    );
    result.reflow = await code(
      `await page.reload();await page.waitForFunction(()=>document.querySelectorAll('[data-mark-id]').length===5);const size=await page.evaluate(()=>CSS.highlights.get('cl-learner-note').size);if(size!==2)throw Error('Reflow lost exact marks');return {noteRanges:size};`,
    );
    const repeatedMark = readLearnerMarks("rust", "001-ownership").find(
      (m) => m.kind === "bookmark",
    )!;
    const a = repeatedMark.anchor;
    const duplicate = `<p>${a.prefix}${a.exact}${a.suffix}</p>`;
    f.write(
      "rust/001-ownership/lesson.html",
      shell("<h1>Edited lesson</h1>" + duplicate + duplicate),
    );
    result.unresolved = await code(`
      await page.reload();await page.waitForFunction(()=>document.querySelectorAll('[data-mark-id]').length===5);
      if(!await page.locator('.cl-learner-marks').evaluate(e=>e.open))await page.locator('.cl-learner-marks summary').click();
      const statuses=await page.locator('.cl-mark-anchor-status').allTextContents();
      if(!statuses.some(s=>s.includes('Ambiguous'))||!statuses.some(s=>s.includes('not found')))throw Error('Edited anchors concealed ambiguity/missing passage');
      if(await page.evaluate(()=>CSS.highlights.get('cl-learner-bookmark').size)!==0)throw Error('Ambiguous mark guessed a passage');
      return {statuses,bookmarkRanges:0};
    `);
    await snap("unresolved-passages");
    assert.deepEqual(
      readLearnerMarks("rust", "001-ownership").find((m) => m.id === repeatedMark.id)?.anchor,
      a,
    );
    f.write(
      "rust/001-ownership/lesson.html",
      shell(
        "<h1>Edited lesson</h1>" +
          duplicate +
          duplicate +
          "<p data-overlap-quote>ha <span data-overlap-choice>ha ha</span></p>",
      ),
    );
    await code(
      `await page.reload();await page.waitForFunction(()=>document.querySelectorAll('[data-mark-id]').length===5);await page.getByRole('button',{name:'Discard draft',exact:true}).click();return true;`,
    );
    await select("[data-overlap-choice]", "ha ha", "Bookmark");
    result.overlappingQuote = await code(
      `await page.waitForFunction(()=>document.querySelectorAll('[data-mark-id]').length===6);const matches=await page.evaluate(()=>[...CSS.highlights.get('cl-learner-bookmark')].map(r=>({text:r.toString(),selectedOccurrence:!!r.startContainer.parentElement.closest('[data-overlap-choice]')})));if(matches.length!==1||!matches[0].selectedOccurrence)throw Error('Overlapping occurrence moved mark to the earlier phrase');return {matches};`,
    );
    result.modelCalls = turns.length;
    result.zeroTeacherUntilAdjacentAsk = true;
    result.marks = readLearnerMarks("rust", "001-ownership");
    result.teacher = readTeacherState("rust");
    result.harnessSourceSHA256 = createHash("sha256")
      .update(fs.readFileSync(import.meta.filename))
      .digest("hex");
    if (artifacts)
      fs.writeFileSync(path.join(artifacts, "result.json"), JSON.stringify(result, null, 2));
    console.log(
      "PASS: explicit marks, safe note edit/delete, failed saves/draft reload, concurrency, repeats/reflow/unresolved anchors, private routes, no teacher/evidence effects, adjacent durable Ask/follow-up and machine assessment",
    );
  } catch (error) {
    if (artifacts)
      fs.writeFileSync(
        path.join(artifacts, "failure.json"),
        JSON.stringify(
          {
            error: String(error),
            diagnostics: (error as { browserDiagnostics?: unknown }).browserDiagnostics,
            result,
          },
          null,
          2,
        ),
      );
    throw error;
  } finally {
    if (artifacts)
      fs.cpSync(f.root, path.join(artifacts, "classroom"), { recursive: true, dereference: false });
    try {
      if (opened) await playwright(session, f.root, "close");
    } finally {
      await teacher.stop();
      await server.close();
      f.cleanup();
    }
  }
}
