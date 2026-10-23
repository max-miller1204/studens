/** Exercise card order, instant grading, correction, history, and recovery through the UI. */
import * as fs from "node:fs";
import * as path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ClassroomBridge } from "../src/bridge.ts";
import { lessonDir, lessonUrl } from "../src/paths.ts";
import { completePreparedReview, currentReview, resumableReview } from "../src/review-session.ts";
import { DAY_MS } from "../src/review.ts";
import * as server from "../src/server.ts";
import * as store from "../src/store.ts";
import { TeacherService } from "../src/teacher-service.ts";
import {
  closeReviewVariants,
  makeFixture,
  seedClassroom,
  seedPreparedReviewSource,
  termAnswer,
  writeGradedAttempt,
} from "../test/helpers.ts";
import { playwright, playwrightCode } from "./playwright.ts";

function classroomHashes(root: string): Record<string, string> {
  return Object.fromEntries(
    fs
      .readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const file = path.join(entry.parentPath, entry.name);
        return [
          path.relative(root, file),
          createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
        ];
      })
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

export async function verifyReviewCards(artifacts: string | null): Promise<void> {
  for (const host of ["pi", "service"] as const) {
    const fixture = makeFixture();
    seedClassroom(fixture);
    seedPreparedReviewSource(fixture.root, "rust", "001-ownership", "check-1", ["q1", "q2"]);
    closeReviewVariants(fixture.root);
    writeGradedAttempt({
      at: Date.now() - 2 * DAY_MS,
      answers: [termAnswer("q1", "owner"), termAnswer("q2", "owner")],
      correct: { q1: true, q2: true },
    });
    const evidence = artifacts ? path.join(artifacts, host) : null;
    if (evidence) fs.mkdirSync(evidence, { recursive: true });
    const browser = `studens-review-cards-${host}-${process.pid}`;
    let turns = 0;
    let corrections = 0;
    const bridge = new ClassroomBridge({
      sendUserMessage: (prompt) => {
        turns++;
        if (prompt.includes("queued teacher-panel resume request")) corrections++;
        queueMicrotask(() =>
          bridge.onAgentEnd([
            {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: prompt.includes("queued teacher-panel resume request")
                    ? "What happens to the current owner's value when that scope ends?"
                    : "Keep the current owner in mind when tracing a move.",
                },
              ],
            },
          ]),
        );
      },
    });
    const teacher = new TeacherService(async (_identity, prompt) => {
      turns++;
      if (prompt.includes("queued teacher-panel resume request")) {
        corrections++;
        if (corrections === 1) throw new Error("Fixture corrective teacher unavailable.");
      }
      return {
        calls: [],
        message: prompt.includes("queued teacher-panel resume request")
          ? "What happens to the current owner's value when that scope ends?"
          : "Keep the current owner in mind when tracing a move.",
        learning_record: "",
        notes_markdown: "",
      };
    });
    if (host === "service") teacher.attach("rust", "codex");
    server.setHooks({
      reviewOwner: host,
      delivery: host === "service" ? "service" : "push",
      onAsk: () => {
        throw new Error("Unexpected annotation");
      },
      onFollowUp: () => {
        throw new Error("Unexpected follow-up");
      },
      onQuizSubmit: () => {
        throw new Error("Closed card called teacher grading");
      },
      onReflect: () => {
        throw new Error("Unexpected reflection");
      },
      onReview: (review) => {
        completePreparedReview(review);
      },
      onReviewRetry: (review) => {
        completePreparedReview(review);
      },
      onReviewMiss: (submission) =>
        host === "service"
          ? teacher.resume(
              {
                classroom: submission.classroom,
                lesson: submission.lesson,
                submission_id: submission.id,
              },
              true,
            )
          : bridge.correctReview(submission),
      teacherState: (classroom, lesson) =>
        host === "service"
          ? teacher.publicState(classroom, lesson)
          : bridge.panelState(classroom, lesson),
      onTeacherChat: (classroom, lesson, text, id) =>
        host === "service"
          ? teacher.chat(classroom, lesson, text, id)
          : bridge.chat(classroom, lesson, text, id),
      onTeacherRetry: (classroom, id) =>
        host === "service" ? teacher.retry(classroom, id) : bridge.retry(classroom, id),
    });
    const code = (body: string) =>
      playwrightCode(browser, fixture.root, `async page => { ${body}; return true; }`);
    const fragments: unknown[] = [];
    const checkFragment = async (label: string, quizId: string) => {
      const result = await playwrightCode(
        browser,
        fixture.root,
        `async page => {
        await page.waitForFunction(() => document.body.dataset.clStateLoaded === 'true' && performance.getEntriesByType('resource').some(e => e.name.includes('/api/glossary?')));
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const state = await page.evaluate(() => ({hash:location.hash,active:document.querySelector('[data-review-active="true"]')?.dataset.quizId,notice:!!document.querySelector('[data-cl-source-notice]'),noticeFocused:document.activeElement?.hasAttribute('data-cl-source-notice')}));
        if(state.hash !== '#'+${JSON.stringify(quizId)} || state.active !== ${JSON.stringify(quizId)} || state.notice || state.noticeFocused) throw Error('Review fragment misclassified: '+JSON.stringify(state));
        return state;
      }`,
      );
      fragments.push({ label, result });
    };
    const readOnly = async (label: string, body: string, quizId: string) => {
      const before = classroomHashes(path.join(fixture.root, "rust"));
      const beforeTurns = turns;
      await code(body);
      await checkFragment(label, quizId);
      const after = classroomHashes(path.join(fixture.root, "rust"));
      assert.deepEqual(after, before, `${label} changed classroom files`);
      assert.equal(turns, beforeTurns, `${label} called a teacher`);
      if (evidence)
        fs.writeFileSync(
          path.join(evidence, `${label}-hashes.json`),
          JSON.stringify({ before, after, turnsBefore: beforeTurns, turnsAfter: turns }, null, 2),
        );
    };
    const shot = (name: string) =>
      evidence
        ? `await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({path:${JSON.stringify(path.join(evidence, `${name}.png`))},fullPage:true});`
        : "";
    const stateShots = (name: string) =>
      [1280, 390]
        .map(
          (width) => `
      await page.setViewportSize({width:${width},height:844});
      await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
      await page.evaluate(async () => {
        const {buildTextIndex} = await import('/static/lesson-dom.mjs');
        if(buildTextIndex(document.body).segments.some(({node}) => node.parentElement.closest('.cl-review-progress, [data-review-state]')))
          throw Error('Mutable review chrome entered the passage index');
        if(document.querySelector('.cl-review-progress .cl-term, [data-review-state] .cl-term'))
          throw Error('Glossary decorated review chrome');
      });
      if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) throw Error('Review state overflows viewport');
      ${shot(`${name}-${width}`)}
    `,
        )
        .join("\n");
    let opened = false;
    try {
      const base = await server.start(0);
      await playwright(browser, fixture.root, "open", `${base}/c/rust`);
      opened = true;
      await code(`
        await page.getByRole('button', {name:'Start review',exact:true}).click();
        await page.waitForFunction(() => document.querySelector('[data-review-active="true"]')?.dataset.state === 'fresh');
        if (await page.locator('form.cl-quiz:visible').count() !== 1) throw new Error('Multiple cards visible.');
        await page.getByText('Question 1 of 2 · 0 answered', {exact:true}).waitFor();
        const meter = page.getByRole('progressbar',{name:'Answered review cards'});
        await meter.waitFor();
        if(await meter.getAttribute('aria-valuenow') !== '0' || await meter.getAttribute('aria-valuemax') !== '2') throw Error('Initial card progress is incorrect');
        if (!await page.getByRole('button', {name:'Next question',exact:true}).isDisabled()) throw new Error('Next is enabled before grading.');
        if(await page.getByRole('button',{name:'Retry review state',exact:true}).isVisible()) throw Error('Retry shown without an error');
        ${stateShots("first-card")}
      `);
      const review = currentReview("rust")!;
      await checkFragment("first-entry", "review");
      const reviewUrl = `${base}${lessonUrl("rust", review.lesson)}`;
      await readOnly(
        "fresh-reload",
        `await page.goto(${JSON.stringify(reviewUrl)}); await page.locator('form[data-state="fresh"]:visible').waitFor(); await page.reload();
        await page.goto(${JSON.stringify(reviewUrl + "#review-2")}); await page.reload();`,
        "review",
      );
      if (host === "service") {
        const draftFile = path.join(lessonDir("rust", review.lesson), "drafts.json");
        fs.writeFileSync(draftFile, "{invalid");
        await code(`
          await page.reload();
          await page.getByRole('alert').filter({hasText:'Cannot read JSON state'}).waitFor();
          await page.getByRole('button', {name:'Retry review state',exact:true}).waitFor();
          ${stateShots("state-load-failed")}
        `);
        fs.unlinkSync(draftFile);
        await code(`
          await page.getByRole('button', {name:'Retry review state',exact:true}).click();
          await page.waitForFunction(() => document.querySelector('[data-review-active="true"]')?.dataset.state === 'fresh');
        `);
      }
      const post = (quizId: string, questionId: string, key: string) =>
        fetch(`${base}/api/quiz/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            classroom: "rust",
            lesson: review.lesson,
            quizId,
            kind: "review",
            answers: [
              {
                questionId,
                type: "choice",
                prompt: "Who releases it?",
                value: "owner",
                label: "The new owner",
                reviewOf: key,
              },
            ],
          }),
        });
      const outOfOrder = await post("review-2", "r2", review.items[1].key);
      if (outOfOrder.status !== 409 || !(await outOfOrder.text()).includes("previous review card"))
        throw new Error(`Out-of-order probe returned ${outOfOrder.status}.`);
      await code(`
        await page.locator('form.cl-quiz:visible input[value="owner"]').check();
        await page.locator('form.cl-quiz:visible button[type="submit"]').click();
        await page.waitForFunction(() => document.querySelector('[data-review-active="true"]')?.dataset.state === 'graded');
        await page.reload();
        await page.getByText('Question 1 of 2 · 1 answered', {exact:true}).waitFor();
        ${shot("first-feedback")}
      `);
      if (turns || !resumableReview(currentReview("rust")!))
        throw new Error("Correct closed card used a model or completed the unfinished review.");
      await checkFragment("first-feedback", "review");
      const duplicate = await post("review", "r1", review.items[0].key);
      if (duplicate.status !== 409 || !(await duplicate.text()).includes("already graded"))
        throw new Error("A repeated card created a second grade.");
      await code(`
        await page.getByRole('button', {name:'Next question',exact:true}).click();
        await page.getByText('Question 2 of 2 · 1 answered', {exact:true}).waitFor();
        await page.locator('form.cl-quiz:visible input[value="old"]').check();
        await page.waitForFunction(() => document.querySelector('form.cl-quiz:not([hidden]) .cl-quiz-status')?.textContent === 'Draft saved.');
        await page.reload();
        await page.getByText('Question 2 of 2 · 1 answered', {exact:true}).waitFor();
        if (!await page.locator('form.cl-quiz:visible input[value="old"]').isChecked()) throw new Error('Second card draft was lost.');
        await page.setViewportSize({width:390,height:844});
        if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Cards overflow mobile.');
        ${shot("mobile-card")}
      `);
      await checkFragment("second-draft", "review-2");
      await readOnly(
        "saved-card-navigation",
        `
        await page.getByRole('button', {name:'Previous question',exact:true}).click();
        await page.getByText('Question 1 of 2 · 1 answered', {exact:true}).waitFor();
        await page.getByRole('button', {name:'Next question',exact:true}).focus();
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.activeElement?.classList.contains('cl-quiz-title'));
        await page.goto(${JSON.stringify(reviewUrl + "#review-2")});
        await page.locator('form.cl-quiz:visible input[value="old"]').waitFor();
        if (!await page.locator('form.cl-quiz:visible input[value="old"]').isChecked()) throw Error('Direct saved card lost its draft');
      `,
        "review-2",
      );
      // This explicit submission is a controlled write, separate from navigation receipts.
      await code(
        `await page.locator('form.cl-quiz:visible button[type="submit"]').click(); await page.getByText('Review complete · 2 of 2 answered', {exact:true}).waitFor();`,
      );
      if (host === "service") {
        await teacher.idle();
        await code(`
          await page.locator('.cl-teacher-requests').getByText('Fixture corrective teacher unavailable.', {exact:false}).waitFor();
          ${shot("correction-failed")}
          await page.reload();
          await page.getByRole('button', {name:'Retry request',exact:true}).waitFor();
        `);
        if (corrections !== 1) throw new Error("Reload retried a failed correction.");
        await code(`await page.getByRole('button', {name:'Retry request',exact:true}).click();`);
        await teacher.idle();
      }
      await code(`
        await page.getByText("What happens to the current owner's value when that scope ends?", {exact:true}).waitFor();
        if (!await page.locator('form.cl-quiz:visible').evaluate(el => el.nextElementSibling?.id === 'cl-teacher')) throw new Error('Correction is not beside the card.');
        ${shot("mobile-correction")}
        await page.getByRole('textbox', {name:'Reply to your teacher',exact:true}).fill('The current owner releases the value.');
        await page.getByRole('button', {name:'Send reply',exact:true}).click();
        await page.getByText('Keep the current owner in mind when tracing a move.', {exact:true}).waitFor();
        await page.getByRole('link', {name:'Review history',exact:true}).click();
        await page.getByRole('heading', {name:'Review history',exact:true}).waitFor();
        await page.getByText('2/2 answered', {exact:true}).waitFor();
        ${shot("history")}
        await page.goto(${JSON.stringify(`${base}/c/rust`)});
        if (await page.locator('.cl-lessons a[href*="/reviews/"]').count()) throw new Error('Review is in the lesson list.');
        await page.getByRole('link', {name:'Review history',exact:true}).waitFor();
      `);
      if (host === "service") await teacher.idle();
      await readOnly(
        "completed-reload",
        `
        await page.goto(${JSON.stringify(reviewUrl)});
        await page.getByText('Review complete · 2 of 2 answered', {exact:true}).waitFor();
        await page.reload();
      `,
        "review-2",
      );
      await readOnly(
        "completed-direct-first",
        `await page.goto(${JSON.stringify(reviewUrl + "#review")}); await page.reload();`,
        "review",
      );
      await code(`
        if(await page.getByRole('progressbar',{name:'Answered review cards'}).getAttribute('aria-valuenow') !== '2') throw Error('Completed card progress is incorrect');
        ${stateShots("complete")}
      `);
      for (const theme of ["light", "dark"]) {
        await readOnly(
          `completed-mobile-${theme}`,
          `await page.setViewportSize({width:390,height:844});
          await page.evaluate(theme=>localStorage.setItem('pi-classroom-theme',theme), ${JSON.stringify(theme)});
          await page.reload();
          await page.getByText('Review complete · 2 of 2 answered', {exact:true}).waitFor();
          if (await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) throw Error('Review overflows mobile');
          ${shot(`completed-mobile-${theme}`)}`,
          "review",
        );
      }
      await readOnly(
        "unknown-card",
        `
        await page.evaluate(() => {location.hash='review-999';});
        await page.locator('[data-cl-source-notice][data-review-state=stale]').waitFor();
        ${stateShots("stale-selection")}
        if (!await page.locator('[data-cl-source-notice]').evaluate(e=>e===document.activeElement)) throw Error('Missing source lost focus');
        await page.getByRole('link',{name:'Retry loading source section',exact:true}).waitFor();
        await page.evaluate(() => {location.hash='review';});
        await page.locator('[data-cl-source-notice]').waitFor({state:'detached'});
      `,
        "review",
      );
      if (
        resumableReview(currentReview("rust")!) ||
        store.listSubmissions("rust", review.lesson).length !== 2 ||
        store.listGrades("rust", review.lesson).length !== 2 ||
        store.readClassroom("rust")!.lessonCount !== 1
      )
        throw new Error(
          "Card recovery duplicated grades, lost completion, or changed lesson count.",
        );
      if (!fs.existsSync(path.join(fixture.root, "rust", ".reviews", review.lesson, "lesson.html")))
        throw new Error("Review is not in private history storage.");
      for (const route of [
        `/c/rust/.reviews/${review.lesson}/lesson.html`,
        `${lessonUrl("rust", review.lesson)}/quiz/key.json`,
        `${lessonUrl("rust", review.lesson)}/quiz/plan.json`,
      ])
        if ((await fetch(base + route)).status !== 404)
          throw new Error(`Private review route leaked: ${route}`);
      const legacy = "003-review-legacy";
      fixture.write(
        `rust/${legacy}/lesson.json`,
        JSON.stringify({ title: "Legacy review", kind: "review" }),
      );
      fixture.write(
        `rust/${legacy}/lesson.html`,
        "<!doctype html><html><head><title>Legacy review</title></head><body><main><p>Saved legacy review.</p></main></body></html>",
      );
      await code(`
        await page.goto(${JSON.stringify(`${base}/c/rust/reviews`)});
        await page.getByRole('link', {name:'Legacy review',exact:false}).click();
        await page.getByText('Saved legacy review.', {exact:true}).waitFor();
      `);
      if (store.readClassroom("rust")!.lessonCount !== 1)
        throw new Error("Legacy review counts as a lesson.");
      // Replaying startup's saved allocation completion must preserve both grades and correction requests.
      const beforeTurns = turns;
      await server.close();
      await server.start(0);
      if (host === "service") await teacher.idle();
      if (turns !== beforeTurns || store.listGrades("rust", review.lesson).length !== 2)
        throw new Error("Recovery repeated a correction or grade.");
      if (evidence)
        fs.writeFileSync(
          path.join(evidence, "result.json"),
          JSON.stringify(
            {
              host,
              review,
              turns,
              corrections,
              fragments,
              submissions: store.listSubmissions("rust", review.lesson),
              grades: store.listGrades("rust", review.lesson),
              storage: lessonDir("rust", review.lesson),
            },
            null,
            2,
          ),
        );
      console.log(
        `PASS: ${host} card order, instant grades, same-screen correction, mobile, history, legacy links, and recovery`,
      );
    } catch (error) {
      if (evidence) {
        fs.writeFileSync(
          path.join(evidence, "failure.json"),
          JSON.stringify({ error: String(error), review: currentReview("rust") }, null, 2),
        );
        if (opened) await code(shot("failure")).catch(() => {});
      }
      throw error;
    } finally {
      if (opened) await playwright(browser, fixture.root, "close");
      bridge.reset();
      await teacher.stop();
      await server.close();
      fixture.cleanup();
    }
  }
}
