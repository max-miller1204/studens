/** Controlled publication/grades, actual learner controls and downloaded artifacts; no inference. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as http from "node:http";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { makeFixture } from "../test/helpers.ts";
import { seedTemplateExport, templateLesson } from "../test/export-template-fixture.ts";
import { projectClassroom } from "../src/classroom-export.ts";
import { renderMarkdown } from "../src/markdown.ts";
import { expectedAnswers } from "../src/expected-answers.ts";
import { TeacherService } from "../src/teacher-service.ts";
import * as store from "../src/store.ts";
import * as server from "../src/server.ts";
import { playwright, playwrightCode } from "./playwright.ts";
const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
// The same public reading must remain distinguishable in print, Markdown and imported cards.
const optionReadingProbe = `async page => page.evaluate(() => {
  const pairs = [['New owner — café λ','Old binding'],['First resource','Second resource']];
  return pairs.map(labels => {
    const boxes = labels.map(label => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node; while(node = walker.nextNode()) {
        const start = node.textContent.indexOf(label);if(start < 0) continue;
        const range = document.createRange();range.setStart(node,start);range.setEnd(node,start+label.length);
        const r = range.getBoundingClientRect();
        if(r.width > 0 && r.height > 0) return {text:range.toString(),x:r.x,y:r.y,width:r.width,height:r.height};
      }
      throw new Error('Public option is not separately readable: '+label);
    });
    const [a,b] = boxes;
    if(!(b.y >= a.y+a.height || (b.x > a.x+a.width+0.5 && b.y === a.y))) throw new Error('Public option boundaries join or overlap');
    return boxes;
  });
})`;
const hashes = (root: string) =>
  Object.fromEntries(
    fs
      .readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => {
        const file = path.join(e.parentPath, e.name);
        return [path.relative(root, file), sha(fs.readFileSync(file))];
      })
      .sort(([a], [b]) => a.localeCompare(b)),
  );
export async function verifyExportTemplateBrowser(artifacts: string | null): Promise<void> {
  const out = artifacts ?? fs.mkdtempSync(path.join(os.tmpdir(), "studens-template-export-"));
  fs.mkdirSync(out, { recursive: true });
  const f = makeFixture(),
    session = `studens-template-export-${process.pid}`;
  seedTemplateExport(f);
  // An unrelated classroom is covered by every before/after read inventory.
  f.write("other/classroom.json", JSON.stringify({ title: "Unrelated saved classroom" }));
  let opened = false,
    teacher: TeacherService | undefined,
    calls = 0;
  const save = (name: string, value: unknown) =>
    fs.writeFileSync(path.join(out, name + ".json"), JSON.stringify(value, null, 2));
  server.setHooks({
    onAsk() {
      throw new Error("Unexpected question");
    },
    onFollowUp() {
      throw new Error("Unexpected follow-up");
    },
    onReflect() {
      throw new Error("Unexpected reflection");
    },
    onQuizSubmit() {
      throw new Error("Expected machine grading");
    },
  });
  try {
    const base = await server.start(0),
      url = base + `/c/gates/${templateLesson}`;
    await playwright(session, out, "open", url);
    opened = true;
    save(
      "learner",
      await playwrightCode(
        session,
        out,
        `async page=>{
      await page.setViewportSize({width:1280,height:900});await page.evaluate(()=>localStorage.setItem('pi-classroom-theme','light'));await page.goto(${JSON.stringify(url)});
      if(await page.locator('[data-quiz-id="check"]').count())throw new Error('Assessment released before diagnostic');
      const diagnostic=page.locator('[data-quiz-id="before"]');await diagnostic.locator('.cl-number').fill('2');await diagnostic.getByRole('button',{name:'Submit for grading',exact:true}).click();await page.locator('[data-quiz-id="before"][data-state="graded"]').waitFor();
      const check=page.locator('[data-quiz-id="check"]');await check.waitFor();
      await check.locator('[value="key-choice-a"]').check();for(const id of ['key-multi-a','key-multi-b'])await check.locator('[value="'+id+'"]').check();
      await check.locator('[data-item="key-order-b"]').getByRole('button',{name:'Move up'}).click();await check.locator('[data-item="key-left-a"] select').selectOption('key-right-b');await check.locator('[data-item="key-left-b"] select').selectOption('key-right-a');await check.locator('[data-segment="key-segment-b"]').click();
      for(const id of ['corrective','locked'])await check.locator('[data-question-id="'+id+'"] .cl-number').fill('0');
      const response=page.waitForResponse(r=>r.url().endsWith('/api/quiz/submit')&&r.request().method()==='POST');await check.getByRole('button',{name:'Submit for grading',exact:true}).click();const r=await response;if(r.status()!==201)throw new Error(await r.text());
      await page.locator('[data-quiz-id="check"][data-state="graded"]').waitFor();await check.locator('[data-question-id="choice"] .cl-expected[data-status="available"]').waitFor();
      const value=await check.locator('[data-question-id="choice"] .cl-expected-value').innerText();if(value!=='New owner — café λ')throw new Error('Visible original answer mismatch: '+value);
      await page.evaluate(()=>scrollTo(0,0));await page.locator('.cl-lesson-shell').waitFor();await page.screenshot({fullPage:true,path:${JSON.stringify(out + "/lesson.png")}});
      return {visibleAnswer:value,graded:true,pendingDiagnostic:await page.locator('[data-quiz-id="later"] .cl-number').isEnabled(),available:await check.locator('.cl-expected[data-status="available"]').count(),waiting:await check.locator('.cl-expected[data-status="waiting"]').count()};
    }`,
      ),
    );
    const submission = store
      .latestQuizStates("gates", templateLesson)
      .find((s) => s.quizId === "check")!.submission;
    save("controlled-input-hashes", hashes(f.root));
    // Retain exact publication/attempt/grade bytes externally, never in public screenshots.
    fs.cpSync(f.root, path.join(out, "private-classrooms"), { recursive: true });
    const exportPhase = async (phase: string) => {
      const before = hashes(f.root),
        callsBefore = calls;
      const result = await playwrightCode(
        session,
        out,
        `async page=>{
        const outputs=[];for(const answers of [false,true]){
          await page.goto(${JSON.stringify(base + "/c/gates")});const consent=page.getByRole('checkbox',{name:'Include answers already unlocked in Studens',exact:true});if(await consent.isChecked())throw new Error('Consent defaulted on');if(answers)await consent.check();
          const prefix=${JSON.stringify(out + "/" + phase)}+(answers?'-on':'-off');
          const popup=page.waitForEvent('popup');await page.getByRole('button',{name:'Open printable classroom',exact:true}).click();const print=await popup;await print.waitForLoadState('networkidle');
          await print.screenshot({path:prefix+'-print.png',fullPage:true});const html=await print.content();await print.evaluate(()=>scrollTo(0,0));
          if(await print.getByRole('heading',{name:'Cannot export classroom',exact:true}).count()){const error=await print.locator('[role="alert"]').innerText();await print.close();throw new Error(error);}
          if(/CANARY|key-(choice|multi|order|left|right|segment)|731987654/.test(html))throw new Error('Print leaked private or inert content');
          if((await print.getByRole('heading',{name:'Expected answer',exact:true}).count()>0)!==answers)throw new Error('Print answer consent mismatch');
          if(answers){await print.getByText('New owner — café λ',{exact:true}).last().waitFor();await print.getByText('Resource → New binding',{exact:false}).waitFor();}
          if(await print.locator('form,input,button').count())throw new Error('Print retained controls');await print.emulateMedia({media:'print'});await print.pdf({path:prefix+'.pdf',format:'A4',printBackground:true,outline:true});
          const boundaries=await (${optionReadingProbe})(print);outputs.push({answers,format:'print',boundaries});
          await print.emulateMedia({media:'screen'});await print.getByText('Released teaching',{exact:true}).scrollIntoViewIfNeeded();await print.screenshot({path:prefix+'-reading.png'});await print.close();
          for(const [label,ext] of [['Download Markdown','md'],['Download Anki deck','apkg']]){const pending=page.waitForEvent('download');await page.getByRole('button',{name:label,exact:true}).click();const d=await pending;await d.saveAs(prefix+'.'+ext);if(await d.failure())throw new Error(await d.failure());outputs.push({answers,ext,file:prefix+'.'+ext});}
        }
        await page.reload();if(await page.getByRole('checkbox',{name:'Include answers already unlocked in Studens',exact:true}).isChecked())throw new Error('Consent survived reload');return outputs;
      }`,
      );
      const owners = [];
      let projectionHash: string | undefined;
      for (const owner of ["pi", "claude", "codex"]) {
        const file = path.join(f.root, "gates/.teacher.json"),
          state = JSON.parse(fs.readFileSync(file, "utf8"));
        state.identity.backend = owner;
        fs.writeFileSync(file, JSON.stringify(state));
        const ownerBefore = hashes(f.root),
          projection = projectClassroom("gates", true, base)!,
          digest = sha(JSON.stringify(projection));
        if (projectionHash && projectionHash !== digest)
          throw new Error("Owner changed public content");
        projectionHash = digest;
        const formats = [];
        for (const format of ["markdown", "print", "anki"]) {
          const r = await fetch(base + `/api/export?classroom=gates&format=${format}&answers=1`);
          const bytes = Buffer.from(await r.arrayBuffer());
          if (r.status !== 200 || /CANARY|731987654/.test(bytes.toString()))
            throw new Error("Owner export failed privacy");
          formats.push({ format, status: r.status, sha256: sha(bytes) });
        }
        if (JSON.stringify(ownerBefore) !== JSON.stringify(hashes(f.root)))
          throw new Error("Export wrote owner state");
        owners.push({ owner, formats, projectionHash: digest });
      }
      const after = hashes(f.root);
      for (const file of Object.keys(before))
        if (file !== "gates/.teacher.json" && before[file] !== after[file])
          throw new Error("Export wrote " + file);
      if (callsBefore !== calls) throw new Error("Export invoked fixture teacher");
      save(phase + "-read-only", {
        before,
        after,
        allowedFixtureChange: "gates/.teacher.json owner only",
        callsBefore,
        callsAfter: calls,
        owners,
      });
      for (const consent of ["off", "on"]) {
        const data = projectClassroom("gates", consent === "on", base)!;
        save(phase + "-" + consent + "-projection", data);
        const md = fs.readFileSync(path.join(out, phase + "-" + consent + ".md"), "utf8");
        if (/CANARY|731987654|key-(choice|multi|order|left|right|segment)/.test(md))
          throw new Error("Markdown leaked private identities");
        fs.writeFileSync(
          path.join(out, phase + "-" + consent + ".html"),
          `<!doctype html><meta charset="utf-8"><style>body{font:18px/1.5 sans-serif;padding:2rem}pre{white-space:pre-wrap}</style>${renderMarkdown(md)}`,
        );
      }
      save(
        phase + "-markdown-reading",
        await playwrightCode(
          session,
          out,
          `async page=>{const readings=[];for(const consent of ['off','on']){await page.goto('file://'+${JSON.stringify(out + "/" + phase)}+'-'+consent+'.html');readings.push({consent,boundaries:await (${optionReadingProbe})(page)});}await page.screenshot({path:${JSON.stringify(out + "/" + phase + "-markdown.png")},fullPage:true});return {rendered:true,readings};}`,
        ),
      );
      return result;
    };
    save("graded-downloads", await exportPhase("graded"));
    // Explicit controlled corrective task/reply/check via the production teacher boundary.
    teacher = new TeacherService(async () => {
      calls++;
      return {
        message:
          calls === 1
            ? "Calculate a new resource count and explain it."
            : "Your new calculation is complete.",
        notes_markdown: "",
        learning_record:
          calls === 1 ? "" : "# Controlled correction\nThe learner calculates a new count.",
        calls:
          calls === 1
            ? []
            : [
                {
                  name: "record_retrieval_check",
                  arguments_json: JSON.stringify({
                    classroom: "gates",
                    review_key: `${templateLesson}/check/corrective`,
                    answer: "29 resources in the new case. No help.",
                    evidence: "Calculates the new case independently.",
                    assistance: "none",
                  }),
                },
              ],
      };
    });
    teacher.attach("gates", "codex");
    teacher.connect();
    teacher.resume({ classroom: "gates", lesson: templateLesson, submission_id: submission.id });
    await teacher.idle();
    teacher.chat("gates", templateLesson, "29 resources in the new case. No help.", randomUUID());
    await teacher.idle();
    const eligibility = expectedAnswers(submission);
    if (eligibility.corrective.status !== "available" || eligibility.locked.status !== "waiting")
      throw new Error("Corrective eligibility mismatch");
    save("corrective-eligibility", eligibility);
    await teacher.stop();
    teacher = undefined;
    save("corrected-downloads", await exportPhase("corrected"));
    save("result", {
      verdict: "PASS",
      base,
      fixture:
        "Controlled saved publication and two controlled teacher turns; no model/provider calls",
      fixtureTeacherCalls: calls,
      exportTeacherCalls: 0,
      providerCalls: 0,
      partialGate: true,
      canonicalTypes: ["choice", "multi", "order", "match", "locate"],
      correctiveUnlocked: true,
      lockedNeighbor: true,
      unreleasedNeighbor: true,
    });
  } catch (error) {
    save("failure", { error: String(error), stack: (error as Error).stack });
    throw error;
  } finally {
    await teacher?.stop();
    if (opened) await playwright(session, out, "close");
    await server.close();
    f.cleanup();
    save("cleanup", {
      sessionClosed: true,
      serverClosed: true,
      fixtureRemoved: !fs.existsSync(f.root),
    });
  }
}

/** Inspect the answer card emitted by official Anki core, rather than a reconstructed note. */
export async function verifyTemplateImportedCardBrowser(out: string): Promise<void> {
  const session = `studens-template-card-${process.pid}`;
  const files = new Set(fs.readdirSync(out));
  const listener = http.createServer((req, res) => {
    const file = (req.url ?? "").slice(1);
    if (
      !files.has(file) ||
      !/^(answer-card\.html|(?:graded|corrected)-(?:off|on)-reading-card\.html|_studens-mermaid\.min\.js)$/.test(
        file,
      )
    ) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.setHeader(
      "Content-Type",
      file.endsWith(".js") ? "application/javascript" : "text/html; charset=utf-8",
    );
    res.end(fs.readFileSync(path.join(out, file)));
  });
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = (listener.address() as import("node:net").AddressInfo).port;
  let opened = false;
  try {
    opened = true;
    await playwright(session, out, "open", `http://127.0.0.1:${port}/answer-card.html`);
    const result = await playwrightCode(
      session,
      out,
      `async page=>{
      await page.setViewportSize({width:1280,height:900});
      const answer=page.locator('pre');await answer.waitFor();const text=await answer.innerText();if(text!=='New owner — café λ')throw new Error('Official imported answer lost original label');
      const box=await answer.boundingBox();if(!box||box.width<=0||box.height<=0)throw new Error('Imported answer did not render');
      if(/CANARY|key-choice/.test(await page.locator('body').innerText()))throw new Error('Private identity in imported answer');
      await page.screenshot({path:${JSON.stringify(path.join(out, "answer-card.png"))},fullPage:true});
      const readings=[];for(const phase of ['graded','corrected'])for(const consent of ['off','on']){const stem=phase+'-'+consent;await page.goto(${JSON.stringify(`http://127.0.0.1:${port}/`)}+stem+'-reading-card.html');readings.push({stem,boundaries:await (${optionReadingProbe})(page)});await page.screenshot({path:${JSON.stringify(out + "/")}+stem+'-reading-card.png',fullPage:true});}
      return {text,box,readings,scope:'Official core card.answer HTML in Chromium; no Anki desktop/mobile UI'};
    }`,
    );
    fs.writeFileSync(path.join(out, "card-browser-report.json"), JSON.stringify(result, null, 2));
  } finally {
    if (opened) await playwright(session, out, "close");
    await new Promise<void>((resolve) => listener.close(() => resolve()));
  }
}
