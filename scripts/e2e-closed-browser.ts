/** Submit a closed pretest through real controls, then inspect durable grades and reload. */
import * as fs from "node:fs";
import * as path from "node:path";
import { makeFixture, seedClassroom, lessonHtml } from "../test/helpers.ts";
import * as server from "../src/server.ts";
import * as store from "../src/store.ts";
import { playwright, playwrightCode } from "./playwright.ts";

export async function verifyClosedBrowser(artifacts: string | null): Promise<void> {
  const fixture = makeFixture();
  seedClassroom(fixture);
  if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
  const session = `studens-closed-${process.pid}`;
  const criteria = (expected: unknown, points: number, extra = {}) => ({
    expected,
    points,
    full: "Matches the key.",
    partial: "None.",
    ...extra,
  });
  const contract = fs.readFileSync(
    new URL("../assets/templates/quiz.html", import.meta.url),
    "utf8",
  );
  const quiz = contract
    .slice(
      contract.indexOf('<form class="cl-quiz" data-quiz-id="check-1" data-title='),
      contract.indexOf("</form>") + 7,
    )
    .replace(/\s*<li class="cl-q" data-question-id="q[45]"[\s\S]*?<\/li>/g, "")
    .replace('data-title="Check on learning"', 'data-title="Closed pretest" data-kind="pretest"');
  fixture.write(
    "rust/001-ownership/lesson.json",
    JSON.stringify({ title: "Instant quiz", assessmentContract: 1 }),
  );
  fixture.write(
    "rust/001-ownership/lesson.html",
    lessonHtml(
      "Instant quiz",
      quiz +
        '<template data-cl-after-pretest="check-1"><p data-released>Teaching released after grading.</p></template>',
    ),
  );
  fixture.write(
    "rust/001-ownership/quiz/key.json",
    JSON.stringify({
      "check-1": {
        q1: criteria("a", 2),
        q2: criteria(["a", "b"], 2),
        q3: criteria(["lifetime"], 1, { grading: "exact" }),
        q6: criteria({ value: 4, tolerance: 0.1, unit: "bytes" }, 2),
        q7: criteria({ b1: ["owner", "holder"], b2: "scope" }, 2),
        q8: criteria(["bind", "scope", "drop"], 3),
        q9: criteria({ move: "r3", borrow: "r1", clone: "r2" }, 3),
        q10: criteria(["s3"], 1, { grading: "exact" }),
      },
    }),
  );
  let turns = 0,
    opened = false;
  server.setHooks({
    onAsk: () => {},
    onFollowUp: () => {},
    onReflect: () => {},
    onQuizSubmit: () => {
      turns++;
    },
  });
  try {
    const base = await server.start(0);
    await playwright(session, fixture.root, "open", `${base}/c/rust/001-ownership`);
    opened = true;
    const result = await playwrightCode(
      session,
      fixture.root,
      `async page => {
      await page.setViewportSize({width:1280,height:900});
      const form = page.locator('[data-quiz-id="check-1"]');
      await form.locator('[data-question-id="q1"] input[value="b"]').check();
      for (const id of ['a','b']) await form.locator('[data-question-id="q2"] input[value="'+id+'"]').check();
      await form.locator('[data-question-id="q3"] input[type=text]').fill(' LIFETIME ');
      await form.locator('.cl-number').fill('4.05'); await form.locator('.cl-unit').fill('bytes');
      await form.locator('[data-blank="b1"]').fill('holder'); await form.locator('[data-blank="b2"]').fill('scope');
      await form.locator('[data-item="bind"]').getByRole('button',{name:'Move up'}).click();
      await form.locator('[data-item="scope"]').getByRole('button',{name:'Move up'}).click();
      await form.locator('[data-item="move"] select').selectOption('r3');
      await form.locator('[data-item="borrow"] select').selectOption('r1');
      await form.locator('[data-item="clone"] select').selectOption('r2');
      await form.locator('[data-segment="s3"]').click();
      const response = page.waitForResponse(r=>r.url().endsWith('/api/quiz/submit') && r.request().method()==='POST');
      await form.getByRole('button',{name:'Submit for grading',exact:true}).click();
      const submitted = await response;
      if (submitted.status()!==201) throw new Error('Submission failed: '+await submitted.text());
      await page.locator('[data-quiz-id="check-1"][data-state="graded"]').waitFor();
      await page.locator('[data-released]').waitFor();
      await page.evaluate(() => window.scrollTo(0,0));
      ${artifacts ? `await page.screenshot({path:${JSON.stringify(path.join(artifacts, "closed-graded.png"))},fullPage:true});` : ""}
      const first = await page.locator('[data-quiz-id="check-1"]').innerText();
      await page.reload(); await page.locator('[data-quiz-id="check-1"][data-state="graded"]').waitFor();
      if(!await page.getByRole('button',{name:'Graded',exact:true}).isDisabled()) throw new Error('Graded quiz unlocked');
      const state = await (await page.request.get(${JSON.stringify(base)}+'/api/state?classroom=rust&lesson=001-ownership')).json();
      if(JSON.stringify(state).includes('deterministicGrades')) throw new Error('Private allocations exposed');
      const privateFile = await page.request.get(${JSON.stringify(base)}+'/c/rust/001-ownership/quiz/key.json');
      if(privateFile.status()!==404) throw new Error('Private key served');
      return {first, state, privateStatus:privateFile.status()};
    }`,
    );
    const submissions = store.listSubmissions("rust", "001-ownership");
    const grades = store.listGrades("rust", "001-ownership");
    if (
      turns !== 0 ||
      submissions.length !== 1 ||
      grades.length !== 1 ||
      grades[0].questions.length !== 8 ||
      grades[0].score !== 87.5
    )
      throw new Error(`Closed grading failed: ${JSON.stringify({ turns, submissions, grades })}`);
    if (store.reviewItems("rust").length) throw new Error("Pretest entered review schedule");
    if (artifacts)
      fs.writeFileSync(
        path.join(artifacts, "closed-result.json"),
        JSON.stringify({ result, turns, submissions, grades }, null, 2),
      );
    console.log(
      "PASS: eight exact answer types, immediate grade, pretest release, reload, private state, and no teacher turns",
    );
  } catch (error) {
    if (artifacts)
      fs.writeFileSync(
        path.join(artifacts, "failure.json"),
        JSON.stringify({ error: String(error) }, null, 2),
      );
    throw error;
  } finally {
    if (opened) await playwright(session, fixture.root, "close");
    await server.close();
    fixture.cleanup();
  }
}
