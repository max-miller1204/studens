/** Shared real-host drive through the classroom control, retaining durable output. */
import * as fs from "node:fs";
import * as path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lessonRequests } from "../src/next-lesson.ts";
import * as store from "../src/store.ts";
import { readTeacherState } from "../src/service-state.ts";
import { TEST_MODELS } from "./harness.ts";
import { playwrightCode } from "./playwright.ts";
export async function driveRealNextLesson(
  browser: string,
  root: string,
  base: string,
  host: string,
  artifacts: string | null,
): Promise<void> {
  const viewport = await playwrightCode<{ width: number; height: number }>(
    browser,
    root,
    "async page=>page.viewportSize()",
  );
  const originalEvidence = JSON.stringify(store.readLearningRecords("rust"));
  const originalGrades = JSON.stringify(store.listGrades("rust", "001-ownership"));
  const before = lessonRequests("rust").length;
  const selected = host === "claude" || host === "codex" ? TEST_MODELS[host].model : null;
  if (selected)
    await playwrightCode(
      browser,
      root,
      `async page=>{
      await page.goto(${JSON.stringify(base)}+'/c/rust/settings');
      await page.getByLabel('Teacher model',{exact:true}).selectOption('__custom__');
      await page.getByLabel('Model ID',{exact:true}).fill(${JSON.stringify(selected)});
      await page.getByRole('button',{name:'Save teacher model',exact:true}).click();
      await page.getByRole('status').filter({hasText:'Saved for the next'}).waitFor();return true;
    }`,
    );
  await playwrightCode(
    browser,
    root,
    `async page=>{
    await page.goto(${JSON.stringify(base)}+'/c/rust');
    await page.getByRole('button',{name:'Next lesson',exact:true}).waitFor();
    await page.getByLabel('What would you like to learn next?').fill('Teach a short lesson on shared borrowing in Rust: predict whether two immutable references may coexist. Use the official Rust Book at https://doc.rust-lang.org/book/ch04-02-references-and-borrowing.html as the research source. Keep one objective, one prequestion, one later check, and two private review variants for the check.');
    await page.getByRole('button',{name:'Next lesson',exact:true}).click();return true;
  }`,
  );
  const deadline = Date.now() + 600_000;
  let saved;
  let retried = false;
  while (Date.now() < deadline) {
    saved = lessonRequests("rust").at(-1);
    if (saved?.status === "failed") {
      if (artifacts) {
        fs.writeFileSync(
          path.join(
            artifacts,
            retried ? "next-lesson-retry-failed.json" : "next-lesson-failed.json",
          ),
          JSON.stringify(saved, null, 2),
        );
        await playwrightCode(
          browser,
          root,
          `async page=>{await page.goto(${JSON.stringify(base)}+'/c/rust');await page.getByRole('button',{name:'Retry lesson',exact:true}).waitFor();await page.screenshot({path:${JSON.stringify(path.join(artifacts, retried ? "next-lesson-retry-failed.png" : "next-lesson-failed.png"))},fullPage:true});return true;}`,
        );
      }
      if (retried || saved.document || saved.modelOutput === undefined)
        throw new Error(`Real ${host} Next lesson failed: ${saved.error}`);
      console.log(
        `[e2e:${host}] Rejected authoring output: ${saved.error}. Exercising one explicit Retry lesson action.`,
      );
      await playwrightCode(
        browser,
        root,
        `async page=>{await page.getByRole('button',{name:'Retry lesson',exact:true}).click();return true;}`,
      );
      retried = true;
      continue;
    }
    if (saved?.status === "done") break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.equal(saved?.status, "done", "Next lesson did not finish within 600 seconds");
  assert.equal(lessonRequests("rust").length, before + 1);
  assert.ok(saved!.document);
  assert.ok(saved!.pageCheck);
  assert.equal(
    saved!.pageCheck.hash,
    createHash("sha256").update(JSON.stringify(saved!.document)).digest("hex"),
  );
  assert.equal(JSON.parse(saved!.pageCheck.report).learnerStateChanged, false);
  assert.equal(JSON.stringify(store.readLearningRecords("rust")), originalEvidence);
  if (selected) {
    const teacher = readTeacherState("rust")!;
    const turn = teacher.requests.find((r) => r.id === `lesson:${saved!.id}`)!;
    assert.equal(turn.requestedModel, selected);
    assert.equal(turn.resolvedModel, selected);
    assert.equal(teacher.identity.activeRequestedModel, selected);
  }
  assert.equal(store.listSubmissions("rust", saved!.lesson).length, 0);
  assert.equal(store.listGrades("rust", saved!.lesson).length, 0);
  assert.equal(JSON.stringify(store.listGrades("rust", "001-ownership")), originalGrades);
  await playwrightCode(
    browser,
    root,
    `async page=>{
    await page.waitForURL('**/${saved!.lesson}',{timeout:30000});
    await page.waitForFunction(()=>document.querySelector('form.cl-quiz')?.dataset.state==='fresh');
    if(await page.locator('.cl-contract-error').count()) throw new Error('Authored page has contract errors');
    ${artifacts ? `await page.screenshot({path:${JSON.stringify(path.join(artifacts, `${host}-next-lesson.png`))},fullPage:true});` : ""}
    await page.reload(); await page.waitForFunction(()=>document.querySelector('form.cl-quiz')?.dataset.state==='fresh');
    return true;
  }`,
  );
  if (artifacts)
    for (const [label, width, height] of [
      ["desktop", 1440, 1000],
      ["mobile", 390, 844],
    ] as const)
      await playwrightCode(
        browser,
        root,
        `async page=>{
        await page.setViewportSize({width:${width},height:${height}});
        await page.screenshot({path:${JSON.stringify(path.join(artifacts, `${host}-next-lesson-${label}.png`))},fullPage:true});return true;
      }`,
      );
  await playwrightCode(
    browser,
    root,
    `async page=>{await page.setViewportSize(${JSON.stringify(viewport)});return true;}`,
  );
  if (selected)
    await playwrightCode(
      browser,
      root,
      `async page=>{
      await page.goto(${JSON.stringify(base)}+'/c/rust/settings');
      await page.getByLabel('Teacher model',{exact:true}).selectOption('');
      await page.getByRole('button',{name:'Save teacher model',exact:true}).click();
      await page.getByRole('status').filter({hasText:'Saved for the next'}).waitFor();return true;
    }`,
    );
  if (artifacts)
    fs.writeFileSync(
      path.join(artifacts, "stored-next-lesson.json"),
      JSON.stringify(saved, null, 2),
    );
  console.log(
    `[e2e:${host}] PASS: classroom Next lesson saved, checked without learner submissions, published and opened`,
  );
}
