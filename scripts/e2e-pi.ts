import { driveCriterionProbe } from "./criterion-probe.ts";
import { seedReteach, driveReteach } from "./e2e-reteach-browser.ts";
import { lessonRequests } from "../src/next-lesson.ts";
import { driveRealNextLesson } from "./next-lesson-actions.ts";
/** Test browser questions, quiz grading, and the teacher panel check in a real Pi session. */
import {
  closedReviewActions,
  refillRetryActions,
  reportQuestionActions,
} from "./review-card-actions.ts";
import { lessonUrl } from "../src/paths.ts";
import { highlightText } from "./browser-actions.ts";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import * as store from "../src/store.ts";
import { refillRequests } from "../src/review-refill.ts";
import { currentReview } from "../src/review-session.ts";
import {
  makeFixture,
  closeReviewVariants,
  lessonHtml,
  seedClassroom,
  seedHistoricalReview,
  seedTransferObjective,
} from "../test/helpers.ts";
import { playwright, playwrightCode } from "./playwright.ts";
import { TEST_MODELS, toolRunSettled } from "./harness.ts";

const fixture = makeFixture();
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
seedClassroom(fixture);
fixture.write(
  "rust/001-ownership/lesson.html",
  lessonHtml(
    "Ownership",
    `
  <h1>Ownership</h1>
  <p>Every value in Rust has one owner. When the owner goes out of scope, the value is dropped.</p>
  <form class="cl-quiz" data-quiz-id="check-1" data-title="Check on learning">
    <ol class="cl-questions"><li class="cl-q" data-question-id="q1" data-type="choice">
      <p class="cl-q-prompt">What happens to a value when its owner goes out of scope?</p>
      <label><input type="radio" name="q1" value="a">The value is dropped</label>
      <label><input type="radio" name="q1" value="b">The value stays alive forever</label>
    </li></ol>
  </form>`,
  ).replace("<main data-cl-content>", '<main class="cl-lesson-shell" data-cl-content>'),
);

fixture.write(
  "rust/001-ownership/quiz/key.json",
  JSON.stringify({
    "check-1": {
      q1: {
        expected: "a",
        points: 1,
        fullCredit: "The value is dropped.",
        noCredit: "The value stays alive forever.",
      },
    },
  }),
);

const session = `studens-pi-${process.pid}`;
const toolsAudit = path.join(artifacts ?? fixture.root, "pi-tools.jsonl");
const toolsObserver = fixture.write(
  "tool-observer.ts",
  `import fs from 'node:fs';
export default function(pi) {
 let lesson=false;
 const save=(phase)=>fs.appendFileSync(${JSON.stringify(toolsAudit)},JSON.stringify({phase,lesson,tools:pi.getActiveTools()})+'\\n');
 pi.on('session_start',()=>{save('initial');});
 pi.on('before_agent_start',event=>{lesson=event.prompt.startsWith('Explicit Next lesson request ');save('before');});
 pi.on('agent_end',()=>{save('after');});
 pi.on('session_shutdown',()=>{save('shutdown');});
}`,
);
const child = spawn(
  "pi",
  [
    "--mode",
    "rpc",
    "--provider",
    TEST_MODELS.pi.provider,
    "--model",
    TEST_MODELS.pi.model,
    "--thinking",
    TEST_MODELS.pi.effort,
    "--no-session",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
    "--no-themes",
    "--offline",
    "--extension",
    path.join(root, "index.ts"),
    "--extension",
    toolsObserver,
  ],
  {
    cwd: fixture.root,
    // The user's own classroom config may set a port that a live Pi session holds.
    env: {
      ...process.env,
      PI_CLASSROOMS_DIR: fixture.root,
      PI_CLASSROOM_CONFIG: path.join(fixture.root, "test-config.json"),
      PI_CLASSROOM_TAILSCALE: "0",
    },
    stdio: ["pipe", "pipe", "pipe"],
  },
);

