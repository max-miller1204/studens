/** Matched workspace page captures through learner navigation, without teacher work. */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import * as server from "../src/server.ts";
import { makeFixture, seedClassroom, lessonHtml } from "../test/helpers.ts";
import { playwright, playwrightCode } from "./playwright.ts";

export async function verifyDocumentPagesBrowser(out: string): Promise<void> {
  fs.mkdirSync(out, { recursive: true });
  const f = makeFixture();
  seedClassroom(f);
  f.write(
    "rust/NOTES.md",
    "# Notes\n\nOwnership keeps resources predictable.\n\n## Practice\n\n- Explain when a value is released.\n",
  );
  f.write(
    "rust/learning-records/001-ownership.md",
    "# Learning Record 1: Ownership\n\n## What I learned\n\nAn owner releases its value at the end of its scope.\n\n## Evidence\n\nExplained ownership with an independent example.\n",
  );
  f.write(
    "rust/001-ownership/lesson.html",
    lessonHtml(
      "Ownership",
      "<h1>Ownership</h1><p>Every value has one owner. Ownership makes resource lifetimes predictable.</p>",
    ),
  );
  f.write(
    "rust/002-review/lesson.json",
    JSON.stringify({ title: "Ownership review", kind: "review", createdAt: 1700000000000 }),
  );
  f.write(
    "rust/002-review/lesson.html",
    lessonHtml(
      "Ownership review",
      '<h1>Ownership review</h1><form class="cl-quiz" data-quiz-id="review-check" data-kind="review"><ol class="cl-questions"><li class="cl-q" data-question-id="q1" data-type="choice"><p class="cl-q-prompt">Who releases a value?</p><label><input type="radio" name="q1" value="owner">Its owner</label></li></ol></form>',
    ),
  );
  const hash = () =>
    Object.fromEntries(
      fs
        .readdirSync(f.root, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => {
          const file = path.join(e.parentPath, e.name);
          return [
            path.relative(f.root, file),
            createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
          ];
        }),
    );
  const before = hash();
  let requests = 0;
  const forbidden = () => {
    requests++;
    throw Error("Workspace reading triggered teacher activity.");
  };
  server.setHooks({
    delivery: "wait",
    onAsk: forbidden,
    onFollowUp: forbidden,
    onReflect: forbidden,
    onQuizSubmit: forbidden,
    onTeacherChat: forbidden,
  });
  const session = `studens-documents-${process.pid}`;
  let opened = false;
  try {
    const base = await server.start(0);
    await playwright(session, out, "open", base);
    opened = true;
    const result = await playwrightCode<{
      matrix: Array<{ name: string; width: number; theme: string }>;
      errors: string[];
    }>(
      session,
      out,
      `async page => {
      const base=${JSON.stringify(base)}, out=${JSON.stringify(out)}, matrix=[], errors=[];
      page.on('pageerror', e=>errors.push(e.message));
      const shot=async name=>{await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:out+'/'+name+'.png',fullPage:true});};
      // The landing card's stable href is also how the learner enters a classroom.
      const enter=async()=>{await page.goto(base);await page.locator('main a[href="/c/rust"]').first().click();};
      for(const width of [1280,390]) for(const theme of ['light','dark']) {
        await page.setViewportSize({width,height:900}); await enter();
        await page.getByRole('link',{name:'Settings',exact:true}).filter({visible:true}).first().click();
        await page.locator('[data-settings-content]').waitFor({state:'visible'});
        await page.getByLabel('Theme',{exact:true}).selectOption(theme);
        await page.waitForFunction(t=>document.documentElement.dataset.theme===t,theme);
        await page.getByLabel('Accent',{exact:true}).selectOption('indigo');
        await page.waitForFunction(()=>document.documentElement.dataset.accent==='indigo');
        await page.locator('[data-settings-content]').waitFor({state:'visible'});
        await shot('settings-'+width+'-'+theme);
        for(const accent of ['indigo','copper','green','neutral']) {
          await page.getByLabel('Accent',{exact:true}).selectOption(accent);
          await page.waitForFunction(a=>document.documentElement.dataset.accent===a,accent);
          await page.reload();
          await page.locator('[data-settings-content]').waitFor({state:'visible'});
          if(await page.getByLabel('Accent',{exact:true}).inputValue()!==accent) throw Error('Accent did not persist');
          await page.locator('[data-settings-content]').waitFor({state:'visible'});
          await shot('accent-'+accent+'-'+width+'-'+theme);
        }
        await page.getByLabel('Accent',{exact:true}).selectOption('indigo');
        await page.waitForFunction(()=>document.documentElement.dataset.accent==='indigo');
        const check=async name=>{if(await page.locator('html').getAttribute('data-theme')!==theme)throw Error('Theme mismatch: '+name);await page.evaluate(()=>document.fonts.ready);if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Overflow: '+name);await shot(name+'-'+width+'-'+theme);matrix.push({name,width,theme});};
        await enter(); await page.getByRole('link',{name:'Course map',exact:true}).click();await check('course-map');
        await page.getByRole('link',{name:'Read mission document',exact:true}).click();await check('mission-document');
        await enter(); await page.getByRole('link',{name:'Review history',exact:true}).click();await check('review-history');
        await page.locator('.cl-workspace-list a, .cl-lessons a').first().click();
        await page.goBack();
        await enter(); await page.locator('a[href="/doc/rust/learning-records"]').first().click();await check('learning-records');
        await page.locator('.cl-records a').first().click();await check('record-document');
        await enter(); await page.locator('a[href="/doc/rust/NOTES.md"]').first().click();await check('notes-document');
        await enter(); await page.getByRole('link',{name:'Export',exact:true}).click();
        await page.locator('#cl-export').screenshot({path:out+'/export-'+width+'-'+theme+'.png'});
        await page.goto(base);await page.getByRole('link',{name:'Search classrooms',exact:true}).click();
        await page.getByRole('searchbox').fill('owner');await page.getByRole('button',{name:'Search',exact:true}).click();
        if(!await page.locator('.cl-search-results mark').count())throw Error('Missing highlight');await check('search');
        await page.locator('.cl-search-results h2 a').first().click();await page.goBack();
        if(await page.getByRole('searchbox').inputValue()!=='owner')throw Error('Query lost');
        await page.getByRole('searchbox').fill('no-such-public-phrase');await page.getByRole('button',{name:'Search',exact:true}).click();
        await page.getByRole('status').filter({hasText:'No results'}).waitFor();await check('search-empty');
      }
      if(errors.length)throw Error(errors.join('; '));return {matrix,errors};
    }`,
    );
    // A malformed saved source must keep its specific error until an explicit retry.
    for (const width of [1280, 390])
      for (const theme of ["light", "dark"]) {
        await playwrightCode(
          session,
          out,
          `async page => {
        const base=${JSON.stringify(base)};
        await page.setViewportSize({width:${width},height:900});
        await page.goto(base+'/c/rust/settings');
        await page.locator('[data-settings-content]').waitFor({state:'visible'});
        await page.getByLabel('Theme',{exact:true}).selectOption(${JSON.stringify(theme)});
        await page.waitForFunction(t=>document.documentElement.dataset.theme===t,${JSON.stringify(theme)});
        await page.goto(base+'/c/rust');
        await page.getByRole('link',{name:'Export',exact:true}).click();
        return {exportReady:true};
      }`,
        );
        const publication = f.write("rust/.lesson-requests.json", "{PRIVATE_EXPORT_CANARY");
        await playwrightCode(
          session,
          out,
          `async page => {
        const opened=page.waitForEvent('popup');
        await page.getByRole('button',{name:'Open printable classroom',exact:true}).click();
        const error=await opened;await error.waitForLoadState();
        await error.setViewportSize({width:${width},height:900});
        await error.evaluate(async()=>{getComputedStyle(document.body).width;await new Promise(requestAnimationFrame);await Promise.all(document.getAnimations().map(a=>a.finished));await document.fonts.ready;});
        await error.getByRole('alert').filter({hasText:'invalid lesson or review publication state'}).waitFor();
        if((await error.content()).includes('PRIVATE_EXPORT_CANARY'))throw Error('Export disclosed private source');
        await error.screenshot({path:${JSON.stringify(path.join(out, `export-error-${width}-${theme}.png`))},fullPage:true});
        return {specificError:true};
      }`,
        );
        fs.rmSync(publication);
        await playwrightCode(
          session,
          out,
          `async page => {
        const failed=page.context().pages().find(p=>p.url().includes('/api/export?'));
        if(!failed)throw Error('Missing failed export');
        await failed.getByRole('link',{name:'Retry export',exact:true}).click();
        await failed.getByRole('heading',{name:'Contents',exact:true}).waitFor();
        await failed.close();return {explicitRetry:true};
      }`,
        );
      }
    assert.equal(requests, 0);
    assert.deepEqual(hash(), before);
    fs.writeFileSync(
      path.join(out, "result.json"),
      JSON.stringify(
        { ...result, teacherRequests: requests, hashesUnchanged: true, exportExplicitRetry: true },
        null,
        2,
      ),
    );
  } catch (error) {
    fs.writeFileSync(
      path.join(out, "failure.json"),
      JSON.stringify(error, Object.getOwnPropertyNames(error), 2),
    );
    throw error;
  } finally {
    if (opened) await playwright(session, out, "close");
    await server.close();
    f.cleanup();
    fs.writeFileSync(
      path.join(out, "cleanup.json"),
      JSON.stringify({ serverRunning: server.isRunning(), fixtureExists: fs.existsSync(f.root) }),
    );
  }
}
