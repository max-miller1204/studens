/** Drive the learner course map through its real HTTP entry, without model substitutions. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { makeFixture } from "../test/helpers.ts";
import { seedCourse, addCourseIntentions } from "../test/course-map-fixture.ts";
import { applyGrade } from "../src/quiz-grading.ts";
import * as server from "../src/server.ts";
import * as store from "../src/store.ts";
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
      }),
  );
}
export async function verifyCourseMapBrowser(artifacts: string | null): Promise<void> {
  const f = makeFixture(),
    session = `studens-course-map-${process.pid}`;
  const out = artifacts ?? fs.mkdtempSync(path.join(os.tmpdir(), "studens-course-map-evidence-"));
  fs.mkdirSync(out, { recursive: true });
  seedCourse(f);
  addCourseIntentions(f);
  let opened = false,
    submissions = 0;
  const assertReadOnly = (before: Record<string, string>, label: string) => {
    const after = hashes(f.root);
    fs.writeFileSync(
      path.join(out, label + "-hashes.json"),
      JSON.stringify(
        { before, after, equal: JSON.stringify(before) === JSON.stringify(after) },
        null,
        2,
      ),
    );
    if (JSON.stringify(before) !== JSON.stringify(after))
      throw new Error(`${label}: viewing wrote classroom state.`);
  };
  server.setHooks({
    delivery: "wait",
    onAsk() {
      throw new Error("Map woke teacher.");
    },
    onFollowUp() {
      throw new Error("Map sent a follow-up.");
    },
    onReflect() {
      throw new Error("Map saved a reflection.");
    },
    onQuizSubmit(submission) {
      submissions++;
      applyGrade(submission, {
        score: 0,
        feedbackMarkdown: "Diagnostic only; teaching is now available.",
        questions: [{ questionId: "q1", correct: false, feedback: "Read the released lesson." }],
      });
    },
  });
  try {
    const base = await server.start(0),
      before = hashes(f.root);
    await playwright(session, out, "open", base + "/c/course");
    opened = true;
    const result = await playwrightCode(
      session,
      out,
      `async page=>{
      const errors=[],writes=[]; page.on('pageerror',error=>errors.push(error.message));
      page.on('request',request=>{if(!['GET','HEAD'].includes(request.method())) writes.push({method:request.method(),url:request.url()});});
      await page.getByRole('link',{name:'Course map',exact:true}).focus(); await page.keyboard.press('Enter');
      await page.getByRole('heading',{name:'Course map',exact:true}).waitFor();
      const check=async()=>{
        const html=await page.content();
        if(['PRIVATE_','HIDDEN_','teach-borrow','002-borrow/@objective'].some(value=>html.includes(value))) throw new Error('Map disclosed private or gated content.');
        if(await page.locator('.cl-map-objective[id="001-values/@objective/ownership"] .cl-map-connections li').count()!==2) throw new Error('Multiple quizzes lost their shared objective.');
        if(await page.locator('.cl-map-edges li').count()!==2) throw new Error('Explicit links missing or gated link leaked.');
        await page.getByText('Design ownership boundaries for a small CLI.',{exact:true}).first().waitFor();
        await page.getByText('builds on',{exact:true}).waitFor();
        if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) throw new Error('Course map overflows viewport.');
      };
      await check();
      const shots=[];
      for(const [size,width,height] of [['desktop',1280,900],['mobile',390,844]]) for(const theme of ['light','dark']) {
        await page.setViewportSize({width,height}); await page.evaluate(t=>localStorage.setItem('pi-classroom-theme',t),theme);
        for(const [screen,route] of [['classroom','/c/course'],['map','/c/course/course-map'],['mission','/doc/course/MISSION.md']]) {
          const response=await page.goto(${JSON.stringify(base)}+route); if(response.status()!==200) throw new Error('Capture route failed.');
          await page.evaluate(()=>window.scrollTo(0,0)); if(screen==='map') await check();
          const file=${JSON.stringify(out)}+'/'+screen+'-'+size+'-'+theme+'.png'; await page.screenshot({path:file,fullPage:true}); shots.push({file,width,height,theme,status:response.status()});
        }
      }
      await page.getByRole('link',{name:'Practical Rust',exact:true}).click();
      await page.getByRole('link',{name:'Course map',exact:true}).click();
      await page.getByRole('link',{name:'Values and ownership',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('[data-quiz-id="check-1"]')?.dataset.state==='fresh');
      await page.goBack(); await page.getByRole('heading',{name:'Course map',exact:true}).waitFor();
      await page.getByRole('link',{name:'Read mission document',exact:true}).click();
      const documentContent=await page.content();
      if(['studens-course-map','002-borrow/@objective','"connections"'].some(value=>(documentContent).includes(value))) throw new Error('Mission document exposed course metadata.');
      await page.goBack();
      await page.getByRole('link',{name:'← Back to classroom',exact:true}).click();
      await page.getByRole('heading',{name:'Practical Rust',exact:true}).waitFor();
      await page.goto(${JSON.stringify(base + "/c/empty/course-map")});
      await page.getByText('No lessons yet.',{exact:false}).waitFor();
      await page.getByText('No mission has been recorded yet.',{exact:false}).waitFor();
      await page.screenshot({path:${JSON.stringify(path.join(out, "empty-mobile-dark.png"))},fullPage:true});
      if(errors.length || writes.length) throw new Error(JSON.stringify({errors,writes}));
      return {shots,errors,writes,keyboardEntry:true,lessonNavigation:true,missionDocument:true,empty:true};
    }`,
    );
    assertReadOnly(before, "viewing");
    const planFile = path.join(f.root, "course/001-values/quiz/plan.json"),
      original = fs.readFileSync(planFile, "utf8");
    f.write("course/001-values/quiz/plan.json", "{PRIVATE_INVALID_PLAN");
    const corruptHashes = hashes(f.root);
    await playwrightCode(
      session,
      out,
      `async page=>{
      const response=await page.goto(${JSON.stringify(base + "/c/course/course-map")});
      if(response.status()!==500) throw new Error('Corrupt plan did not fail.');
      await page.getByRole('alert').filter({hasText:'001-values/quiz/plan.json: invalid JSON'}).waitFor();
      if((await page.content()).includes('PRIVATE_INVALID_PLAN')) throw new Error('Error exposed invalid JSON.');
      await page.screenshot({path:${JSON.stringify(path.join(out, "plan-error-mobile-dark.png"))},fullPage:true});
      return {status:response.status()};
    }`,
    );
    assertReadOnly(corruptHashes, "error-viewing");
    f.write("course/001-values/quiz/plan.json", original);
    await playwrightCode(
      session,
      out,
      `async page=>{
      await page.getByRole('heading',{name:'Cannot load course map',exact:true}).waitFor();
      await page.getByRole('link',{name:'Retry loading course map',exact:true}).click();
      await page.getByRole('heading',{name:'Course map',exact:true}).waitFor(); return {explicitRetry:true};
    }`,
    );
    const mission = fs.readFileSync(path.join(f.root, "course/MISSION.md"), "utf8");
    f.write("course/MISSION.md", "I want to debug a CLI with my team. No structured plan yet.");
    const legacy = hashes(f.root);
    await playwrightCode(
      session,
      out,
      `async page=>{
      await page.reload(); await page.getByText('I want to debug a CLI with my team. No structured plan yet.',{exact:true}).waitFor();
      await page.getByText('No upcoming objectives have been recorded.',{exact:false}).waitFor();
      if(await page.locator('.cl-map-edges li').count()) throw new Error('Legacy prose invented connections.');
      await page.screenshot({path:${JSON.stringify(path.join(out, "legacy-mobile-dark.png"))},fullPage:true}); return {legacy:true};
    }`,
    );
    assertReadOnly(legacy, "legacy-viewing");
    f.write("course/MISSION.md", mission);
    const metadata = mission
      .slice(mission.indexOf("```studens-course-map") + "```studens-course-map\n".length)
      .split("```")[0];
    f.write(
      "course/MISSION.md",
      "# Mission\n\n## Why\n\nLearn Rust.\n~~~studens-course-map\n" + metadata + "~~~\n",
    );
    const summaryBefore = hashes(f.root);
    const summaries = await playwrightCode(
      session,
      out,
      `async page=>{
      const routes=['/','/c/course','/doc/course/MISSION.md','/c/course/course-map']; const results=[];
      for(const route of routes) {
        const response=await page.goto(${JSON.stringify(base)}+route);
        const html=await page.content();
        if(response.status()!==200 || ['studens-course-map','002-borrow/@objective','HIDDEN_','PRIVATE_'].some(value=>html.includes(value))) throw new Error('Public mission projection leaked: '+route);
        await page.getByText('Learn Rust.',{exact:true}).waitFor(); results.push({route,status:response.status(),metadataHidden:true});
      }
      await page.screenshot({path:${JSON.stringify(path.join(out, "summary-privacy-mobile-dark.png"))},fullPage:true}); return results;
    }`,
    );
    assertReadOnly(summaryBefore, "summary-viewing");
    f.write("course/MISSION.md", mission);
    const formulas = String.raw`Inline $x^2$ and \(z+1\).

$$y=mx+b$$

Invalid \(\frac{a\).
`;
    f.write("course/MISSION.md", mission + "\n" + formulas);
    const mathBefore = hashes(f.root);
    const math = await playwrightCode(
      session,
      out,
      `async page=>{
      const results=[];
      for(const [screen,route,heading] of [['mission','/doc/course/MISSION.md','h1'],['map','/c/course/course-map','h3']]) {
        const response=await page.goto(${JSON.stringify(base)}+route);
        if(response.status()!==200) throw new Error('Mission math route failed.');
        if(await page.locator('math').count()!==3 || await page.locator('math[display="block"]').count()!==1) throw new Error('Canonical inline/display math missing.');
        await page.getByText('Math did not render',{exact:true}).waitFor();
        await page.getByText(/Unexpected end of input in a macro argument/).waitFor();
        await page.locator(heading).filter({hasText:/^Mission: Build a dependable CLI$/}).waitFor();
        const documentValue=await page.content();
        if(['studens-course-map','002-borrow/@objective','HIDDEN_','PRIVATE_'].some(value=>documentValue.includes(value))) throw new Error('Mission math projection leaked metadata.');
        for(const [size,width,height] of [['desktop',1280,900],['mobile',390,844]]) for(const theme of ['light','dark']) {
          await page.setViewportSize({width,height}); await page.evaluate(t=>localStorage.setItem('pi-classroom-theme',t),theme); await page.reload();
          if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) throw new Error('Mission math overflows viewport.');
          await page.screenshot({path:${JSON.stringify(out)}+'/math-'+screen+'-'+size+'-'+theme+'.png',fullPage:true});
        }
        results.push({route,inline:2,display:1,invalidFormulaVisible:true,heading,metadataHidden:true});
      }
      return results;
    }`,
    );
    assertReadOnly(mathBefore, "math-viewing");
    f.write("course/MISSION.md", mission);
    // Real file error and explicit retry for structured mission validation.
    f.write(
      "course/MISSION.md",
      mission.replace("001-values/@objective/ownership", "001-values/@objective/stale"),
    );
    await playwrightCode(
      session,
      out,
      `async page=>{
      const response=await page.reload(); if(response.status()!==500) throw new Error('Stale relationship did not fail.');
      await page.getByRole('alert').filter({hasText:'Connection 1 names an unknown or unpublished objective'}).waitFor();
      await page.screenshot({path:${JSON.stringify(path.join(out, "mission-error-mobile-dark.png"))},fullPage:true}); return {staleReferenceError:true};
    }`,
    );
    f.write("course/MISSION.md", mission);
    await playwrightCode(
      session,
      out,
      `async page=>{await page.getByRole('link',{name:'Retry loading course map',exact:true}).click(); await page.getByRole('heading',{name:'Course map',exact:true}).waitFor(); return {recovered:true};}`,
    );
    const privateFile = path.join(f.root, "course/001-values/quiz/plan.json");
    for (const relative of ["course/001-values/media/leak.json", "course/assets/leak.json"]) {
      const file = path.join(f.root, relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.symlinkSync(privateFile, file);
    }
    const probes = [];
    for (const route of [
      "/c/course/001-values/quiz/plan.json",
      "/c/course/001-values/quiz/key.json",
      "/c/course/001-values/media/leak.json",
      "/c/course/assets/leak.json",
      "/doc/course/001-values/quiz/plan.json",
      "/c/course/.teacher.json",
      "/api/course-map?classroom=course",
      "/static/quiz/plan.json",
      "/c/course%2f..%2fempty/course-map",
      "/c/course/course-map/quiz/plan.json",
    ]) {
      const response = await fetch(base + route),
        body = await response.text();
      probes.push({ route, status: response.status, privateLeak: /PRIVATE_|HIDDEN_/.test(body) });
      if (response.status !== 404 || /PRIVATE_|HIDDEN_/.test(body))
        throw new Error("Forbidden route leaked: " + route);
    }
    const beforePretest = hashes(f.root);
    const pretest = await playwrightCode(
      session,
      out,
      `async page=>{
      await page.getByRole('link',{name:'Borrowing',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('[data-quiz-id="pretest-1"]')?.dataset.state==='fresh');
      if((await page.content()).includes('HIDDEN_TEACHING')) throw new Error('Teaching exposed before pretest.');
      await page.locator('[data-quiz-id="pretest-1"] textarea').fill('I predict a conflict.');
      await page.getByRole('button',{name:'Submit for grading',exact:true}).click();
      await page.getByText('HIDDEN_TEACHING',{exact:true}).waitFor();
      await page.goto(${JSON.stringify(base + "/c/course/course-map")});
      await page.locator('[id="002-borrow/@objective/ownership"]').waitFor();
      if(await page.locator('.cl-map-edges li').count()!==3) throw new Error('Released explicit link missing.');
      await page.reload(); if(await page.locator('.cl-map-edges li').count()!==3) throw new Error('Released connection did not survive reload.');
      await page.screenshot({path:${JSON.stringify(path.join(out, "released-mobile-dark.png"))},fullPage:true});
      return {teachingReleased:true,connections:3};
    }`,
    );
    const afterPretest = hashes(f.root);
    if (
      submissions !== 1 ||
      store.listSubmissions("course", "002-borrow").length !== 1 ||
      store.latestGrades("course", "002-borrow").length !== 1
    )
      throw new Error("Pretest did not save exactly one submission and grade.");
    const viewingAfter = hashes(f.root);
    await playwrightCode(
      session,
      out,
      `async page=>{ await page.reload(); return {reload:true}; }`,
    );
    assertReadOnly(viewingAfter, "released-viewing");
    fs.writeFileSync(
      path.join(out, "result.json"),
      JSON.stringify(
        { result, probes, summaries, math, pretest, submissions, beforePretest, afterPretest },
        null,
        2,
      ),
    );
    console.log(
      "PASS: course map, explicit upcoming/connections, legacy/empty, keyboard/navigation, themes/mobile, corruption/retry, pretest redaction/release, privacy and read-only state.",
    );
  } catch (error) {
    fs.writeFileSync(
      path.join(out, "failure.json"),
      JSON.stringify({ error: String(error) }, null, 2),
    );
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
