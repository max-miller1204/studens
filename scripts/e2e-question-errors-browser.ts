/** Rejected questions keep their drafts until the learner explicitly resends. */
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { makeFixture, seedClassroom, lessonHtml } from "../test/helpers.ts";
import * as server from "../src/server.ts";
import * as store from "../src/store.ts";
import { applyAnswer } from "../src/bridge.ts";
import { highlightText } from "./browser-actions.ts";
import { playwright, playwrightCode } from "./playwright.ts";

export async function verifyQuestionErrorsBrowser(artifacts: string | null): Promise<void> {
  const f = makeFixture();
  seedClassroom(f);
  f.write(
    "rust/001-ownership/lesson.html",
    lessonHtml("Ownership", "<h1>Ownership</h1><p>Every value has one owner.</p>"),
  );
  const original = store.createAnnotation({
    classroom: "rust",
    lesson: "001-ownership",
    question: "Who owns the value?",
    selection: "one owner",
    anchor: { exact: "one owner", prefix: "Every value has ", suffix: ".", occurrence: 0 },
  });
  store.updateAnnotation(original.id, {
    status: "answered",
    answerMarkdown: "One owner controls release.",
    answerHtml: "<p>One owner controls release.</p>",
    answeredAt: Date.now(),
  });
  const annotationFile = path.join(f.root, "rust/001-ownership/annotations.json");
  const digest = () => createHash("sha256").update(fs.readFileSync(annotationFile)).digest("hex");
  const before = digest();
  const exact = "Fixture ownership changed. Reopen this classroom, then retry explicitly.";
  let refusing = true;
  const callbacks: string[] = [];
  server.setHooks({
    delivery: "service",
    canAccept() {
      if (refusing) throw new Error(exact);
    },
    onAsk(annotation) {
      callbacks.push("ask");
      applyAnswer(annotation.id, "Each value has one owner responsible for release.");
    },
    onFollowUp(annotation) {
      callbacks.push("follow-up");
      applyAnswer(annotation.id, "A move transfers ownership.");
    },
    onQuizSubmit() {
      throw new Error("Question rejection must not submit a quiz.");
    },
    onReflect() {
      throw new Error("Question rejection must not save a reflection.");
    },
  });
  const session = `studens-question-errors-${process.pid}`;
  const result: Record<string, unknown> = { inference: false };
  let opened = false;
  if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
  const code = <T>(body: string) => playwrightCode<T>(session, f.root, `async page=>{${body}}`);
  try {
    const base = await server.start(0);
    await playwright(session, f.root, "open", `${base}/c/rust/001-ownership`);
    opened = true;
    await code(`
      page.__questionDialogs=[];page.__questionPosts=[];
      page.on('dialog',d=>page.__questionDialogs.push({type:d.type(),message:d.message()}));
      page.on('request',r=>{if(r.method()==='POST'&&(r.url().endsWith('/api/ask')||r.url().endsWith('/follow-up')))page.__questionPosts.push(r.url());});
      return true;
    `);
    for (const kind of ["follow-up", "ask"]) {
      const ask = kind === "ask";
      const form = ask ? "[data-cl-ask-form]" : "[data-cl-followup-form]";
      const field = ask ? "[data-cl-question]" : "[data-cl-followup]";
      const question = ask ? "Who owns the value?" : "What about a move?";
      await code(
        ask
          ? `await (${highlightText.toString()})(page,'main > p','Every value');await page.locator('.cl-ask-pill').click();await page.locator('${field}').fill(${JSON.stringify(question)});return true;`
          : `await page.locator('${field}').fill(${JSON.stringify(question)});return true;`,
      );
      const observation = await code<{ posts: number; dialogs: unknown[] }>(`
        await page.route('**/${ask ? "api/ask" : "follow-up"}',async route=>{page.__questionRoute=route;page.__questionResponse=await route.fetch();},{times:1});
        const form=page.locator('${form}');
        await form.getByRole('button',{name:'${ask ? "Ask your teacher" : "Ask"}',exact:true}).click();
        for(let i=0;!page.__questionResponse&&i<500;i++)await page.waitForTimeout(10);
        if(!page.__questionResponse)throw new Error('The canonical rejection did not arrive.');
        const response=page.__questionResponse,body=await response.json();
        if(response.status()!==500||body.error!==${JSON.stringify(exact)})throw new Error('Wrong canonical rejection.');
        await page.locator('${field}').press('Control+Enter');await page.waitForTimeout(100);
        if(page.__questionPosts.length!==${ask ? 2 : 1})throw new Error('A pending keyboard submit duplicated the request.');
        await page.__questionRoute.fulfill({response});delete page.__questionRoute;delete page.__questionResponse;
        await form.locator('[role=alert]').filter({hasText:${JSON.stringify(exact)}}).waitFor();
        if(await page.locator('${field}').inputValue()!==${JSON.stringify(question)})throw new Error('Rejection lost the typed question.');
        if(await form.getByRole('button',{name:'${ask ? "Ask your teacher" : "Ask"}',exact:true}).isDisabled())throw new Error('Explicit resend is disabled.');
        return {status:response.status(),body,error:await form.locator('[role=alert]').textContent(),question:await page.locator('${field}').inputValue(),posts:page.__questionPosts.length,dialogs:page.__questionDialogs};
      `);
      if (callbacks.length || digest() !== before || observation.dialogs.length)
        throw new Error(
          "A rejected question changed its annotation, woke a teacher, or opened a modal.",
        );
      result[kind] = observation;
      for (const [mode, width, height, theme] of ask
        ? ([
            ["desktop", 1280, 800, "light"],
            ["mobile", 375, 812, "dark"],
          ] as const)
        : ([
            ["mobile", 375, 812, "light"],
            ["desktop", 1280, 800, "dark"],
          ] as const)) {
        if (artifacts)
          await code(
            `await page.setViewportSize({width:${width},height:${height}});await page.evaluate(t=>{localStorage.setItem('cl-theme',t);document.documentElement.dataset.theme=t},'${theme}');await page.screenshot({path:${JSON.stringify(path.join(artifacts, `${kind}-${mode}-${theme}.png`))}});return true;`,
          );
      }
      await code(`
        await page.reload();
        ${ask ? "await page.getByRole('button',{name:'Open your unsent question',exact:true}).click();" : ""}
        await page.waitForFunction(()=>document.querySelector('${field}')?.value===${JSON.stringify(question)});
        if(page.__questionPosts.length!==${ask ? 2 : 1})throw new Error('Reload resubmitted a rejected question.');return true;
      `);
    }
    result.rejected = { annotationHashUnchanged: digest() === before, callbacks: callbacks.length };
    refusing = false;
    result.recovery = await code(`
      await page.waitForTimeout(250);if(page.__questionPosts.length!==2)throw new Error('Restored ownership automatically resent work.');
      await page.locator('[data-cl-ask-form]').getByRole('button',{name:'Ask your teacher',exact:true}).click();
      await page.getByText('Each value has one owner responsible for release.',{exact:true}).waitFor();
      const original=page.locator('[data-annotation-id="${original.id}"]');
      await original.locator('[data-cl-followup]').fill('What about a move?');
      await original.locator('[data-cl-followup-form]').getByRole('button',{name:'Ask',exact:true}).click();
      await original.getByText('A move transfers ownership.',{exact:true}).waitFor();
      await page.reload();await original.getByText('A move transfers ownership.',{exact:true}).waitFor();
      if(page.__questionDialogs.length||page.__questionPosts.length!==4)throw new Error('Recovery opened a modal or duplicated work.');
      return {posts:page.__questionPosts.length,dialogs:page.__questionDialogs};
    `);
    const annotations = store.listAnnotations("rust", "001-ownership");
    const saved = annotations.find((a) => a.id === original.id)!;
    if (
      annotations.length !== 2 ||
      callbacks.join(",") !== "ask,follow-up" ||
      saved.answerMarkdown !== "One owner controls release." ||
      saved.followUps?.length !== 1 ||
      saved.followUps[0].question !== "What about a move?" ||
      store.listSubmissions("rust", "001-ownership").length ||
      store.listGrades("rust", "001-ownership").length
    )
      throw new Error("Explicit resend changed the original answer or duplicated accepted work.");
    result.annotations = annotations;
    result.callbacks = callbacks;
    console.log(
      "PASS: canonical ask/follow-up rejection, specific inline errors, retained drafts/reload, no modal or implicit resend, pending-keyboard guard, one accepted request per explicit resend, original answer unchanged",
    );
  } catch (error) {
    result.failure = {
      error: String(error),
      diagnostics: (error as { browserDiagnostics?: unknown }).browserDiagnostics,
      annotations: store.listAnnotations("rust", "001-ownership"),
      callbacks,
    };
    throw error;
  } finally {
    if (artifacts)
      fs.writeFileSync(path.join(artifacts, "result.json"), JSON.stringify(result, null, 2));
    if (opened) await playwright(session, f.root, "close");
    await server.close();
    f.cleanup();
  }
}