const exited = new Promise<void>((resolve) => child.on("close", () => resolve()));
const events: Array<Record<string, any>> = [];
let buffer = "";
let failure: Error | null = null;
let stderr = "";
child.stdout.on("data", (chunk: Buffer) => {
  buffer += chunk.toString();
  let end: number;
  while ((end = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, end).replace(/\r$/, "");
    buffer = buffer.slice(end + 1);
    if (!line) continue;
    try {
      const event = JSON.parse(line);
      events.push(event);
      if (event.type === "extension_error" || (event.type === "response" && !event.success))
        failure = new Error(JSON.stringify(event));
      if (event.type === "message_end" && event.message?.stopReason === "error")
        failure = new Error(`Pi model request failed: ${event.message.errorMessage}`);
      if (event.type === "tool_execution_end" && event.isError)
        failure = new Error(`Tool failed: ${event.toolName}`);
    } catch (error) {
      failure = error as Error;
    }
  }
});
child.stderr.on("data", (chunk: Buffer) => {
  stderr += chunk.toString();
});
child.on("error", (error) => {
  failure = error;
});
child.on("exit", (code) => {
  failure = new Error(`Pi exited with ${code}: ${stderr}`);
});
const send = (command: Record<string, unknown>) =>
  child.stdin.write(`${JSON.stringify(command)}\n`);
