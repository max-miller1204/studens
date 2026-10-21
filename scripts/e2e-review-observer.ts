/** Controlled replay of observer readiness, not a teacher-quality evaluation. */
import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { playwright, playwrightCode } from "./playwright.ts";
import {
  closedReviewActions,
  closedReviewReplyActions,
  newTeacherMessageActions,
} from "./review-card-actions.ts";

export async function verifyReviewObserver(
  artifacts: string | null,
  task = "Explain which scope releases the moved value. Include how you answered.",
): Promise<void> {
  if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
  const session = `studens-review-observer-${process.pid}`;
  const root = process.cwd();
  const fixture = http.createServer((req, res) => {
    if (req.method === "POST") {
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end("{}");
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end(`<form class="cl-quiz" data-state="fresh">
      <input type="radio" value="old"><select data-cl-assistance><option value="none">Alone</option></select>
      <button type="submit">Submit</button><span class="cl-q-verdict"></span></form>
      <section id="cl-teacher"><div class="cl-teacher-message" data-role="teacher"><div class="cl-teacher-body">An older question?</div></div>
      <label>Reply to your teacher<textarea></textarea></label><button id="reply">Send reply</button></section>
      <script>
      const message = text => {
        const el = document.createElement('div');el.className='cl-teacher-message';el.dataset.role='teacher';
        const body=document.createElement('div');body.className='cl-teacher-body';body.textContent=text;
        el.append(body);document.querySelector('#cl-teacher').append(el);
      };
      document.querySelector('form').onsubmit=async event=>{
        event.preventDefault();await fetch('/api/quiz/submit',{method:'POST'});
        document.querySelector('form').dataset.state='graded';document.querySelector('.cl-q-verdict').textContent='Incorrect';
        setTimeout(()=>message(${JSON.stringify(task).replaceAll("<", "\\u003c")}),150);
      };
      document.querySelector('#reply').onclick=async()=>{
        await fetch('/api/teacher/chat',{method:'POST'});setTimeout(()=>message('Saved reply feedback.'),150);
      };
      </script>`);
  });
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(fixture.address() as import("node:net").AddressInfo).port}`;
  try {
    await playwright(session, root, "open", url);
    const receipt = await playwrightCode<{ task: string; teacherCount: number }>(
      session,
      root,
      `async page => {
      ${closedReviewActions(null)}
      const task = await page.locator('.cl-teacher-body').last().textContent();
      ${closedReviewReplyActions()}
      return {task, teacherCount: await page.locator('.cl-teacher-message').count()};
    }`,
    );
    if (receipt.task !== task || receipt.teacherCount !== 3)
      throw new Error(
        `Observer lost the current task or accepted old reply history: ${JSON.stringify(receipt)}`,
      );
    const negatives = [];
    for (const scenario of ["old", "empty", "hidden", "failed", "message-and-failed"]) {
      await playwrightCode(
        session,
        root,
        `async page => {
        await page.goto(${JSON.stringify(url)});
        await page.evaluate(scenario => {
          const panel=document.querySelector('#cl-teacher');
          if (scenario !== 'old' && scenario !== 'failed') panel.insertAdjacentHTML('beforeend', '<div class="cl-teacher-message" data-role="teacher" '+(scenario==='hidden'?'hidden':'')+'><div class="cl-teacher-body">'+(scenario==='empty'?'   ':'New body')+'</div></div>');
          if (scenario.includes('failed')) panel.insertAdjacentHTML('beforeend','<p class="cl-teacher-request">Teacher failed: retained fixture failure</p>');
        },${JSON.stringify(scenario)});
        return true;
      }`,
      );
      const result = await playwrightCode<{ error: string }>(
        session,
        root,
        `async page => {
        try {
          ${newTeacherMessageActions("1", "Original corrective task", 350)}
          return {error: ''};
        } catch(error) { return {error: String(error)}; }
      }`,
      );
      if (
        !result.error.includes(scenario.includes("failed") ? "retained fixture failure" : "Timeout")
      )
        throw new Error(`Observer incorrectly accepted ${scenario}: ${JSON.stringify(result)}`);
      negatives.push({ scenario, ...result });
    }
    if (artifacts)
      fs.writeFileSync(
        path.join(artifacts, "observer.json"),
        JSON.stringify({ receipt, negatives }, null, 2),
      );
    console.log(
      "PASS: corrective observer accepts a new imperative, rejects old/empty/hidden messages, and surfaces failures",
    );
  } catch (error) {
    if (artifacts)
      fs.writeFileSync(
        path.join(artifacts, "failure.json"),
        JSON.stringify({ error: String(error) }, null, 2),
      );
    throw error;
  } finally {
    await playwright(session, root, "close");
    await new Promise<void>((resolve, reject) =>
      fixture.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
