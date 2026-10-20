/** Downloads from real controls; fixture owners verify the read boundary, not model behavior. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { makeFixture, termAnswer } from "../test/helpers.ts";
import { seedExport } from "../test/export-fixture.ts";
import { seedCourse, addCourseIntentions } from "../test/course-map-fixture.ts";
import { projectClassroom } from "../src/classroom-export.ts";
import { exportAnki } from "../src/export-anki.ts";
import { renderMarkdown } from "../src/markdown.ts";
import { applyGrade } from "../src/quiz-grading.ts";
import * as store from "../src/store.ts";
import * as server from "../src/server.ts";
import { playwright, playwrightCode } from "./playwright.ts";
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
function hashes(root: string): Record<string, string> {
  return Object.fromEntries(
    fs
      .readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => {
        const file = path.join(e.parentPath, e.name);
        return [path.relative(root, file), sha(fs.readFileSync(file))];
      })
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}
export async function verifyClassroomExportBrowser(artifacts: string | null): Promise<void> {
  const out = artifacts ?? fs.mkdtempSync(path.join(os.tmpdir(), "studens-export-browser-"));
  fs.mkdirSync(out, { recursive: true });
  const f = makeFixture(),
    session = `studens-export-${process.pid}`;
  let opened = false,
    teacherCalls = 0;
  seedExport(f);
  seedCourse(f);
  addCourseIntentions(f);
  server.setHooks({
    delivery: "wait",
    onAsk() {
      teacherCalls++;
      throw new Error("Export woke teacher");
    },
    onFollowUp() {
      teacherCalls++;
      throw new Error("Export sent follow-up");
    },
    onReflect() {
      teacherCalls++;
      throw new Error("Export wrote reflection");
    },
    onQuizSubmit() {
      teacherCalls++;
      throw new Error("Export submitted quiz");
    },
  });
  const save = (name: string, value: unknown) =>
    fs.writeFileSync(path.join(out, name + ".json"), JSON.stringify(value, null, 2));
  try {
    const base = await server.start(0),
      before = hashes(f.root);
    await playwright(session, out, "open", base + "/c/course");
    opened = true;
    const captures = await playwrightCode(
      session,
      out,
      `async page=>{const shots=[];for(const [size,width,height] of [['desktop',1280,900],['mobile',390,844]])for(const theme of ['light','dark']){await page.setViewportSize({width,height});await page.evaluate(t=>localStorage.setItem('pi-classroom-theme',t),theme);await page.goto(${JSON.stringify(base + "/c/course")});await page.getByRole('link',{name:'Export',exact:true}).click();await page.getByRole('button',{name:'Download Anki deck',exact:true}).waitFor();await page.evaluate(()=>scrollTo(0,0));const file=${JSON.stringify(out)}+'/classroom-'+size+'-'+theme+'.png';await page.screenshot({path:file,fullPage:true});shots.push(file);if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Export overflows viewport');}return shots;}`,
    );
    const downloads = await playwrightCode(
      session,
      out,
      `async page=>{
   const errors=[];page.on('pageerror',e=>errors.push(e.message));const downloads=[];
   for(const classroom of ['rust','empty']){
    await page.goto(${JSON.stringify(base)}+'/c/'+classroom);const consent=page.getByRole('checkbox',{name:'Include answers already unlocked in Studens',exact:true});if(await consent.isChecked())throw new Error('Answers defaulted on');
    for(const [label,extension] of [['Download Anki deck','apkg'],['Download Markdown','md']]){
     const pending=page.waitForEvent('download');await page.getByRole('button',{name:label,exact:true}).click();const download=await pending;const file=${JSON.stringify(out)}+'/'+classroom+'.'+extension;await download.saveAs(file);if(await download.failure())throw new Error(await download.failure());downloads.push({classroom,file,suggested:download.suggestedFilename()});
    }
    const popupWait=page.waitForEvent('popup');await page.getByRole('button',{name:'Open printable classroom',exact:true}).click();const print=await popupWait;await print.waitForLoadState('networkidle');await print.getByRole('heading',{name:'Contents',exact:true}).waitFor();
    if(await print.locator('form,button,input,textarea,iframe').count())throw new Error('Print retained controls');
    const html=await print.content();if(/PRIVATE_|GATED_|UNLOCKED_EXPECTED|studens-course-map/.test(html))throw new Error('Print privacy leak');
    if(classroom==='rust') {await print.locator('.mermaid svg').waitFor();if(await print.locator('math').count()<2)throw new Error('Print lost math');await print.locator('nav a').first().click();if(!print.url().includes('#part-'))throw new Error('Print bookmark failed');}
    await print.emulateMedia({media:'print'});await print.pdf({path:${JSON.stringify(out)}+'/'+classroom+'.pdf',format:'A4',printBackground:true,outline:true});await print.screenshot({path:${JSON.stringify(out)}+'/'+classroom+'-print.png',fullPage:true});await print.close();
   }
   await page.goto(${JSON.stringify(base + "/c/rust")});await page.getByRole('checkbox',{name:'Include answers already unlocked in Studens',exact:true}).check();
   for(const [label,ext] of [['Download Markdown','md'],['Download Anki deck','apkg']]){const pending=page.waitForEvent('download');await page.getByRole('button',{name:label,exact:true}).click();const d=await pending;await d.saveAs(${JSON.stringify(out)}+'/rust-answers.'+ext);}
   await page.reload();if(await page.getByRole('checkbox',{name:'Include answers already unlocked in Studens',exact:true}).isChecked())throw new Error('Consent persisted after reload');
   if(errors.length)throw new Error(JSON.stringify(errors));return {downloads,errors,print:true,bookmarks:true,answersOffAfterReload:true};
  }`,
    );
    for (const name of ["rust", "empty"]) {
      const md = fs.readFileSync(path.join(out, name + ".md"), "utf8");
      if (/PRIVATE_|GATED_|UNLOCKED(?:\\_)?EXPECTED|studens-course-map/.test(md))
        throw new Error("Markdown privacy leak");
      fs.writeFileSync(
        path.join(out, name + "-markdown-render.html"),
        `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font:17px/1.5 sans-serif;padding:1rem;overflow-wrap:anywhere}img,svg{max-width:100%}pre{white-space:pre-wrap}</style>${renderMarkdown(md)}`,
      );
    }
    const answerMd = fs.readFileSync(path.join(out, "rust-answers.md"), "utf8");
    if (!answerMd.includes("UNLOCKED_EXPECTED") || /PRIVATE_|GATED_/.test(answerMd))
      throw new Error("Explicit answers missing or private answer leaked");
    const rendered = await playwrightCode(
      session,
      out,
      `async page=>{const results=[];for(const name of ['rust','empty']){await page.goto('file://'+${JSON.stringify(out)}+'/'+name+'-markdown-render.html');if(name==='rust'){await page.getByText('Saved learner note with Unicode 日本語.',{exact:true}).waitFor();await page.getByText('console.log(text < "z");',{exact:false}).waitFor();if(await page.locator('img').count()!==1)throw new Error('Markdown lost media');if(await page.locator('math').count()<2)throw new Error('Markdown lost formulas');}await page.screenshot({path:${JSON.stringify(out)}+'/'+name+'-markdown-render.png',fullPage:true});results.push({name,math:await page.locator('math').count(),images:await page.locator('img').count()});}return results;}`,
    );
    const ownerChecks = [];
    let projectionHash: string | undefined;
    for (const owner of ["pi", "claude", "codex"]) {
      const state = JSON.parse(fs.readFileSync(path.join(f.root, "rust/.teacher.json"), "utf8"));
      state.identity.backend = owner;
      f.write("rust/.teacher.json", JSON.stringify(state));
      const ownerBefore = hashes(f.root);
      const data = projectClassroom("rust", true, base)!;
      const digest = sha(JSON.stringify(data));
      if (projectionHash && digest !== projectionHash)
        throw new Error("Owner changed export content");
      projectionHash = digest;
      const r = await fetch(base + "/api/export?classroom=rust&format=markdown&answers=1");
      if (r.status !== 200) throw new Error("Owner export failed");
      if (JSON.stringify(ownerBefore) !== JSON.stringify(hashes(f.root)))
        throw new Error("Owner export wrote state");
      ownerChecks.push({ owner, status: r.status, projectionHash: digest, teacherCalls });
    }
    // Compare against the snapshot with only the deliberate private fixture owner change removed.
    const after = hashes(f.root);
    for (const file of new Set([...Object.keys(before), ...Object.keys(after)]))
      if (file !== "rust/.teacher.json" && before[file] !== after[file])
        throw new Error("Export wrote " + file);
    save("read-only", {
      before,
      after,
      allowedFixtureChanges: ["rust/.teacher.json"],
      teacherCalls,
      ownerChecks,
    });
    const privateProbes = [];
    for (const route of [
      "/c/rust/001-ownership/quiz/key.json",
      "/c/rust/.teacher.json",
      "/doc/rust/001-ownership/quiz/plan.json",
      "/api/export?classroom=rust%2f..%2fempty&format=anki",
      "/api/export?classroom=rust&format=anki&answers=all",
    ]) {
      const r = await fetch(base + route),
        body = await r.text();
      if (![400, 404].includes(r.status) || /PRIVATE_|GATED_/.test(body))
        throw new Error("Private probe leaked: " + route);
      privateProbes.push({ route, status: r.status });
    }
    const publicationFile = path.join(f.root, "rust/.lesson-requests.json"),
      publicationOriginal = fs.readFileSync(publicationFile, "utf8");
    const original = f.write("rust/.lesson-requests.json", "{PRIVATE_ERROR_CANARY");
    const failureBefore = hashes(f.root);
    const safeError = await playwrightCode(
      session,
      out,
      `async page=>{const response=await page.goto(${JSON.stringify(base + "/api/export?classroom=rust&format=print")});if(response.status()!==500)throw new Error('Malformed publication state did not fail');await page.getByRole('alert').filter({hasText:'invalid lesson or review publication state'}).waitFor();if((await page.content()).includes('PRIVATE_ERROR_CANARY'))throw new Error('Error disclosed private JSON');await page.screenshot({path:${JSON.stringify(out + "/export-error.png")},fullPage:true});return {status:response.status()};}`,
    );
    if (JSON.stringify(failureBefore) !== JSON.stringify(hashes(f.root)))
      throw new Error("Error read wrote state");
    fs.writeFileSync(original, publicationOriginal);
    await playwrightCode(
      session,
      out,
      `async page=>{await page.getByRole('link',{name:'Retry export',exact:true}).click();await page.getByRole('heading',{name:'Contents',exact:true}).waitFor();return {explicitRetry:true};}`,
    );
    // Probe a real symlink reachable through the same media/static routes.
    const leak = path.join(f.root, "rust/001-ownership/media/leak.png");
    fs.symlinkSync(path.join(f.root, "rust/001-ownership/quiz/key.png"), leak);
    const r = await fetch(base + "/c/rust/001-ownership/media/leak.png");
    if (r.status !== 404) throw new Error("Symlink media was served");
    privateProbes.push({ route: "/c/rust/001-ownership/media/leak.png", status: r.status });
    const adjacent = await playwrightCode(
      session,
      out,
      `async page=>{await page.goto(${JSON.stringify(base + "/c/course")});await page.getByRole('link',{name:'Course map',exact:true}).click();await page.getByRole('heading',{name:'Course map',exact:true}).waitFor();await page.goto(${JSON.stringify(base + "/c/rust/001-ownership")});await page.waitForFunction(()=>document.querySelector('[data-quiz-id="check"]')?.dataset.state==='graded');await page.getByRole('heading',{name:'Ownership café λ',exact:true}).waitFor();return {courseNavigation:true,savedQuiz:'graded'};}`,
    );
    const source = projectClassroom("rust", false, base)!;
    const sourceLinks = [];
    for (const part of source.parts) {
      const response = await fetch(part.source);
      if (response.status !== 200) throw new Error("Public source link failed: " + part.source);
      sourceLinks.push({ source: part.source, status: response.status });
    }
    save("source-links", sourceLinks);
    save("projection", source);
    save("projection-answers", projectClassroom("rust", true, base));
    // Save independent updated/removed snapshots for official core update semantics.
    const note = path.join(f.root, "rust/notes/ownership.md");
    fs.appendFileSync(note, "\nEdited saved note — UPDATED_NOTE.\n");
    const future = new Date(Date.now() + 10_000);
    fs.utimesSync(note, future, future);
    fs.writeFileSync(
      path.join(out, "rust-edited.apkg"),
      exportAnki(projectClassroom("rust", false, base)!),
    );
    fs.unlinkSync(note);
    fs.writeFileSync(
      path.join(out, "rust-removed.apkg"),
      exportAnki(projectClassroom("rust", false, base)!),
    );
    // Grade the saved diagnostic explicitly in fixture state; export itself never submits it.
    const pretest = store.createSubmission({
      classroom: "rust",
      lesson: "002-gated",
      quizId: "pretest",
      quizTitle: "Diagnostic",
      kind: "pretest",
      answers: [termAnswer("q", "prediction")],
    });
    applyGrade(pretest, {
      score: 0,
      feedbackMarkdown: "Diagnostic saved.",
      questions: [{ questionId: "q", correct: false, feedback: "Diagnostic only." }],
    });
    const released = projectClassroom("rust", false, base)!;
    if (!released.parts.some((p) => p.html.includes("GATED_TEACHING_CANARY")))
      throw new Error("Graded pretest did not release saved teaching");
    if (teacherCalls !== 0) throw new Error("Export invoked teacher");
    save("result", {
      captures,
      downloads,
      rendered,
      ownerChecks,
      privateProbes,
      safeError,
      adjacent,
      teacherCalls,
      pretestGateRelease: true,
      verificationLimit:
        "Fixture owners exercise shared HTTP/store boundary; no model inference. Official importer is a separate acceptance check.",
    });
  } catch (error) {
    save("failure", { error: String(error), stack: (error as Error).stack });
    if (opened) {
      fs.writeFileSync(
        path.join(out, "failure-snapshot.txt"),
        await playwright(session, out, "snapshot"),
      );
      await playwright(session, out, "screenshot", `--filename=${path.join(out, "failure.png")}`);
    }
    throw error;
  } finally {
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

/** Render card HTML returned by official Anki core, including its imported public media. */
export async function verifyImportedCardBrowser(out: string): Promise<void> {
  const http = await import("node:http"),
    assets = path.join(out, "rendered-card"),
    files = new Set(fs.readdirSync(assets)),
    session = `studens-export-card-${process.pid}`;
  const listener = http.createServer((req, res) => {
    if (req.url === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }
    const name = (req.url ?? "").slice(1);
    if (!files.has(name)) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.setHeader(
      "Content-Type",
      name.endsWith(".js")
        ? "application/javascript"
        : name.endsWith(".png")
          ? "image/png"
          : name.endsWith(".svg")
            ? "image/svg+xml"
            : "text/html; charset=utf-8",
    );
    res.end(fs.readFileSync(path.join(assets, name)));
  });
  await new Promise<void>((r) => listener.listen(0, "127.0.0.1", r));
  const port = (listener.address() as import("node:net").AddressInfo).port;
  let opened = false;
  try {
    await playwright(session, out, "open", `http://127.0.0.1:${port}/card.html`);
    opened = true;
    const report = await playwrightCode(
      session,
      out,
      String.raw`async page=>{
   await page.locator('.mermaid svg').waitFor();if(await page.locator('math').count()!==2)throw new Error('Imported card lost math');await page.getByText('console.log(text < "z");',{exact:false}).waitFor();const image=await page.locator('img').evaluate(n=>({complete:n.complete,width:n.naturalWidth}));if(!image.complete||image.width!==1)throw new Error('Imported public media did not render');const source=await page.getByRole('link',{name:/http:\/\/127/}).last().getAttribute('href');if(!/127\.0\.0\.1:\d+/.test(source))throw new Error('Source link lost port');await page.screenshot({path:${JSON.stringify(path.join(out, "imported-card.png"))},fullPage:true});return {diagrams:await page.locator('.mermaid svg').count(),math:await page.locator('math').count(),image,source,scope:'Actual official imported card.answer HTML rendered in Chromium; no desktop Anki UI.'};
  }`,
    );
    fs.writeFileSync(path.join(out, "card-browser-report.json"), JSON.stringify(report, null, 2));
  } finally {
    if (opened) await playwright(session, out, "close");
    await new Promise<void>((r) => listener.close(() => r()));
  }
}