async function until<T>(label: string, probe: () => T | null): Promise<T> {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (failure) throw failure;
    const result = probe();
    if (result !== null) return result;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label}. ${stderr}`);
}

let browserOpen = false;
try {
  send({ id: "state", type: "get_state" });
  const state = await until(
    "Pi state",
    () => events.find((e) => e.id === "state" && e.type === "response") ?? null,
  );
  if (
    state.data.model.provider !== TEST_MODELS.pi.provider ||
    state.data.model.id !== TEST_MODELS.pi.model ||
    state.data.thinkingLevel !== TEST_MODELS.pi.effort
  )
    throw new Error(`Pi did not use the test model: ${JSON.stringify(state.data)}`);
  console.log(
    `[e2e:pi] model: ${state.data.model.provider}/${state.data.model.id} ${state.data.thinkingLevel}`,
  );
  send({ id: "start", type: "prompt", message: "/classroom start" });
  const base = await until("server URL", () => {
    const event = events.find(
      (e) =>
        e.type === "extension_ui_request" &&
        e.method === "notify" &&
        /Classroom server started at/.test(e.message),
    );
    return event ? (/http:\/\/127\.0\.0\.1:\d+/.exec(event.message)?.[0] ?? null) : null;
  });
  await until("status widget", () =>
    events.some(
      (e) =>
        e.method === "setWidget" &&
        e.widgetLines?.some((line: string) => line.includes("server running on port")),
    )
      ? true
      : null,
  );
  send({ id: "open", type: "prompt", message: "/classroom rust" });
  const classroomUrl = await until("classroom link", () => {
    const event = events.find(
      (e) =>
        e.type === "extension_ui_request" && e.method === "notify" && /^📚 http/.test(e.message),
    );
    return event ? (/http:\/\/127\.0\.0\.1:\d+\/c\/rust/.exec(event.message)?.[0] ?? null) : null;
  });
  await playwright(session, fixture.root, "open", classroomUrl);
  browserOpen = true;
  await playwrightCode(
    session,
    fixture.root,
    `async page=>{
    await page.getByRole('link',{name:'Settings',exact:true}).click();
    await page.getByText('Pi · your live session chooses the teacher model. Change it in Pi.',{exact:true}).waitFor();
    if(await page.getByLabel('Teacher model',{exact:true}).isVisible())throw new Error('Pi offered a persistent teacher model selector.');
    await page.getByLabel('Pace',{exact:true}).fill('Steady, one idea at a time');
    await page.getByLabel('Depth',{exact:true}).fill('Detailed, with worked examples');
    await page.getByLabel('Tone',{exact:true}).fill('Direct and encouraging');
    await page.getByRole('button',{name:'Save preferences',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Preferences saved'}).waitFor();
    await page.getByRole('button',{name:'Save connection settings',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Links updated'}).waitFor();
    await page.reload();
    if(await page.getByLabel('Pace',{exact:true}).inputValue()!=='Steady, one idea at a time')throw new Error('Pi preferences did not survive reload.');
    ${artifacts ? `await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:${JSON.stringify(path.join(artifacts, "pi-settings.png"))},fullPage:true});` : ""}
    await page.getByRole('link',{name:'Rust',exact:true}).click();return {};
  }`,
  );
  if (fs.existsSync(path.join(fixture.root, ".pi-teach-service")))
    throw new Error("Pi settings started a persistent service.");
  await driveRealNextLesson(session, fixture.root, base, "pi", artifacts);
  if ((failure as Error | null)?.message === "Tool failed: publish_lesson") {
    const saved = lessonRequests("rust").at(-1)!;
    const requests = events.flatMap((e, index) =>
      e.type === "message_end" &&
      e.message?.role === "user" &&
      e.message.content?.some((c: { text?: string }) =>
        c.text?.startsWith(`Explicit Next lesson request ${saved.id} `),
      )
        ? [index]
        : [],
    );
    const failedEnd = events.findIndex((e, index) => index > requests[0] && e.type === "agent_end");
    const errors = events.flatMap((e, index) =>
      e.type === "tool_execution_end" && e.isError ? [{ event: e, index }] : [],
    );
    const errorText = (e: Record<string, any>) =>
      e.result?.content?.map((c: { text?: string }) => c.text ?? "").join("\n");
    if (
      saved.status !== "done" ||
      saved.failedAttempts?.length !== 1 ||
      requests.length !== 2 ||
      failedEnd <= requests[0] ||
      requests[1] <= failedEnd ||
      !errors.length ||
      errors[0].event.toolName !== "publish_lesson" ||
      errorText(errors[0].event) !== saved.failedAttempts[0].error ||
      errors.some(
        ({ event: e, index }, n) =>
          e.toolName !== "publish_lesson" ||
          index < requests[0] ||
          index > failedEnd ||
          (n > 0 &&
            errorText(e) !==
              "This lesson request requires an explicit retry from the classroom page."),
      ) ||
      !events.some(
        (e, index) =>
          index > requests[1] &&
          e.type === "tool_execution_end" &&
          e.toolName === "publish_lesson" &&
          !e.isError,
      )
    )
      throw failure;
    // Accept only the retained rejection and exact same-origin retry guards before the failed run ends.
    // The explicit browser retry must create a later origin and publish successfully; every other tool error is fatal.
    const recovery = {
      request: saved.id,
      failedEnd,
      requests,
      rejectedError: saved.failedAttempts[0].error,
      guardedRepublishes: errors.length - 1,
    };
    if (artifacts)
      fs.writeFileSync(
        path.join(artifacts, "next-lesson-origin-recovery.json"),
        JSON.stringify(recovery, null, 2),
      );
    console.log(
      `[e2e:pi] Verified explicit authoring recovery; ${errors.length - 1} same-origin republishes were refused before the failed run ended.`,
    );
    failure = null;
  }
  await until("lesson authoring run", () =>
    toolRunSettled(events, "publish_lesson") ? true : null,
  );
  const audit = fs
    .readFileSync(toolsAudit, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const initialTools = audit.find((entry) => entry.phase === "initial")?.tools;
  const authoring = audit.filter((entry) => entry.lesson && entry.phase === "before");
  if (!initialTools || !authoring.length) throw new Error("Pi active-tool audit is missing.");
  const expectedTools = [
    ...initialTools.filter((name: string) => name === "read"),
    "publish_lesson",
    "read_lesson_source",
  ];
  for (const entry of authoring)
    if (JSON.stringify(entry.tools) !== JSON.stringify(expectedTools))
      throw new Error("Pi advertised tools outside the explicit lesson set.");
  const completedTools = audit
    .filter((entry) => entry.lesson && entry.phase === "after")
    .at(-1)?.tools;
  if (JSON.stringify(completedTools) !== JSON.stringify(initialTools))
    throw new Error("Pi did not restore its exact original tool set after authoring.");
  await playwrightCode(
    session,
    fixture.root,
    `async page=>{await page.goto(${JSON.stringify(base)}+"/c/rust");return true;}`,
  );
  if (artifacts)
    fs.writeFileSync(
      path.join(artifacts, "pi-reading.json"),
      JSON.stringify(
        {
          command: "/classroom rust",
          classroomUrl,
          lessonUrl: `${base}/c/rust/001-ownership`,
          lesson: fs.readFileSync(
            path.join(fixture.root, "rust/001-ownership/lesson.html"),
            "utf8",
          ),
        },
        null,
        2,
      ),
    );
  await playwrightCode(
    session,
    fixture.root,
    `async page => {
    await page.locator('a[href="/c/rust/001-ownership"]').click();
    await page.locator('[data-cl-content]').getByText('Every value in Rust has one owner.', {exact:false}).waitFor();
    if (await page.locator('.cl-confidence').count()) throw new Error('The page has confidence controls');
    ${artifacts ? `await page.screenshot({path:${JSON.stringify(path.join(artifacts, "pi-fresh-lesson.png"))},fullPage:true});` : ""}
    return true;
  }`,
  );
  const readingStart = events.length;
  await playwrightCode(
    session,
    fixture.root,
    `async page => {
    await (${highlightText.toString()})(page, 'main > p', 'one owner');
    await page.locator('.cl-ask-pill').click();
    await page.locator('[data-cl-question]').fill('Why does Rust allow only one owner?');
    const response = page.waitForResponse(r => r.url().endsWith('/api/ask') && r.request().method() === 'POST');
    await page.getByRole('button', {name:'Ask your teacher', exact:true}).click();
    if ((await response).status() !== 201) throw new Error('The question was refused');
    return true;
  }`,
  );
  await until("page answer", () =>
    store
      .listAnnotations("rust", "001-ownership")
      .some((a) => a.status === "answered" && a.answerHtml)
      ? true
      : null,
  );
  await until("answer turn", () =>
    toolRunSettled(events.slice(readingStart), "answer_lesson_question") ? true : null,
  );
  if (artifacts)
    fs.writeFileSync(
      path.join(artifacts, "pi-composer-annotation.json"),
      JSON.stringify(store.listAnnotations("rust", "001-ownership"), null, 2),
    );
  console.log("[e2e:pi] browser question answered through answer_lesson_question");

  // A question about the quiz itself, asked before grading, from the question text.
  {
    const start = events.length;
    await playwrightCode(
      session,
      fixture.root,
      `async page => {
      await page.waitForFunction(() => [...document.querySelectorAll('.cl-card-answer')].some(answer => answer.textContent.trim() && !answer.querySelector('.cl-card-status')));
      await (${highlightText.toString()})(page, '.cl-q-prompt', 'What happens');
      await page.locator('.cl-ask-pill').click();
      await page.locator('[data-cl-question]').fill('What does this question mean by what happens?');
      const response = page.waitForResponse(r => r.url().endsWith('/api/ask') && r.request().method() === 'POST');
      await page.getByRole('button', {name:'Ask your teacher', exact:true}).click();
      if ((await response).status() !== 201) throw new Error('The quiz question was refused');
      return true;
    }`,
    );
    const quizCard = await until(
      "quiz question answer",
      () =>
        store
          .listAnnotations("rust", "001-ownership")
          .find((a) => a.quiz && a.status === "answered") ?? null,
    );
    if (quizCard.quiz?.questionId !== "q1" || quizCard.quiz.graded)
      throw new Error(`The quiz card lost its question: ${JSON.stringify(quizCard.quiz)}`);
    await until("quiz question turn", () =>
      toolRunSettled(events.slice(start), "answer_lesson_question") ? true : null,
    );
    console.log(`[e2e:pi] quiz question answered before grading: ${quizCard.answerMarkdown}`);
  }

  const attempt = 1;
  const option = "b";
  const expected = false;
  {
    const start = events.length;
    const submitted = await playwrightCode<{ id: string }>(
      session,
      fixture.root,
      `async page => {
      const form = page.locator('form.cl-quiz');
      await form.locator('input[value="${option}"]').check();
      const response = page.waitForResponse(r => r.url().endsWith('/api/quiz/submit') && r.request().method() === 'POST');
      await form.getByRole('button', {name:'Submit for grading', exact:true}).click();
      const result = await response;
      if (result.status() !== 201) throw new Error(await result.text());
      return await result.json();
    }`,
    );
    const saved = store.findSubmission(submitted.id);
    if (!saved || saved.answers.some((answer) => answer.confidence !== undefined))
      throw new Error("The browser submission contains confidence metadata");
    const grade = await until(
      "quiz grade",
      () =>
        store.listGrades("rust", "001-ownership").find((g) => g.submissionId === submitted.id) ??
        null,
    );
    if (grade.questions.length !== 1 || grade.questions[0].correct !== expected)
      throw new Error(`Wrong verdict for attempt ${attempt}`);
    const run = await until("grading turn", () => {
      const next = events.slice(start);
      return toolRunSettled(next, "grade_lesson_quiz") ? next : null;
    });
    if (!run.some((e) => e.type === "tool_execution_end" && e.toolName === "grade_lesson_quiz"))
      throw new Error("Pi did not grade with the tool");
    const panel = await until(
      "retrieval question in the panel",
      () =>
        store
          .listPanelMessages("rust", "001-ownership")
          .find((m) => m.role === "teacher" && m.id === `quiz:${submitted.id}`) ?? null,
    );
    if (!panel.text.includes("?"))
      throw new Error("Pi did not ask a retrieval question in the panel");
    await playwrightCode(
      session,
      fixture.root,
      `async page => {
      await page.waitForFunction(() => {
        const form = document.querySelector('form.cl-quiz');
        return form.dataset.state === 'graded' && form.dataset.attempts === '${attempt}';
      });
      if (await page.locator('.cl-confidence').count()) throw new Error('The graded page has confidence controls');
      if (await page.getByRole('button', {name:'Try again', exact:true}).count()) throw new Error('The page has a retry button');
      if (!await page.getByRole('button', {name:'Graded', exact:true}).isDisabled()) throw new Error('The graded quiz is unlocked');
      if (!await page.locator('input[value="${option}"]').isChecked()) throw new Error('The page shows the wrong answer');
      await page.waitForFunction(() => document.querySelector('form.cl-quiz').nextElementSibling?.classList.contains('cl-teacher'));
      await page.waitForFunction(() => document.querySelector('.cl-teacher-message[data-role="teacher"]')?.textContent.includes('?'));
      ${artifacts ? `await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({path:${JSON.stringify(path.join(artifacts, `pi-attempt-${attempt}.png`))},fullPage:true});` : ""}
      return true;
    }`,
    );
    console.log(
      `[e2e:pi] attempt ${attempt}: ${grade.score}%, ${expected ? "correct" : "wrong"}; panel: ${JSON.stringify(panel.text)}`,
    );
  }
  // The learner answers in the panel. Nothing is typed into Pi.
  const reply =
    "When the owner of a value leaves scope, Rust drops that value and frees its resources. If ownership moved to another variable, that new owner controls when the value is dropped. I answered without help.";
  await playwrightCode(
    session,
    fixture.root,
    `async page => {
    await page.getByRole('textbox', {name:'Reply to your teacher', exact:true}).fill(${JSON.stringify(reply)});
    const response = page.waitForResponse(r => r.url().endsWith('/api/teacher/chat'));
    await page.getByRole('button', {name:'Send reply', exact:true}).click();
    if ((await response).status() !== 201) throw new Error('The panel reply was refused');
    return true;
  }`,
  );
  const checkedReply = await until("panel answer check", () => {
    const message = store
      .listPanelMessages("rust", "001-ownership")
      .filter((m) => m.role === "teacher")[1];
    return message?.text.trim() ? message.text : null;
  });
  await playwrightCode(
    session,
    fixture.root,
    `async page => {
      await page.waitForFunction(() => document.querySelectorAll('.cl-teacher-message[data-role="teacher"]').length === 2);
      ${artifacts ? `await page.locator('.cl-teacher').scrollIntoViewIfNeeded(); await page.screenshot({path:${JSON.stringify(path.join(artifacts, "pi-panel-check.png"))}});` : ""}
      return true;
    }`,
  );
  if (events.some((e) => e.type === "prompt" && e.id === "chat-reply"))
    throw new Error("The check used the terminal");
  if (store.listSubmissions("rust", "001-ownership").length !== 1)
    throw new Error("The panel check created another quiz attempt");
  const review = store.reviewItems("rust");
  const historicalGrades = store.listGrades("rust", "001-ownership");
  if (
    historicalGrades.length !== 1 ||
    historicalGrades[0].score !== 0 ||
    historicalGrades[0].questions[0].correct ||
    review.length !== 1
  )
    throw new Error("The panel check changed the saved quiz grade or removed its review item.");
  const checks = store.listRetrievalChecks("rust");
  if (checks.length > 0 && review[0].lastSource !== "chat")
    throw new Error("Linked retrieval evidence did not reach the review schedule.");
  console.log(
    `[e2e:pi] panel answer check: ${JSON.stringify(checkedReply)}; retrieval checks linked: ${checks.length}`,
  );
  if (artifacts)
    fs.writeFileSync(path.join(artifacts, "pi-events.json"), JSON.stringify(events, null, 2));
  if (store.listLessons("rust").length !== 2)
    throw new Error("Pi created another lesson without agreement");
  const resumeInput = seedHistoricalReview(fixture.root);
  const savedResumeGrade = JSON.stringify(store.listGrades("rust", resumeInput.lesson));
  send({
    id: "resume-chat",
    type: "prompt",
    message: `Call resume_lesson_teacher with ${JSON.stringify(resumeInput)}. Return only its lesson link and end this turn. Do not ask a corrective question in this chat.`,
  });
  await until("historical review teacher question", () => {
    const messages = store.listPanelMessages("rust", resumeInput.lesson);
    return messages.some((m) => m.role === "teacher" && m.text.includes("?")) ? messages : null;
  });
  if (
    !events.some((e) => e.type === "tool_execution_end" && e.toolName === "resume_lesson_teacher")
  )
    throw new Error("Pi did not use the explicit resume tool.");
  if (store.listPanelMessages("rust", resumeInput.lesson).some((m) => m.role === "learner"))
    throw new Error("Resume invented a learner reply.");
  if (JSON.stringify(store.listGrades("rust", resumeInput.lesson)) !== savedResumeGrade)
    throw new Error("Resume changed the historical grade.");
  await playwrightCode(
    session,
    fixture.root,
    `async page => {
    await page.goto(${JSON.stringify(base)} + '/c/rust/' + ${JSON.stringify(resumeInput.lesson)} + '#cl-teacher');
    await page.waitForFunction(() => document.querySelector('form.cl-quiz')?.dataset.state === 'graded');
    await page.waitForFunction(() => document.querySelector('.cl-teacher-messages')?.textContent.includes('?'));
    ${artifacts ? `await page.locator('.cl-teacher').scrollIntoViewIfNeeded(); await page.screenshot({path:${JSON.stringify(path.join(artifacts, "pi-historical-resume.png"))}});` : ""}
    return true;
  }`,
  );
  console.log(
    "[e2e:pi] PASS: chat-origin historical review resumes in the panel with its 67% grade preserved",
  );
  seedTransferObjective(true);
  closeReviewVariants(fixture.root);
  await playwrightCode(
    session,
    fixture.root,
    `async page => {
    await page.goto(${JSON.stringify(base)} + '/c/rust');
    await page.waitForFunction(() => !document.querySelector('[data-cl-review-start]').disabled);
    await page.getByRole('button', {name:'Start review',exact:true}).click();
    return true;
  }`,
  );
  const reviewSession = await until("browser review assembly", () => {
    const session = currentReview("rust");
    if (session?.status === "failed") throw new Error(session.error);
    return session?.status === "done" ? session : null;
  });
  await playwrightCode(
    session,
    fixture.root,
    `async page => {
    await page.waitForURL(${JSON.stringify(base)} + ${JSON.stringify(lessonUrl("rust", reviewSession.lesson) + "*")});
    await page.waitForFunction(() => document.querySelector('form.cl-quiz')?.dataset.state === 'fresh');
    if (await page.locator('.cl-quiz-error').count()) throw new Error('Authored review has contract errors.');
    ${artifacts ? `await page.screenshot({path:${JSON.stringify(path.join(artifacts, "pi-review.png"))},fullPage:true});` : ""}
    return true;
  }`,
  );
  if (artifacts)
    fs.writeFileSync(
      path.join(artifacts, "stored-review.json"),
      JSON.stringify(reviewSession, null, 2),
    );
  console.log("[e2e:pi] PASS: prepared review opens from the classroom page without authoring");
  const correctionResult = await playwrightCode(
    session,
    fixture.root,
    `async page => {
      ${closedReviewActions(artifacts ? path.join(artifacts, "pi-review-correction.png") : null)}
      return { failures: correctiveFailures };
    }`,
  );
  if (artifacts)
    fs.writeFileSync(
      path.join(artifacts, "corrective-reply-retries.json"),
      JSON.stringify(correctionResult, null, 2),
    );

  const settledRefills = await until("background refill result", () => {
    const requests = refillRequests("rust").filter(
      (request) => request.lesson === reviewSession.lesson,
    );
    return requests.length &&
      requests.every((request) => ["done", "failed"].includes(request.status))
      ? requests
      : null;
  });
  const failedRefills = settledRefills.filter((request) => request.status === "failed");
  if (failedRefills.length) {
    console.log(
      "Explicit browser retry after saved background errors: " +
        failedRefills.map((request) => request.error).join("; "),
    );
    if (artifacts)
      fs.writeFileSync(
        path.join(artifacts, "failed-review-refills.json"),
        JSON.stringify(failedRefills, null, 2),
      );
    await playwrightCode(
      session,
      fixture.root,
      `async page => { ${refillRetryActions(
        failedRefills.map((request) => request.id),
        artifacts ? path.join(artifacts, "review-refills-failed.png") : null,
      )} return true; }`,
    );
  }

  const refills = await until("background private refill", () => {
    const requests = refillRequests("rust").filter((r) => r.lesson === reviewSession.lesson);
    if (requests.some((r) => r.status === "failed"))
      throw new Error(requests.find((r) => r.status === "failed")!.error);
    return requests.length && requests.every((r) => r.status === "done") ? requests : null;
  });
  if (artifacts)
    fs.writeFileSync(path.join(artifacts, "stored-refills.json"), JSON.stringify(refills, null, 2));
  console.log("[e2e:pi] PASS: durable background refill saves private variants");
  await playwrightCode(
    session,
    fixture.root,
    `async page => { ${reportQuestionActions(artifacts ? path.join(artifacts, "pi-question-report.png") : null)} return true; }`,
  );
  if (artifacts)
    fs.writeFileSync(
      path.join(artifacts, "stored-question-report.json"),
      JSON.stringify(
        await (
          await fetch(`${base}/api/state?classroom=rust&lesson=${reviewSession.lesson}`)
        ).json(),
        null,
        2,
      ),
    );
  console.log(
    "[e2e:pi] PASS: real Pi teacher receives a durable bad-question report and preserves grades",
  );
  const reteachLesson = seedReteach(fixture.root);
  await driveReteach(
    session,
    fixture.root,
    base,
    reteachLesson,
    artifacts ? path.join(artifacts, "reteach") : null,
  );

  await driveCriterionProbe(
    session,
    fixture.root,
    base,
    artifacts ? path.join(artifacts, "criteria") : null,
  );

  send({ id: "stop", type: "prompt", message: "/classroom stop" });
  await until("server stop", () =>
    events.some((e) => e.id === "stop" && e.type === "response") ? true : null,
  );
  try {
    await fetch(`${base}/`);
    throw new Error("The Pi server still runs after /classroom stop");
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
  }
  console.log(
    "[e2e:pi] PASS: browser question, quiz question, wrong-answer panel check, locked quiz, spaced review, widget, and server stop",
  );
} finally {
  if (artifacts) {
    fs.writeFileSync(path.join(artifacts, "pi-events.json"), JSON.stringify(events, null, 2));
    fs.writeFileSync(path.join(artifacts, "pi-stderr.log"), stderr);
    fs.cpSync(path.join(fixture.root, "rust"), path.join(artifacts, "classroom"), {
      recursive: true,
    });
  }
  if (browserOpen) await playwright(session, fixture.root, "close");
  child.kill();
  await exited;
  fixture.cleanup();
}
