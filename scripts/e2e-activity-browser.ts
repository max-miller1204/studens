/** Fixture teachers prove the public projection, durable state, SSE and owning retries. */
import * as fs from "node:fs";
import * as path from "node:path";
import { makeFixture, seedClassroom, lessonHtml } from "../test/helpers.ts";
import * as server from "../src/server.ts";
import { TeacherService } from "../src/teacher-service.ts";
import { readTeacherState } from "../src/service-state.ts";
import type { TeacherPlan } from "../src/teacher.ts";
import { highlightText } from "./browser-actions.ts";
import { playwright, playwrightCode } from "./playwright.ts";

export async function verifyActivityBrowser(artifacts: string | null): Promise<void> {
  const f = makeFixture();
  seedClassroom(f);
  seedClassroom(f, { lesson: "002-borrowing" });
  seedClassroom(f, { classroom: "other" });
  for (const lesson of ["001-ownership", "002-borrowing"])
    f.write(
      `rust/${lesson}/lesson.html`,
      lessonHtml(
        "Ownership",
        `<h1>Ownership</h1><p>Every value has one owner.</p><form class="cl-reflect" data-reflect-id="ownership"><p class="cl-reflect-prompt">Explain the owner.</p><textarea></textarea></form>`,
      ),
    );
  f.write("rust/NOTES.md", "# Ownership notes\n\nTrace the owner.");
  f.write(
    "rust/reference/ownership.html",
    lessonHtml(
      "Ownership reference",
      "<h1>Ownership reference</h1><p>A move transfers ownership.</p>",
    ),
  );
  const turns: Array<{ resolve: (plan: TeacherPlan) => void; reject: (error: Error) => void }> = [];
  let teacher = new TeacherService(
    async (_identity, _prompt, _cwd, _save, signal) =>
      new Promise<TeacherPlan>((resolve, reject) => {
        turns.push({ resolve, reject });
        signal?.addEventListener("abort", () => reject(new Error("Fixture teacher interrupted.")), {
          once: true,
        });
      }),
  );
  teacher.connect();
  teacher.attach("rust", "codex");
  teacher.attach("other", "codex");
  const session = `studens-activity-${process.pid}`;
  const result: Record<string, unknown> = {};
  const code = (body: string) => playwrightCode(session, f.root, `async page => {${body}}`);
  const save = async (name: string) => {
    if (artifacts)
      await code(
        `await page.screenshot({path:${JSON.stringify(path.join(artifacts, name + ".png"))}});return {};`,
      );
  };
  const snapshot = () => readTeacherState("rust");
  const plan = {
    calls: [],
    message: "Trace which binding owns the value.",
    learning_record: "",
    notes_markdown: "",
  };
  let browserOpen = false;
  if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
  try {
    let base = await server.start(0);
    await playwright(session, f.root, "open", `${base}/c/rust/001-ownership`);
    browserOpen = true;
    await code(
      `await page.setViewportSize({width:1280,height:800});await page.locator('form.cl-reflect textarea').fill('The owner drops its value.');await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.cl-teacher-activity')?.dataset.state==='running');return {};`,
    );
    await save("running-lesson");
    result.running = snapshot();
    await code(
      `await page.goto(${JSON.stringify(base + "/c/rust/002-borrowing")});await page.locator('form.cl-reflect textarea').fill('A borrow does not own it.');await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.cl-teacher-activity')?.textContent.includes('1 queued'));await page.goto(${JSON.stringify(base + "/c/rust")});await page.waitForFunction(()=>document.querySelector('.cl-teacher-activity')?.textContent.includes('1 queued'));await page.locator('.cl-teacher-activity summary').click();return {};`,
    );
    result.queued = snapshot();
    if (Number(turns.length) !== 1 || snapshot()!.requests[1].status !== "queued")
      throw new Error("Teacher requests did not remain sequential.");
    await save("running-queued-classroom");
    turns[0].reject(
      new Error("Fixture teacher rejected this explanation: missing ownership context."),
    );
    await code(
      `await page.waitForFunction(()=>document.querySelector('.cl-teacher-activity')?.textContent.includes('missing ownership context'));return {};`,
    );
    if (Number(turns.length) !== 2) throw new Error("The next queued turn did not start.");
    turns[1].resolve(plan);
    await teacher.idle();
    await code(
      `await page.waitForFunction(()=>document.querySelector('.cl-teacher-activity')?.dataset.state==='failed');await page.reload();await page.waitForFunction(()=>document.querySelector('.cl-teacher-activity')?.dataset.state==='failed');return {};`,
    );
    result.failure = snapshot();
    await save("failed-desktop");
    await code(`await page.setViewportSize({width:375,height:812});return {};`);
    await save("failed-mobile");
    await code(`await page.evaluate(()=>document.documentElement.dataset.theme='dark');return {};`);
    await save("failed-mobile-dark");
    await code(`await page.setViewportSize({width:1280,height:800});return {};`);
    await save("failed-desktop-dark");
    await code(
      `await page.setViewportSize({width:375,height:812});await page.evaluate(()=>document.documentElement.dataset.theme='light');return {};`,
    );
    // Hold a status response across disconnect/reconnect. It must never restore stale work.
    await code(
      `await page.route('**/api/activity?classroom=rust', async route=>{page.__activityHeld=route;},{times:1});return {};`,
    );
    server.pushEvent("rust", "001-ownership", "teacher", {});
    await code(
      `for(let i=0;!page.__activityHeld && i<500;i++)await new Promise(r=>setTimeout(r,10));if(!page.__activityHeld)throw new Error('Activity response was not intercepted');return {};`,
    );
    // Stop the actual owned HTTP server; its SSE stream must stop claiming old status.
    await server.close();
    await code(
      `await page.getByRole('button',{name:'Retry activity status',exact:true}).waitFor();return {};`,
    );
    await save("disconnected-mobile");
    await teacher.stop();
    const failedCards = new Set<string>();
    teacher = new TeacherService(async () => {
      turns.push({ resolve() {}, reject() {} });
      const r = snapshot()!.requests.find((r) => r.status === "running")!;
      if (r.kind === "ask" || r.kind === "follow-up") {
        if (!failedCards.has(r.id)) {
          failedCards.add(r.id);
          throw new Error(`Fixture ${r.kind} answer unavailable. Explicit retry required.`);
        }
        return {
          ...plan,
          calls: [
            {
              name: "answer_lesson_question",
              arguments_json: JSON.stringify({
                annotation_id: r.target,
                answer_markdown:
                  r.kind === "ask" ? "One owner controls release." : "A move transfers the owner.",
              }),
            },
          ],
        };
      }
      return plan;
    });
    teacher.connect();
    teacher.restore();
    await teacher.idle();
    base = await server.start(Number(new URL(base).port));
    result.restart = await code(
      `await page.getByRole('button',{name:'Retry activity status',exact:true}).click();await page.__activityHeld.fulfill({json:{requests:[{id:'stale',classroom:'rust',kind:'quiz',status:'running',url:'/c/rust/001-ownership',item:'STALE RESPONSE',retry:'teacher',retryId:'stale'}]}});await page.waitForFunction(()=>document.querySelector('.cl-teacher-activity')?.dataset.state==='failed');if((await page.locator('.cl-teacher-activity').textContent()).includes('STALE RESPONSE'))throw new Error('Stale response replaced current activity');return {status:await page.locator('.cl-teacher-activity').textContent()};`,
    );
    if (Number(turns.length) !== 2) throw new Error("Reload or restart retried failed work.");
    const navigation = [];
    for (const route of [
      "/doc/rust/NOTES.md",
      "/r/rust/ownership.html",
      "/c/rust/reviews",
      "/doc/rust/learning-records",
      "/c/rust/course-map",
      "/c/rust/settings",
      "/",
      "/reviews/daily",
      "/c/rust",
    ]) {
      navigation.push(
        await code(
          `await page.goto(${JSON.stringify(base)}+${JSON.stringify(route)});await page.waitForFunction(()=>document.querySelector('.cl-teacher-activity')?.dataset.state==='failed');return {url:page.url(),regions:await page.getByRole('region',{name:'Teacher activity',exact:true}).count()};`,
        ),
      );
    }
    result.navigation = navigation;
    if (Number(turns.length) !== 2) throw new Error("Page navigation retried failed work.");
    // Follow the owning item with keyboard, keeping the conversation on the lesson.
    result.link = await code(
      `const link=page.locator('.cl-teacher-activity a').first();await link.focus();await page.keyboard.press('Enter');await page.waitForURL('**/001-ownership#cl-teacher');await page.waitForFunction(()=>!!document.querySelector('#cl-teacher'));return {url:page.url(),panel:await page.locator('#cl-teacher').count() > 0};`,
    );
    await save("failed-item-mobile");
    result.retry = await code(
      `let retries=0;page.on('request',r=>{if(r.url().endsWith('/api/teacher/retry'))retries++;});await page.locator('.cl-teacher-activity').getByRole('button',{name:/^Retry activity:/}).click();await page.waitForFunction(()=>document.querySelector('.cl-teacher-activity')?.dataset.state==='idle');await page.reload();await page.waitForFunction(()=>document.querySelector('.cl-teacher-activity')?.dataset.state==='idle');return {retries};`,
    );
    await teacher.idle();
    if (Number(turns.length) !== 3 || (result.retry as { retries: number }).retries !== 1)
      throw new Error("Explicit retry duplicated teacher work.");
    result.done = snapshot();
    await save("done-mobile");
    await code(
      `await (${highlightText.toString()})(page, 'main > p', 'one owner');await page.locator('.cl-ask-pill').click();await page.locator('[data-cl-question]').fill('Who releases this value?');await page.getByRole('button',{name:'Ask your teacher',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.cl-teacher-activity')?.textContent.includes('Fixture ask answer unavailable'));await page.reload();await page.waitForFunction(()=>document.querySelector('.cl-teacher-activity')?.dataset.state==='failed');return {};`,
    );
    result.askFailure = snapshot();
    await save("ask-failed-mobile");
    await code(
      `await page.locator('.cl-teacher-activity').getByRole('button',{name:/^Retry activity:/}).click();await page.locator('.cl-card-thread').getByText('One owner controls release.',{exact:true}).waitFor();await page.locator('[data-cl-followup]').fill('What about a move?');await page.locator('[data-cl-followup-form]').getByRole('button',{name:'Ask',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.cl-teacher-activity')?.textContent.includes('Fixture follow-up answer unavailable'));await page.reload();await page.waitForFunction(()=>document.querySelector('.cl-teacher-activity')?.dataset.state==='failed');return {};`,
    );
    result.followUpFailure = snapshot();
    await save("follow-up-failed-mobile");
    await code(
      `const link=page.locator('.cl-teacher-activity a').first();await link.click();await page.locator('.cl-teacher-activity').getByRole('button',{name:/^Retry activity:/}).click();await page.locator('.cl-card-thread').getByText('A move transfers the owner.',{exact:true}).waitFor();await page.reload();await page.waitForFunction(()=>document.querySelector('.cl-teacher-activity')?.dataset.state==='idle');return {};`,
    );
    await teacher.idle();
    result.cardDone = snapshot();
    if (Number(turns.length) !== 7 || !snapshot()!.requests.every((r) => r.status === "done"))
      throw new Error("Card retries duplicated or lost teacher work");
    await code(
      `await page.goto(${JSON.stringify(base + "/c/other")});await page.waitForFunction(()=>document.querySelector('.cl-teacher-activity')?.dataset.state==='idle');return {};`,
    );
    result.isolation = readTeacherState("other");
    // A malformed projection must show an error rather than silently omit work.
    server.setHooks({
      delivery: "service",
      onAsk() {},
      onFollowUp() {},
      onQuizSubmit() {},
      onReflect() {},
      teacherState: () => ({
        requests: [{ id: "stale", lesson: "001-ownership", kind: "quiz", status: "unknown" }],
      }),
    });
    server.pushEvent("other", "001-ownership", "teacher", {});
    await code(
      `await page.waitForFunction(()=>document.querySelector('.cl-teacher-activity')?.textContent.includes('Invalid teacher activity request'));return {};`,
    );
    await save("malformed-mobile");
    teacher.connect();
    await code(
      `await page.getByRole('button',{name:'Retry activity status',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.cl-teacher-activity')?.dataset.state==='idle');return {};`,
    );
    await code(
      `await page.goto(${JSON.stringify(base + "/c/rust")});await page.waitForFunction(()=>document.querySelector('.cl-teacher-activity')?.dataset.state==='idle');return {};`,
    );
    const privateFile = path.join(f.root, "rust/.lesson-requests.json");
    const oldPrivate = fs.existsSync(privateFile) ? fs.readFileSync(privateFile) : null;
    const secret = "SECRET_ACTIVITY_CANARY_PRIVATE_DOCUMENT";
    fs.writeFileSync(privateFile, secret);
    server.pushEvent("rust", "001-ownership", "teacher", {});
    result.privateReadFailure = await code(
      `await page.getByRole('button',{name:'Retry activity status',exact:true}).waitFor();const text=await page.locator('.cl-teacher-activity').innerText();if(!text.includes('malformed JSON') || text.includes('SECRET_ACT'))throw new Error('Private parse failure leaked or lost its category');for(const scope of ['classroom=rust','scope=root']){const r=await page.request.get(${JSON.stringify(base)}+'/api/activity?'+scope);if(r.status()!==500 || (await r.text()).includes('SECRET_ACT'))throw new Error('Private parse response leaked');}return {text};`,
    );
    await save("private-state-error-mobile");
    if (fs.readFileSync(privateFile, "utf8") !== secret)
      throw new Error("Reading activity changed corrupt private state");
    if (oldPrivate) fs.writeFileSync(privateFile, oldPrivate);
    else fs.unlinkSync(privateFile);
    server.pushEvent("rust", "001-ownership", "teacher", {});
    await code(
      `await page.waitForTimeout(250);if(await page.locator('.cl-teacher-activity').getAttribute('data-state')!=='unavailable')throw new Error('Corrupt state recovered without explicit status retry');await page.getByRole('button',{name:'Retry activity status',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.cl-teacher-activity')?.dataset.state==='idle');return {};`,
    );
    for (const suffix of [".teacher.json", "001-ownership/quiz/key.json", ".review-refills.json"]) {
      const response = await fetch(`${base}/c/rust/${suffix}`);
      if (response.status !== 404)
        throw new Error(`Private route returned ${response.status}: ${suffix}`);
    }
    result.turns = turns.length;
    console.log(
      "PASS: classroom activity SSE, sequential queue, failure, navigation, reload, restart, explicit retry, keyboard links, isolation, malformed state and privacy",
    );
  } finally {
    if (artifacts)
      fs.writeFileSync(path.join(artifacts, "result.json"), JSON.stringify(result, null, 2));
    if (browserOpen) await playwright(session, f.root, "close");
    await teacher.stop();
    await server.close();
    f.cleanup();
  }
}
