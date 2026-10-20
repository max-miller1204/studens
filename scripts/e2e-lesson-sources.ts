/** Exercise source navigation via real rendered controls, with read-only host fixtures. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { makeFixture } from "../test/helpers.ts";
import { seedSourceCourse } from "../test/lesson-sources-fixture.ts";
import { saveLessonRequests } from "../src/store/lesson-requests.ts";
import * as server from "../src/server.ts";
import * as store from "../src/store.ts";
import { applyGrade } from "../src/quiz-grading.ts";
import { playwright, playwrightCode } from "./playwright.ts";
function hashes(root: string): Record<string, string> {
  return Object.fromEntries(
    fs
      .readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => {
        const file = path.join(e.parentPath, e.name);
        return [
          path.relative(root, file),
          createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
        ];
      })
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}
export async function verifyLessonSources(artifacts: string | null): Promise<void> {
  const f = makeFixture(),
    session = "studens-sources-" + process.pid,
    out = artifacts ?? fs.mkdtempSync(path.join(os.tmpdir(), "studens-source-evidence-"));
  fs.mkdirSync(out, { recursive: true });
  seedSourceCourse(f);
  let opened = false,
    owner: "pi" | "claude" | "codex" = "pi",
    modelCalls = 0;
  const forbidden = () => {
    modelCalls++;
    throw new Error("Source navigation triggered a teacher or write.");
  };
  server.setHooks({
    delivery: "service",
    lessonOwner: () => owner,
    onAsk: forbidden,
    onFollowUp: forbidden,
    onReflect: forbidden,
    onQuizSubmit: forbidden,
    onTeacherChat: forbidden,
    onNextLesson: forbidden,
  });
  const results: unknown[] = [];
  const readOnly = (label: string, before: Record<string, string>) => {
    const after = hashes(f.root);
    fs.writeFileSync(
      path.join(out, label + "-hashes.json"),
      JSON.stringify(
        { before, after, equal: JSON.stringify(before) === JSON.stringify(after), modelCalls },
        null,
        2,
      ),
    );
    assert.deepEqual(after, before, label + " wrote files");
    assert.equal(modelCalls, 0);
  };
  try {
    const base = await server.start(0);
    await playwright(session, out, "open", base + "/c/course/003-predictions");
    opened = true;
    for (const backend of ["pi", "claude", "codex"] as const) {
      owner = backend;
      const before = hashes(f.root);
      const result = await playwrightCode(
        session,
        out,
        `async page=>{
    const errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!['GET','HEAD'].includes(r.method()))writes.push({method:r.method(),url:r.url()});});
    const source=${JSON.stringify(base + "/c/course/003-predictions")};await page.goto(source);await page.locator('.cl-term').first().waitFor();
    const nav=page.getByRole('navigation',{name:'Lesson prerequisites',exact:true});await nav.getByRole('link',{name:'Values and ownership',exact:true}).click();
    if(page.url()!==${JSON.stringify(base + "/c/course/001-values")})throw new Error('Prerequisite did not open canonical owner.');
    await page.goto(source);await page.locator('.cl-term').first().waitFor();
    if(await page.locator('.cl-term').count()!==2)throw new Error('Repeated sections lost glossary terms.');
    const captures=[];
    for(const [size,width,height] of ${
      backend === "pi"
        ? JSON.stringify([
            ["desktop", 1280, 900],
            ["mobile", 390, 844],
          ])
        : JSON.stringify([["desktop", 1280, 900]])
    })for(const theme of ${backend === "pi" ? '["light","dark"]' : '["light"]'}) {
      await page.setViewportSize({width,height});await page.evaluate(t=>localStorage.setItem('pi-classroom-theme',t),theme);await page.reload();await page.locator('.cl-term').first().waitFor();await page.evaluate(()=>window.scrollTo(0,0));
      const shell=await page.locator('.cl-lesson-shell').boundingBox();
      await page.screenshot({path:${JSON.stringify(out)}+'/lesson-'+size+'-'+theme+'.png',fullPage:true});
      const term=page.locator('.cl-term').first();await term.focus();await page.keyboard.press('Enter');
      const pop=page.getByRole('dialog',{name:'Ownership',exact:true});
      if(await pop.getByRole('link').count() && await pop.getByRole('link').isVisible())throw new Error('Source bypassed recall.');
      await pop.getByRole('button',{name:'Show the definition',exact:true}).click();
      await pop.getByRole('link',{name:'Values and ownership',exact:true}).waitFor();
      const box=await pop.boundingBox();if(box.x<0||box.y<0||box.x+box.width>width||box.y+box.height>height)throw new Error('Popover clipped viewport.');
      if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Horizontal overflow.');
      await page.screenshot({path:${JSON.stringify(out)}+'/glossary-'+size+'-'+theme+'.png',fullPage:true});
      await page.keyboard.press('Escape');if(!await term.evaluate(e=>e===document.activeElement))throw new Error('Escape lost term focus.');
      await page.keyboard.press('Space');await pop.getByRole('button',{name:'Show the definition',exact:true}).click();
      await pop.getByRole('link',{name:'Values and ownership',exact:true}).focus();await page.keyboard.press('Enter');
      await page.waitForURL(${JSON.stringify(base + "/c/course/001-values#ownership")});if(page.url()!==${JSON.stringify(base + "/c/course/001-values#ownership")})throw new Error('Wrong glossary teaching destination.');
      await page.locator('#ownership').waitFor();await page.reload();await page.waitForFunction(()=>document.activeElement?.id==='ownership');const targetBox=await page.locator('#ownership').boundingBox();const headerBox=await page.locator('.cl-header').boundingBox();if(targetBox.y<headerBox.y+headerBox.height-1)throw new Error('Teaching source is obscured by sticky header.');
      await page.goto(source);await page.locator('.cl-term').first().click();await page.getByRole('button',{name:'Close definition',exact:true}).click();
      if(!await page.locator('.cl-term').first().evaluate(e=>e===document.activeElement))throw new Error('Close lost term focus.');
      captures.push({size,width,height,theme,shell,box,canonicalSource:true,recallFirst:true,escapeFocus:true,closeFocus:true,persistedAfterReload:true});
    }
    if(errors.length||writes.length)throw new Error(JSON.stringify({errors,writes}));return {backend:${JSON.stringify(backend)},captures,errors,writes};
   }`,
      );
      results.push(result);
      readOnly(backend + "-navigation", before);
    }
    let searchBefore = hashes(f.root);
    results.push(
      await playwrightCode(
        session,
        out,
        `async page=>{
      await page.goto(${JSON.stringify(base + "/search?q=Ownership")});
      await page.getByRole('link',{name:'Ownership',exact:true}).click();
      await page.getByRole('heading',{name:'Glossary term',exact:true}).waitFor();
      await page.getByRole('link',{name:'Values and ownership',exact:true}).click();
      await page.waitForURL(${JSON.stringify(base + "/c/course/001-values#ownership")});
      await page.locator('#ownership').waitFor();return {searchTermSource:true,canonicalSource:true};
    }`,
      ),
    );
    readOnly("search-source", searchBefore);
    const missionFile = "course/MISSION.md",
      mission = fs.readFileSync(f.root + "/" + missionFile, "utf8");
    f.write(
      missionFile,
      mission.replace("001-values/@objective/ownership", "../quiz/@objective/ownership"),
    );
    searchBefore = hashes(f.root);
    await playwrightCode(
      session,
      out,
      `async page=>{
      await page.goto(${JSON.stringify(base + "/c/course/003-predictions")});
      const nav=page.getByRole('navigation',{name:'Lesson prerequisites',exact:true});
      await nav.getByRole('alert').filter({hasText:'MISSION.md'}).waitFor();
      await nav.getByRole('link',{name:'Retry loading lesson links',exact:true}).waitFor();return {prerequisiteSourceError:true};
    }`,
    );
    readOnly("prerequisite-error", searchBefore);
    f.write(missionFile, mission);
    searchBefore = hashes(f.root);
    await playwrightCode(
      session,
      out,
      `async page=>{
      await page.getByRole('link',{name:'Retry loading lesson links',exact:true}).click();
      await page.getByRole('navigation',{name:'Lesson prerequisites',exact:true}).getByRole('link',{name:'Values and ownership',exact:true}).click();
      await page.waitForURL(${JSON.stringify(base + "/c/course/001-values")});return {explicitPrerequisiteRetry:true};
    }`,
    );
    readOnly("prerequisite-retry", searchBefore);
    // Context exclusions use real math/diagram rendering, not generated-node fixtures.
    const lessonFile = "course/003-predictions/lesson.html",
      lesson = fs.readFileSync(f.root + "/" + lessonFile, "utf8");
    f.write(
      lessonFile,
      lesson.replace(
        "</main>",
        '<section><h2>Other representations</h2><p>Ownership and \\(x^2+1\\).</p><pre><code>Ownership stays literal in code.</code></pre><pre class="mermaid" aria-label="Value ownership flow">flowchart LR\n A[Ownership] --> B[Call]</pre><p>The value moves from its owner into a call.</p></section></main>',
      ),
    );
    let before = hashes(f.root);
    results.push(
      await playwrightCode(
        session,
        out,
        `async page=>{await page.goto(${JSON.stringify(base + "/c/course/003-predictions")});await page.locator('math').waitFor();await page.locator('.cl-diagram svg').waitFor();await page.locator('.cl-term').first().waitFor();if(await page.locator('pre .cl-term, code .cl-term, math .cl-term, svg .cl-term').count())throw new Error('Terms wrapped generated or literal content.');await page.locator('.cl-term').nth(1).click();await page.getByRole('button',{name:'Show the definition',exact:true}).click();await page.getByRole('dialog').getByRole('link',{name:'Values and ownership',exact:true}).click();await page.locator('#ownership').waitFor();return {math:true,code:true,diagram:true,repeatedTerm:true};}`,
      ),
    );
    readOnly("representations", before);
    f.write(lessonFile, lesson);
    const originFile = "course/001-values/lesson.html",
      origin = fs.readFileSync(f.root + "/" + originFile, "utf8");
    // A link already shown can become stale after an author edits the owning section.
    await playwrightCode(
      session,
      out,
      `async page=>{await page.goto(${JSON.stringify(base + "/c/course/003-predictions")});await page.locator('.cl-term').first().click();await page.getByRole('button',{name:'Show the definition',exact:true}).click();await page.getByRole('dialog').getByRole('link',{name:'Values and ownership',exact:true}).waitFor();return true;}`,
    );
    f.write(originFile, origin.replace('id="ownership"', 'id="edited-ownership"'));
    before = hashes(f.root);
    await playwrightCode(
      session,
      out,
      `async page=>{await page.getByRole('dialog').getByRole('link',{name:'Values and ownership',exact:true}).click();await page.waitForURL(${JSON.stringify(base + "/c/course/001-values#ownership")});await page.getByRole('status').filter({hasText:'This section is no longer available.'}).waitFor();await page.getByRole('link',{name:'Retry loading source section',exact:true}).waitFor();if(await page.locator('#edited-ownership').evaluate(e=>e===document.activeElement))throw Error('Stale origin guessed a replacement');return {staleSource:true};}`,
    );
    readOnly("stale-held-source", before);
    f.write(originFile, origin);
    before = hashes(f.root);
    await playwrightCode(
      session,
      out,
      `async page=>{await page.getByRole('link',{name:'Retry loading source section',exact:true}).click();await page.waitForFunction(()=>document.activeElement?.id==='ownership');return {explicitStaleSourceRetry:true};}`,
    );
    readOnly("stale-source-retry", before);
    for (const [name, html, note] of [
      [
        "legacy",
        origin.replace(' data-cl-teaches="Ownership"', ""),
        "No available teaching origin is recorded.",
      ],
      [
        "orphan",
        origin.replace('id="ownership"', 'id="../key.json"'),
        "invalid teaching-origin declaration",
      ],
      [
        "url-like",
        origin.replace('id="ownership"', 'id="https://evil.test"'),
        "invalid teaching-origin declaration",
      ],
      [
        "edited",
        origin.replace(
          '<section id="ownership" data-cl-teaches="Ownership"><p>Every value has an owner.</p></section>',
          "<p>The source section was removed.</p>",
        ),
        "No available teaching origin is recorded.",
      ],
    ]) {
      f.write(originFile, html);
      before = hashes(f.root);
      results.push(
        await playwrightCode(
          session,
          out,
          `async page=>{await page.goto(${JSON.stringify(base + "/c/course/003-predictions")});await page.locator('.cl-term').first().click();await page.getByRole('button',{name:'Show the definition',exact:true}).click();const pop=page.getByRole('dialog');await pop.getByText(${JSON.stringify(note)},{exact:false}).waitFor();if(await pop.getByRole('link').count())throw new Error('Unavailable source has a link.');await page.screenshot({path:${JSON.stringify(path.join(out, name + ".png"))},fullPage:true});return {state:${JSON.stringify(name)},specificState:true};}`,
        ),
      );
      readOnly(name, before);
    }
    f.write(originFile, origin.replace('id="ownership"', 'id="../key.json"'));
    await playwrightCode(
      session,
      out,
      `async page=>{await page.goto(${JSON.stringify(base + "/c/course/003-predictions")});await page.locator('.cl-term').first().click();await page.getByRole('button',{name:'Show the definition',exact:true}).click();await page.getByRole('button',{name:'Retry loading teaching sources',exact:true}).waitFor();return true;}`,
    );
    f.write(originFile, origin);
    await playwrightCode(
      session,
      out,
      `async page=>{await page.getByRole('button',{name:'Retry loading teaching sources',exact:true}).click();await page.locator('.cl-term').first().click();await page.getByRole('button',{name:'Show the definition',exact:true}).click();await page.getByRole('dialog').getByRole('link',{name:'Values and ownership',exact:true}).click();await page.locator('#ownership').waitFor();return {explicitRetry:true};}`,
    );
    // Failed request and legacy review declarations must never become destinations.
    f.write(
      "course/005-review/lesson.html",
      '<main><section id="private-review" data-cl-teaches="Borrowing">PRIVATE_REVIEW</section></main>',
    );
    f.write(
      "course/006-pending/lesson.html",
      '<main><section id="pending" data-cl-teaches="Borrowing">PRIVATE_PENDING</section></main>',
    );
    saveLessonRequests("course", [
      {
        id: "00000000-0000-4000-8000-000000000031",
        classroom: "course",
        lesson: "006-pending",
        topic: "",
        owner: "codex",
        ownerPid: process.pid,
        delivery: "service",
        at: 1,
        status: "failed",
        error: "Owned unfinished publication fixture.",
      },
    ]);
    const borrowFile = "course/002-borrow/lesson.html",
      borrow = fs.readFileSync(f.root + "/" + borrowFile, "utf8");
    f.write(
      borrowFile,
      borrow.replace('id="teach-borrow"', 'id="teach-borrow" data-cl-teaches="Borrowing"'),
    );
    const withBorrow = mission.replace(
      '"connections": [',
      '"connections": [{"from":"003-predictions/@objective/ownership","to":"002-borrow/@objective/ownership","kind":"builds-on"},',
    );
    f.write(missionFile, withBorrow);
    before = hashes(f.root);
    assert.equal(
      (await fetch(base + "/c/course/003-predictions").then((r) => r.text())).includes(
        'href="/c/course/002-borrow#teach-borrow"',
      ),
      false,
    );
    const api = await fetch(base + "/api/glossary?classroom=course").then((r) => r.json());
    assert.equal(api.terms[1].origin.status, "unavailable");
    assert.ok(
      !/private-review|PRIVATE_|HIDDEN_|teach-borrow|006-pending/.test(JSON.stringify(api)),
    );
    for (const route of [
      "/c/course/006-pending",
      "/c/course/001-values/quiz/plan.json",
      "/doc/course/001-values/quiz/key.json",
      "/c/course/reviews/review-00000000-0000-4000-8000-000000000031",
      "/static/quiz/key.json",
    ]) {
      const r = await fetch(base + route);
      assert.equal(r.status, 404, route);
    }
    readOnly("private-neighbors", before);
    // Explicit real pretest submission is separate from navigation and creates one diagnostic grade.
    server.setHooks({
      delivery: "wait",
      onAsk: forbidden,
      onFollowUp: forbidden,
      onReflect: forbidden,
      onQuizSubmit(s) {
        applyGrade(s, {
          score: 0,
          feedbackMarkdown: "Diagnostic only.",
          questions: [{ questionId: "q1", correct: false, feedback: "Read the teaching." }],
        });
      },
    });
    await playwrightCode(
      session,
      out,
      `async page=>{await page.goto(${JSON.stringify(base + "/c/course/002-borrow")});await page.locator('form[data-state="fresh"]').waitFor();if(await page.locator('#teach-borrow').count())throw new Error('Hidden origin rendered early.');await page.locator('[data-quiz-id="pretest-1"] textarea').fill('I predict a borrowing conflict.');await page.getByRole('button',{name:'Submit for grading',exact:true}).click();await page.locator('#teach-borrow').waitFor();return {pretestReleased:true};}`,
    );
    assert.equal(store.listSubmissions("course", "002-borrow").length, 1);
    assert.equal(store.latestGrades("course", "002-borrow").length, 1);
    before = hashes(f.root);
    assert.equal(
      (await fetch(base + "/api/glossary?classroom=course").then((r) => r.json())).terms[1].origin
        .url,
      "/c/course/002-borrow#teach-borrow",
    );
    await playwrightCode(
      session,
      out,
      `async page=>{await page.reload();await page.locator('#teach-borrow').waitFor();await page.goto(${JSON.stringify(base + "/c/course/003-predictions")});await page.getByRole('navigation',{name:'Lesson prerequisites',exact:true}).getByRole('link',{name:'Borrowing',exact:true}).click();await page.waitForURL(${JSON.stringify(base + "/c/course/002-borrow#teach-borrow")});await page.waitForFunction(()=>document.activeElement?.id==='teach-borrow');const t=await page.locator('#teach-borrow').boundingBox(),h=await page.locator('.cl-header').boundingBox();if(t.y<h.y+h.height-1)throw Error('Prerequisite heading obscured');return {releasedPersistence:true,existingTeachingMapping:true};}`,
    );
    readOnly("released-navigation", before);
    fs.writeFileSync(
      path.join(out, "result.json"),
      JSON.stringify(
        {
          results,
          modelCalls,
          diagnosticSubmissions: 1,
          diagnosticGrades: 1,
          fixtureOrigins: true,
          realModelOrigins: false,
        },
        null,
        2,
      ),
    );
    console.log(
      "PASS: explicit lesson/glossary navigation, three host owners, recall, focus, themes/mobile, context exclusions, source errors, private neighbors, gates, reload and read-only state.",
    );
  } catch (error) {
    fs.writeFileSync(
      path.join(out, "failure.json"),
      JSON.stringify({ error: String(error), partialResults: results }, null, 2),
    );
    if (opened) {
      fs.writeFileSync(
        path.join(out, "failure-snapshot.txt"),
        await playwright(session, out, "snapshot"),
      );
      await playwright(session, out, "screenshot", "--filename=" + path.join(out, "failure.png"));
    }
    throw error;
  } finally {
    if (opened) await playwright(session, out, "close");
    await server.close();
    f.cleanup();
    fs.writeFileSync(
      path.join(out, "cleanup.json"),
      JSON.stringify({
        sessionClosed: true,
        serverClosed: true,
        fixtureRemoved: !fs.existsSync(f.root),
      }),
    );
  }
}
