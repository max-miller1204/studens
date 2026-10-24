/** Historical question identities can use new strict pools without gaining objective history. */
import * as fs from "node:fs";
import * as path from "node:path";
import { completePreparedReview, currentReview } from "../src/review-session.ts";
import { DAY_MS } from "../src/review.ts";
import { lessonUrl } from "../src/paths.ts";
import * as server from "../src/server.ts";
import * as store from "../src/store.ts";
import {
  makeFixture,
  seedClassroom,
  seedPreparedReviewSource,
  closeReviewVariants,
  termAnswer,
  writeGradedAttempt,
} from "../test/helpers.ts";
import { playwright, playwrightCode } from "./playwright.ts";

export async function verifyLegacyReview(artifacts: string, baseline = false): Promise<void> {
  fs.mkdirSync(artifacts, { recursive: true });
  for (const scenario of ["short", "numeric", "assisted", "unknown", "malformed"] as const) {
    if (baseline && !["short", "numeric"].includes(scenario)) continue;
    const numeric = scenario === "numeric";
    const f = makeFixture();
    const session = `studens-legacy-${scenario}-${process.pid}`;
    const evidence = path.join(artifacts, scenario);
    fs.mkdirSync(evidence, { recursive: true });
    let browserOpen = false;
    try {
      seedClassroom(f);
      seedPreparedReviewSource(f.root);
      closeReviewVariants(f.root);
      f.write(
        "rust/001-ownership/lesson.json",
        JSON.stringify({ title: "Ownership", createdAt: 2 }),
      );
      if (numeric) {
        const file = path.join(f.root, "rust/001-ownership/lesson.html");
        fs.writeFileSync(
          file,
          fs
            .readFileSync(file, "utf8")
            .replace('data-type="short"', 'data-type="numeric"')
            .replace("<textarea></textarea>", '<input type="number" class="cl-number">'),
        );
      }
      if (scenario === "malformed") {
        const file = path.join(f.root, "rust/001-ownership/quiz/key.json");
        const key = JSON.parse(fs.readFileSync(file, "utf8"));
        key["check-1"].q1.variants[0].rubric.expected = { prose: "The new owner" };
        fs.writeFileSync(file, JSON.stringify(key));
      }
      writeGradedAttempt({
        at: Date.now() - 2 * DAY_MS,
        answers: [
          termAnswer("q1", "owner", {
            assistance:
              scenario === "assisted" ? "hint" : scenario === "unknown" ? undefined : "none",
          }),
        ],
        correct: { q1: true },
      });
      const before = store.reviewItems("rust")[0];
      const originalGrades = JSON.stringify(store.listGrades("rust", "001-ownership"));
      const unexpected = () => {
        throw new Error("Closed prepared reviews must not call a teacher.");
      };
      server.setHooks({
        reviewOwner: "pi",
        onReview: completePreparedReview,
        onReviewRetry: unexpected,
        onAsk: unexpected,
        onFollowUp: unexpected,
        onQuizSubmit: unexpected,
        onReflect: unexpected,
      });
      const base = await server.start(0);
      const code = (body: string) =>
        playwrightCode(
          session,
          f.root,
          `async page => { ${body}; return await page.locator('body').ariaSnapshot(); }`,
        );
      const shot = (name: string) =>
        `await page.screenshot({path:${JSON.stringify(path.join(evidence, `${name}.png`))},fullPage:true});`;
      await playwright(session, f.root, "open", `${base}/c/rust`);
      browserOpen = true;
      await code(
        `await page.setViewportSize({width:1280,height:800}); await page.getByRole('button',{name:'Start review',exact:true}).waitFor(); ${shot("due-before")} const response = page.waitForResponse(r=>r.url().endsWith("/api/review") && r.request().method()==="POST"); await page.getByRole('button',{name:'Start review',exact:true}).click(); await response;`,
      );
      if ((numeric && baseline) || scenario === "malformed") {
        await code(
          `await page.getByText('Invalid machine-checkable expected answer',{exact:false}).waitFor(); ${shot("pool-error")} await page.reload(); await page.getByRole('button',{name:'Start review',exact:true}).waitFor();`,
        );
        fs.writeFileSync(
          path.join(evidence, "result.json"),
          JSON.stringify(
            {
              before,
              error: numeric
                ? "Legacy numeric original rejected before pool selection"
                : "Malformed new variant rejected before publication",
              review: currentReview("rust"),
            },
            null,
            2,
          ),
        );
        continue;
      }
      const review = currentReview("rust")!;
      await code(
        `await page.waitForURL(${JSON.stringify(`${base}${lessonUrl("rust", review.lesson)}*`)}); await page.waitForFunction(()=>document.querySelector('form.cl-quiz')?.dataset.state==='fresh'); await page.getByLabel('The new owner',{exact:true}).check(); if (await page.locator('[data-cl-assistance]').count()) throw new Error('Removed assistance selector returned.'); ${shot("review-answer")} await page.getByRole('button',{name:'Submit for grading',exact:true}).click(); await page.waitForFunction(()=>document.querySelector('form.cl-quiz')?.dataset.state==='graded'); await page.reload(); await page.waitForFunction(()=>document.querySelector('form.cl-quiz')?.dataset.state==='graded'); ${shot("review-complete")} await page.goto(${JSON.stringify(`${base}/c/rust`)}); await page.getByRole('button',{name:'Start review',exact:true}).waitFor(); await page.reload(); await page.getByRole('button',{name:'Start review',exact:true}).waitFor(); ${shot("due-after")}`,
      );
      const after = store.reviewItems("rust")[0];
      if (after.context !== "unknown" || after.objective !== undefined || after.key !== before.key)
        throw new Error("Historical context was invented.");
      if (baseline ? after.dueAt !== before.dueAt : after.dueAt <= after.lastFeedbackAt + DAY_MS)
        throw new Error("Legacy interval does not match the expected scheduler.");
      if (
        store.listGrades("rust", review.lesson).length !== 1 ||
        JSON.stringify(store.listGrades("rust", "001-ownership")) !== originalGrades
      )
        throw new Error("Grades changed or duplicated.");
      for (const file of ["key.json", "plan.json"])
        if ((await fetch(`${base}/c/rust/001-ownership/quiz/${file}`)).status !== 404)
          throw new Error("Private pool exposed.");
      await server.close();
      const restarted = await server.start(0);
      await code(
        `await page.goto(${JSON.stringify(`${restarted}/c/rust`)}); await page.getByRole('button',{name:'Start review',exact:true}).waitFor();`,
      );
      if (
        JSON.stringify(store.reviewItems("rust")[0]) !== JSON.stringify(after) ||
        store.listGrades("rust", review.lesson).length !== 1
      )
        throw new Error("Restart changed schedule or graded twice.");
      fs.cpSync(f.root, path.join(evidence, "classroom"), { recursive: true });
      fs.writeFileSync(
        path.join(evidence, "result.json"),
        JSON.stringify(
          {
            before,
            after,
            events: store.reviewEvents("rust"),
            submission: store.listSubmissions("rust", review.lesson),
            grades: store.listGrades("rust", review.lesson),
          },
          null,
          2,
        ),
      );
    } catch (error) {
      console.error(error);
      fs.cpSync(f.root, path.join(evidence, "failed-classroom"), { recursive: true });
      throw error;
    } finally {
      if (browserOpen) await playwright(session, f.root, "close");
      await server.close();
      f.cleanup();
    }
  }
}
