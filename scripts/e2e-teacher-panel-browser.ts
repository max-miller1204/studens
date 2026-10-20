/**
 * Check, in a real browser, that a learner never needs the terminal: they can ask about a
 * quiz question in place, and the teacher's follow-up after grading arrives in the
 * lesson's teacher panel, where they answer it.
 *
 * The teacher is the persistent service with a held fixture provider. This script plays
 * the model: it reads each prompt and releases each request with the plan a model would return.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import type { TeacherPlan } from "../src/teacher.ts";
import { TeacherService } from "../src/teacher-service.ts";
import * as server from "../src/server.ts";
import * as store from "../src/store.ts";
import { makeFixture, lessonHtml, seedClassroom } from "../test/helpers.ts";
import { highlightText } from "./browser-actions.ts";
import { playwright, playwrightCode } from "./playwright.ts";

const plan = (message: string, calls: TeacherPlan["calls"] = []): TeacherPlan => ({
  calls,
  message,
  learning_record: "",
  notes_markdown: "",
});
const call = (name: string, args: unknown) => ({ name, arguments_json: JSON.stringify(args) });

export async function verifyTeacherPanelBrowser(artifacts: string | null): Promise<void> {
  const fixture = makeFixture();
  seedClassroom(fixture);
  fixture.write(
    "rust/001-ownership/lesson.html",
    lessonHtml(
      "Teacher panel",
      `
    <p>Every value has one owner.</p>
    <div style="height: 2400px"></div>
    <form class="cl-quiz" data-quiz-id="check" data-title="Check">
      <ol class="cl-questions">
        <li class="cl-q" data-question-id="q1" data-type="choice">
          <p class="cl-q-prompt">Which binding frees the heap buffer?</p>
          <label><input type="radio" name="q1" value="a">The original binding</label>
          <label><input type="radio" name="q1" value="b">The binding it moved into</label>
        </li>
        <li class="cl-q" data-question-id="q2" data-type="term">
          <p class="cl-q-prompt">Name the trait that runs cleanup.</p><input type="text">
        </li>
      </ol>
    </form>
    <p>Prose after the quiz.</p>
    <div style="height: 2400px"></div>
    <p>Continue reading the lesson.</p>`,
    ),
  );
  fixture.write(
    "rust/001-ownership/quiz/key.json",
    JSON.stringify({
      check: {
        q1: {
          expected: "b",
          points: 1,
          full: "Chooses the binding that received the move.",
          partial: "No partial credit.",
        },
        q2: {
          expected: "Drop",
          points: 1,
          full: "Names the Drop trait.",
          partial: "No partial credit.",
        },
      },
    }),
  );
  const sent: string[] = [];
  const held: ((plan: TeacherPlan) => void)[] = [];
  const teacher = new TeacherService(async (_identity, prompt) => {
    sent.push(prompt);
    return new Promise<TeacherPlan>((resolve) => held.push(resolve));
  });
  const release = async (next: TeacherPlan) => {
    for (let i = 0; !held.length; i++) {
      if (i > 200) throw new Error("The teacher request never reached the provider.");
      await new Promise((r) => setTimeout(r, 25));
    }
    held.shift()!(next);
  };
  const annotation = () => store.listAnnotations("rust", "001-ownership")[0].id;
  server.setHooks({
    delivery: "service",
    onAsk: (a) => teacher.question(a),
    onFollowUp: (a, f) => teacher.followUp(a, f),
    onQuizSubmit: (s) => teacher.submission(s),
    onReflect: (r) => teacher.reflection(r),
    teacherState: (classroom, lesson) => teacher.publicState(classroom, lesson),
    onTeacherChat: (classroom, lesson, text, id) => teacher.chat(classroom, lesson, text, id),
    onTeacherRetry: (classroom, id) => teacher.retry(classroom, id),
  });
  teacher.attach("rust", "codex");
  const session = `studens-teacher-panel-${process.pid}`;
  const evidence: Record<string, unknown> = {};
  const assert = (condition: unknown, message: string) => {
    if (!condition) throw new Error(message);
  };
  let browserOpen = false;
  try {
    const base = await server.start();
    await playwright(session, fixture.root, "open", `${base}/c/rust/001-ownership`);
    browserOpen = true;
    const code = (body: string) =>
      playwrightCode<Record<string, unknown>>(session, fixture.root, `async page => {${body}}`);

    // 1. Highlight an option's text and ask about it. The option stays unchosen.
    await code(`
      await page.waitForFunction(() => document.querySelector('form.cl-quiz')?.dataset.state === 'fresh');
      return {};`);
    evidence.ask = await code(`
      ${highlightSource}
      await highlightText(page, 'form.cl-quiz', 'moved into');
      if (await page.locator('input[value="b"]').isChecked()) throw new Error('Highlighting chose the option.');
      await page.locator('.cl-ask-pill').click();
      await page.locator('[data-cl-question]').fill('What does moved mean here?');
      const asked = page.waitForResponse(r => r.url().endsWith('/api/ask'));
      await page.getByRole('button', {name:'Ask your teacher', exact:true}).click();
      const response = await asked;
      if (response.status() !== 201) throw new Error(await response.text());
      const card = page.locator('.cl-card-inline');
      await card.waitFor();
      const placed = await card.evaluate(el => ({
        afterQuestion: el.previousElementSibling?.dataset.questionId ?? null,
        inQuestionList: el.parentElement.classList.contains('cl-questions'),
      }));
      if (placed.afterQuestion !== 'q1' || !placed.inQuestionList) throw new Error('The card is not after its question: ' + JSON.stringify(placed));
      return { quiz: (await response.json()).quiz, placed };`);
    const askPromptText = sent.at(-1) ?? "";
    assert(
      askPromptText.includes("question `q1` of quiz `check`") &&
        askPromptText.includes("Do not give the answer"),
      "The ask prompt does not guard the ungraded quiz question.",
    );
    await release(
      plan("", [
        call("answer_lesson_question", {
          annotation_id: annotation(),
          answer_markdown: "Ownership passed to the new binding.",
        }),
      ]),
    );

    // 2. A follow-up inside the quiz must not submit the quiz or save a quiz draft.
    evidence.followUp = await code(`
      await page.waitForFunction(() => document.querySelector('.cl-card-answer')?.textContent.includes('Ownership passed'));
      let quizPosts = 0;
      page.on('request', r => { if (r.url().endsWith('/api/quiz/submit')) quizPosts++; });
      await page.locator('[data-cl-followup]').fill('So the old binding is unusable?');
      const followed = page.waitForResponse(r => r.url().includes('/follow-up'));
      await page.locator('[data-cl-followup-form]').getByRole('button', {name:'Ask', exact:true}).click();
      if ((await followed).status() !== 201) throw new Error('The follow-up was refused.');
      await page.waitForTimeout(600);
      const state = await page.locator('form.cl-quiz').getAttribute('data-state');
      if (quizPosts !== 0 || state !== 'fresh') throw new Error('The card follow-up submitted the quiz.');
      return { quizPosts, state };`);
    assert(
      !Object.hasOwn(store.readDrafts("rust", "001-ownership"), "quiz:check"),
      "Typing in the card saved a quiz draft.",
    );
    await release(
      plan("", [
        call("answer_lesson_question", {
          annotation_id: annotation(),
          answer_markdown: "Yes. After a move, the old binding cannot be used.",
        }),
      ]),
    );

    // 3. Submit. The panel moves under the quiz and says the teacher is grading.
    evidence.submit = await code(`
      await page.waitForFunction(() => [...document.querySelectorAll('.cl-card-answer')].some(a => a.textContent.includes('cannot be used')));
      await page.locator('input[value="b"]').check();
      await page.locator('[data-question-id="q2"] input').fill('Clone');
      await page.getByRole('button', {name:'Submit for grading', exact:true}).click();
      await page.waitForFunction(() => document.querySelector('form.cl-quiz').nextElementSibling?.classList.contains('cl-teacher'));
      await page.waitForFunction(() => document.querySelector('.cl-teacher-requests')?.textContent.includes('grading your quiz'));
      await page.evaluate(() => window.scrollTo(0, 0));
      return {};`);
    const [submission] = store.listSubmissions("rust", "001-ownership");
    const choice = submission.answers.find((a) => a.questionId === "q1");
    assert(
      choice?.label === "The binding it moved into",
      `A card marker leaked into the answer: ${JSON.stringify(choice)}`,
    );
    assert(sent.at(-1)?.includes("teacher panel"), "The grade prompt does not name the panel.");
    await release(plan("I will grade this next."));
    evidence.retry = await code(`
      await page.waitForFunction(() => document.querySelector('.cl-teacher-requests')?.textContent.includes('grade_quiz_answers'));
      const state = await page.locator('form.cl-quiz').getAttribute('data-state');
      if (state !== 'submitted') throw new Error('Prose changed the quiz state.');
      const retried = page.waitForResponse(r => r.url().endsWith('/api/teacher/retry'));
      await page.getByRole('button', {name:'Retry request', exact:true}).click();
      if (!(await retried).ok()) throw new Error('The explicit retry failed.');
      await page.waitForFunction(() => document.querySelector('.cl-teacher-requests')?.textContent.includes('grading your quiz'));
      await page.evaluate(() => window.scrollTo(0, 0));
      return {ungradedState: state, explicitRetry: true};`);
    assert(store.listGrades("rust", "001-ownership").length === 0, "Prose wrote a grade.");
    await release(
      plan("Clone copies a value. **Which trait** runs when a value goes out of scope?", [
        call("grade_quiz_answers", {
          submission_id: submission.id,
          feedback_markdown: "One of two.",
          questions: [
            {
              question_id: "q1",
              correct: true,
              points_earned: 1,
              points_possible: 1,
              feedback: "Right.",
            },
            {
              question_id: "q2",
              correct: false,
              points_earned: 0,
              points_possible: 1,
              feedback: "Clone copies. It does not clean up.",
            },
          ],
        }),
      ]),
    );

    // 4. The question arrives in the panel. The learner answers there.
    evidence.reply = await code(`
      const notice = page.locator('.cl-teacher-notice');
      await notice.waitFor({state:'visible'});
      if (!(await notice.textContent()).endsWith('↓')) throw new Error('The notice must point down to the teacher below.');
      ${artifacts ? `await page.screenshot({ path: ${JSON.stringify(path.join(artifacts, "teacher-notice-below.png"))} });` : ""}
      await notice.click();
      await page.waitForFunction(() => {
        const rect = document.querySelector('.cl-teacher').getBoundingClientRect();
        return rect.top < innerHeight && rect.bottom > 0 && document.querySelector('.cl-teacher-notice').hidden;
      });
      await page.waitForFunction(() => document.querySelector('.cl-teacher-message[data-role="teacher"] strong')?.textContent === 'Which trait');
      await page.getByRole('textbox', {name:'Reply to your teacher', exact:true}).fill('Drop');
      await page.getByRole('button', {name:'Send reply', exact:true}).click();
      await page.waitForFunction(() => [...document.querySelectorAll('.cl-teacher-message[data-role="learner"]')].some(m => m.textContent.includes('Drop')));
      await page.waitForFunction(() => document.querySelector('.cl-teacher-requests')?.textContent.includes('replying'));
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForFunction(() => document.querySelector('.cl-teacher').getBoundingClientRect().bottom <= 0);
      return { noticeShown: true, pointsDown: true, clickRevealedTeacher: true };`);
    const replyPrompt = sent.at(-1) ?? "";
    assert(
      replyPrompt.includes("The learner replied in the teacher panel") &&
        replyPrompt.includes("Drop"),
      "The panel reply prompt lost its context.",
    );
    await release(plan("Right. `Drop` runs the cleanup."));

    // A reply while reading past the quiz points up; scrolling updates the same notice.
    evidence.noticeAbove = await code(`
      const notice = page.locator('.cl-teacher-notice');
      await notice.waitFor({state:'visible'});
      if (!(await notice.textContent()).endsWith('↑')) throw new Error('The notice must point up to the teacher above.');
      ${artifacts ? `await page.screenshot({ path: ${JSON.stringify(path.join(artifacts, "teacher-notice-above.png"))} });` : ""}
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForFunction(() => {
        const notice = document.querySelector('.cl-teacher-notice');
        return !notice.hidden && notice.textContent.endsWith('↓');
      });
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForFunction(() => {
        const notice = document.querySelector('.cl-teacher-notice');
        return !notice.hidden && notice.textContent.endsWith('↑');
      });
      await notice.click();
      await page.waitForFunction(() => {
        const rect = document.querySelector('.cl-teacher').getBoundingClientRect();
        return rect.top < innerHeight && rect.bottom > 0 && document.querySelector('.cl-teacher-notice').hidden;
      });
      return { pointsUp: true, scrollUpdatesDirection: true, clickRevealedTeacher: true };`);

    // 5. Everything survives a reload, in place.
    evidence.reload = await code(`
      await page.waitForFunction(() => document.querySelectorAll('.cl-teacher-message').length === 3);
      await page.reload();
      await page.waitForFunction(() => document.querySelectorAll('.cl-teacher-message').length === 3);
      const result = await page.evaluate(() => ({
        panelAfterQuiz: document.querySelector('form.cl-quiz').nextElementSibling?.classList.contains('cl-teacher'),
        cardAfterQuestion: document.querySelector('.cl-card-inline')?.previousElementSibling?.dataset.questionId,
        highlightInLabel: Boolean(document.querySelector('label mark.cl-hl')),
        state: document.querySelector('form.cl-quiz').dataset.state,
      }));
      if (!result.panelAfterQuiz || result.cardAfterQuestion !== 'q1' || !result.highlightInLabel || result.state !== 'graded') throw new Error('Reload lost the panel or the card: ' + JSON.stringify(result));
      ${artifacts ? `await page.setViewportSize({ width: 1000, height: 1500 }); await page.locator('form.cl-quiz').evaluate(el => el.scrollIntoView()); await page.screenshot({ path: ${JSON.stringify(path.join(artifacts, "teacher-panel.png"))} });` : ""}
      return result;`);
    console.log("PASS: quiz highlight and teacher panel");
  } catch (error) {
    evidence.failure = String(error);
    evidence.sent = sent;
    throw error;
  } finally {
    await teacher.stop();
    if (artifacts) {
      fs.mkdirSync(artifacts, { recursive: true });
      fs.writeFileSync(
        path.join(artifacts, "teacher-panel.json"),
        JSON.stringify(evidence, null, 2),
      );
    }
    if (browserOpen) await playwright(session, fixture.root, "close");
    await server.close();
    fixture.cleanup();
  }
}

/** `highlightText`, as source for a run-code body. */
const highlightSource = `const highlightText = ${highlightText.toString()};`;
