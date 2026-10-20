/** Shared real-host drive through the classroom control, retaining durable output. */
import * as fs from "node:fs";
import * as path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lessonRequests } from "../src/next-lesson.ts";
import * as store from "../src/store.ts";
import { readTeacherState } from "../src/service-state.ts";
import { control, ensureService, serviceStatus } from "../src/service-client.ts";
import { ROOT, TEST_MODELS, until, directedLessonMode } from "./harness.ts";
import { playwrightCode } from "./playwright.ts";
export const DIRECTED_CODE_SOURCE =
  "function sum(values) { return values.filter(Number.isFinite).reduce((total, value) => total + value, 0); }";
export async function driveRealNextLesson(
  browser: string,
  root: string,
  base: string,
  host: string,
  artifacts: string | null,
  recoverPublication = false,
  activity?: { beforeRestart(): Promise<void>; afterRestart(): Promise<void> },
): Promise<void> {
  const mode = directedLessonMode();
  const codeMode = mode === "code";
  const faded = mode === "faded";
  const stepper = mode === "stepper";
  const sourceFiles = [
    "src/lesson-output.ts",
    "src/next-lesson.ts",
    "src/pi-teacher.ts",
    "src/lesson-research.ts",
    "src/quiz.ts",
    "src/quiz-authoring.ts",
    "src/rubric.ts",
    "src/store/quizzes.ts",
    "src/teacher.ts",
    "src/teacher-service.ts",
    "src/prompts.ts",
    "src/grade-dispute.ts",
    "assets/templates/quiz.html",
    "assets/templates/lesson.html",
    "assets/templates/faded.html",
    "assets/templates/stepper.html",
    "assets/runtime/quiz.mjs",
    "assets/runtime/quiz-ui.mjs",
    "assets/runtime/code.mjs",
    "assets/runtime/code-ui.mjs",
    "assets/runtime/code-worker.mjs",
    "assets/runtime/vendor/quickjs/provenance.json",
    "package.json",
    "package-lock.json",
    "docs/TEACHING.md",
    "docs/CODE-EXERCISES.md",
    "docs/TEACHING-PLAN.md",
  ];
  const inventory = (dir: string) =>
    Object.fromEntries(
      sourceFiles.map((file) => [
        file,
        createHash("sha256")
          .update(fs.readFileSync(path.join(dir, file)))
          .digest("hex"),
      ]),
    );
  const loaded = (await serviceStatus()).packageRoot;
  const sourceHashes = inventory(ROOT);
  assert.ok(loaded);
  assert.deepEqual(inventory(loaded), sourceHashes);
  if (artifacts)
    fs.writeFileSync(
      path.join(artifacts, "next-lesson-source-provenance.json"),
      JSON.stringify({ host, mode, source: ROOT, loaded, sourceHashes }, null, 2),
    );
  const topic = codeMode
    ? 'Create a short JavaScript function assessment, explicitly skip the pretest and teaching gate together. One objective, one data-type="code" question, one normal check quiz. Ask the learner to implement function sum(values) returning the total of finite numbers, zero for an empty array. Use synchronous JavaScript only, entry sum, a labelled starter editor with a TODO instead of the solution, 3 public function-call tests including empty/mixed/negative inputs. Use private teacher judgment criteria for accumulating every input and the zero identity; accept loops or reduce. Add two private runnable code review variants with the same objective. No libraries, network, imports, host execution or hidden tests. Do not include any other quiz questions.'
    : stepper
      ? "Teach a short lesson on accumulating a running total. Include exactly one reusable .cl-stepper widget using version 1, domain algorithm, mode prefix-sum and values [2,-3,8]. Put it in the pretest gate outside all forms. Explain why only the consumed prefix contributes. Use different values for one prequestion, one later check and two private review variants. Keep one objective. Use the official MDN Array reduce documentation at https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/reduce as the research source."
      : faded
        ? "Teach a short lesson on deciding whether two Rust borrows may coexist. Include one reusable .cl-faded widget with two ordered steps: identify the borrow kinds, then reason about their overlap. Declare three distinct fully specified code cases: worked, last-step completion, then all-step practice. The final case must require fresh work, not paraphrase the worked case. Use principle-focused self-explanation and compare responses for open reasoning. Use different code/values in the graded check and its private variants. Use the official Rust Book at https://doc.rust-lang.org/book/ch04-02-references-and-borrowing.html as the research source. Keep one objective, one prequestion, one later check, and two private review variants."
        : "Teach a short lesson on shared borrowing in Rust: predict whether two immutable references may coexist. Use the official Rust Book at https://doc.rust-lang.org/book/ch04-02-references-and-borrowing.html as the research source. Keep one objective, one prequestion, one later check, and two private review variants for the check.";
  const viewport = await playwrightCode<{ width: number; height: number }>(
    browser,
    root,
    "async page=>page.viewportSize()",
  );
  const originalEvidence = JSON.stringify(store.readLearningRecords("rust"));
  const originalGrades = JSON.stringify(store.listGrades("rust", "001-ownership"));
  const before = lessonRequests("rust").length;
  const selected = host === "claude" || host === "codex" ? TEST_MODELS[host].model : null;
  if (selected)
    await playwrightCode(
      browser,
      root,
      `async page=>{
      await page.goto(${JSON.stringify(base)}+'/c/rust/settings');
      await page.getByLabel('Teacher model',{exact:true}).selectOption('__custom__');
      await page.getByLabel('Model ID',{exact:true}).fill(${JSON.stringify(selected)});
      await page.getByRole('button',{name:'Save teacher model',exact:true}).click();
      await page.getByRole('status').filter({hasText:'Saved for the next'}).waitFor();return true;
    }`,
    );
  await playwrightCode(
    browser,
    root,
    `async page=>{
    await page.goto(${JSON.stringify(base)}+'/c/rust');
    await page.getByRole('button',{name:'Next lesson',exact:true}).waitFor();
    await page.getByLabel('What would you like to learn next?').fill(${JSON.stringify(topic)});
    await page.getByRole('button',{name:'Next lesson',exact:true}).click();return true;
  }`,
  );
  const deadline = Date.now() + 600_000;
  let saved;
  let retried = false;
  let recovery: { marker: string; file: string } | undefined;
  let publicationRetried = false;
  let recoveredSession: { path: string; bytes: Buffer; plan: unknown; request: string } | undefined;
  while (Date.now() < deadline) {
    saved = lessonRequests("rust").at(-1);
    if (recoverPublication && !recovery && saved && ["queued", "running"].includes(saved.status)) {
      const file = path.join(root, "rust", saved.lesson, "lesson.html");
      const marker = `Owned Pi publication-recovery probe ${saved.id}`;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, marker, { flag: "wx" });
      recovery = { marker, file };
      if (artifacts)
        await playwrightCode(
          browser,
          root,
          `async page=>{await page.screenshot({path:${JSON.stringify(path.join(artifacts, "pi-next-lesson-running.png"))},fullPage:true});return true;}`,
        );
    }
    if (saved?.status === "failed") {
      if (artifacts) {
        fs.writeFileSync(
          path.join(
            artifacts,
            retried ? "next-lesson-retry-failed.json" : "next-lesson-failed.json",
          ),
          JSON.stringify(saved, null, 2),
        );
        await playwrightCode(
          browser,
          root,
          `async page=>{await page.goto(${JSON.stringify(base)}+'/c/rust');await page.getByRole('button',{name:'Retry lesson',exact:true}).waitFor();await page.screenshot({path:${JSON.stringify(path.join(artifacts, retried ? "next-lesson-retry-failed.png" : "next-lesson-failed.png"))},fullPage:true});return true;}`,
        );
      }
      if (
        recovery &&
        !publicationRetried &&
        saved.document &&
        saved.pageCheck &&
        saved.error?.includes("Lesson publication conflicts with lesson.html")
      ) {
        if (artifacts) {
          for (const [label, width, height] of [
            ["desktop", 1440, 1000],
            ["mobile", 390, 844],
          ] as const)
            await playwrightCode(
              browser,
              root,
              `async page=>{await page.setViewportSize({width:${width},height:${height}});await page.screenshot({path:${JSON.stringify(path.join(artifacts, "pi-publication-failed-" + label + ".png"))},fullPage:true});return true;}`,
            );
          await playwrightCode(
            browser,
            root,
            `async page=>{await page.setViewportSize(${JSON.stringify(viewport)});return true;}`,
          );
        }
        const teacher = readTeacherState("rust")!;
        const turn = teacher.requests.find((r) => r.id === `lesson:${saved!.id}`)!;
        assert.equal(turn.planValidated, true);
        assert.ok(turn.plan);
        assert.equal(fs.readFileSync(recovery.file, "utf8"), recovery.marker);
        const sessionPath = path.join(
          root,
          ".pi-teach-service/pi-sessions",
          teacher.identity.sessionId!,
        );
        recoveredSession = {
          path: sessionPath,
          bytes: fs.readFileSync(sessionPath),
          plan: turn.plan,
          request: turn.id,
        };
        const beforeService = await serviceStatus();
        await activity?.beforeRestart();
        await control("/stop", {});
        const stoppedBy = Date.now() + 10_000;
        assert.ok(beforeService.pid, "Owned service PID is required for restart verification");
        const alive = () => {
          try {
            process.kill(beforeService.pid!, 0);
            return true;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
            throw error;
          }
        };
        // Do not query the control socket while the known owner is closing it.
        while (alive() && Date.now() < stoppedBy)
          await new Promise((resolve) => setTimeout(resolve, 50));
        assert.equal(alive(), false, "Owned service did not exit after explicit stop");
        assert.equal((await serviceStatus()).running, false);
        await ensureService();
        const afterService = await serviceStatus();
        assert.equal(afterService.running, true);
        await activity?.afterRestart();
        assert.notEqual(afterService.pid, beforeService.pid);
        assert.equal(afterService.packageRoot, beforeService.packageRoot);
        assert.equal(afterService.url, beforeService.url);
        assert.equal(readTeacherState("rust")!.identity.sessionId, teacher.identity.sessionId);
        assert.equal(lessonRequests("rust").at(-1)!.status, "failed");
        assert.deepEqual(fs.readFileSync(sessionPath), recoveredSession.bytes);
        await playwrightCode(
          browser,
          root,
          `async page=>{await page.reload();await page.getByRole('button',{name:'Retry lesson',exact:true}).waitFor();return true;}`,
        );
        assert.equal(fs.readFileSync(recovery.file, "utf8"), recovery.marker);
        fs.unlinkSync(recovery.file);
        await playwrightCode(
          browser,
          root,
          `async page=>{await page.getByRole('button',{name:'Retry lesson',exact:true}).click();return true;}`,
        );
        publicationRetried = true;
        if (artifacts)
          fs.writeFileSync(
            path.join(artifacts, "next-lesson-publication-recovery.json"),
            JSON.stringify(
              {
                request: saved.id,
                session: teacher.identity.sessionId,
                beforeService,
                afterService,
                plan: turn.plan,
                sessionHash: createHash("sha256").update(recoveredSession.bytes).digest("hex"),
                explicitRetry: true,
              },
              null,
              2,
            ),
          );
        continue;
      }
      if (codeMode || retried || saved.document || saved.modelOutput === undefined)
        throw new Error(`Real ${host} Next lesson failed: ${saved.error}`);
      console.log(
        `[e2e:${host}] Rejected authoring output: ${saved.error}. Exercising one explicit Retry lesson action.`,
      );
      await playwrightCode(
        browser,
        root,
        `async page=>{await page.getByRole('button',{name:'Retry lesson',exact:true}).click();return true;}`,
      );
      retried = true;
      continue;
    }
    if (saved?.status === "done") break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.equal(saved?.status, "done", "Next lesson did not finish within 600 seconds");
  assert.equal(lessonRequests("rust").length, before + 1);
  if (recoverPublication) {
    assert.equal(
      publicationRetried,
      true,
      "Actual saved Pi authoring plan must recover after explicit retry",
    );
    assert.ok(recoveredSession);
    assert.deepEqual(fs.readFileSync(recoveredSession.path), recoveredSession.bytes);
    assert.deepEqual(
      readTeacherState("rust")!.requests.find((r) => r.id === recoveredSession!.request)!.plan,
      recoveredSession.plan,
    );
  }
  assert.ok(saved!.document);
  assert.ok(saved!.pageCheck);
  assert.equal(
    saved!.pageCheck.hash,
    createHash("sha256").update(JSON.stringify(saved!.document)).digest("hex"),
  );
  assert.equal(JSON.parse(saved!.pageCheck.report).learnerStateChanged, false);
  if (faded) {
    const receipt = JSON.parse(saved!.pageCheck.report);
    assert.equal(receipt.initial.faded, 0, "Public widget must stay behind the pretest gate");
    assert.ok(
      receipt.released.faded >= 1,
      "Directed actual teacher must author an exercised faded widget",
    );
    if (artifacts)
      fs.writeFileSync(
        path.join(artifacts, "faded-authoring.json"),
        JSON.stringify(
          {
            adoption: "directed",
            host,
            topic,
            lesson: saved!.lesson,
            receipt,
            humanLearningEvidence: false,
            learnerStateChanged: false,
          },
          null,
          2,
        ),
      );
  }
  if (stepper) {
    const receipt = JSON.parse(saved!.pageCheck.report);
    assert.equal(receipt.initial.steppers, 0, "Stepper must stay behind the pretest gate");
    assert.equal(
      receipt.released.steppers,
      1,
      "Directed actual teacher must publish one exercised stepper",
    );
    if (artifacts)
      fs.writeFileSync(
        path.join(artifacts, "stepper-authoring.json"),
        JSON.stringify(
          {
            adoption: "directed",
            host,
            topic,
            lesson: saved!.lesson,
            receipt,
            humanLearningEvidence: false,
            learnerStateChanged: false,
          },
          null,
          2,
        ),
      );
  }
  const checkedInputs = JSON.parse(saved!.pageCheck.report).preflight;
  assert.equal(checkedInputs.version, 1);
  assert.equal(Object.keys(checkedInputs.inputHashes).length, 4);
  for (const [name, hash] of Object.entries(checkedInputs.inputHashes))
    assert.equal(
      hash,
      createHash("sha256")
        .update(fs.readFileSync(path.join(root, "rust", saved!.lesson, name)))
        .digest("hex"),
    );
  assert.equal(JSON.stringify(store.readLearningRecords("rust")), originalEvidence);
  if (selected) {
    const teacher = readTeacherState("rust")!;
    const turn = teacher.requests.find((r) => r.id === `lesson:${saved!.id}`)!;
    assert.equal(turn.requestedModel, selected);
    assert.equal(turn.resolvedModel, selected);
    assert.equal(teacher.identity.activeRequestedModel, selected);
  }
  assert.equal(store.listSubmissions("rust", saved!.lesson).length, 0);
  assert.equal(store.listGrades("rust", saved!.lesson).length, 0);
  assert.equal(JSON.stringify(store.listGrades("rust", "001-ownership")), originalGrades);
  await playwrightCode(
    browser,
    root,
    `async page=>{
    await page.waitForURL('**/${saved!.lesson}',{timeout:30000});
    await page.waitForFunction(()=>document.querySelector('form.cl-quiz')?.dataset.state==='fresh');
    if(await page.locator('.cl-contract-error').count()) throw new Error('Authored page has contract errors');
    ${artifacts ? `await page.screenshot({path:${JSON.stringify(path.join(artifacts, `${host}-next-lesson.png`))},fullPage:true});` : ""}
    await page.reload(); await page.waitForFunction(()=>document.querySelector('form.cl-quiz')?.dataset.state==='fresh');
    return true;
  }`,
  );
  if (artifacts)
    for (const [label, width, height] of [
      ["desktop", 1440, 1000],
      ["mobile", 390, 844],
    ] as const)
      await playwrightCode(
        browser,
        root,
        `async page=>{
        await page.setViewportSize({width:${width},height:${height}});
        await page.screenshot({path:${JSON.stringify(path.join(artifacts, `${host}-next-lesson-${label}.png`))},fullPage:true});return true;
      }`,
      );
  await playwrightCode(
    browser,
    root,
    `async page=>{await page.setViewportSize(${JSON.stringify(viewport)});return true;}`,
  );
  if (selected)
    await playwrightCode(
      browser,
      root,
      `async page=>{
      await page.goto(${JSON.stringify(base)}+'/c/rust/settings');
      await page.getByLabel('Teacher model',{exact:true}).selectOption('');
      await page.getByRole('button',{name:'Save teacher model',exact:true}).click();
      await page.getByRole('status').filter({hasText:'Saved for the next'}).waitFor();return true;
    }`,
    );
  if (artifacts)
    fs.writeFileSync(
      path.join(artifacts, "stored-next-lesson.json"),
      JSON.stringify(saved, null, 2),
    );
  if (codeMode) {
    const submission = await playwrightCode<{ id: string }>(
      browser,
      root,
      `async page=>{
      await page.goto(${JSON.stringify(base)}+'/c/rust/'+${JSON.stringify(saved!.lesson)});
      const q=page.locator('.cl-q[data-type="code"]');if(await q.count()!==1)throw new Error('Service producer did not author exactly one runnable code question');
      await q.getByLabel('JavaScript source',{exact:true}).fill(${JSON.stringify(DIRECTED_CODE_SOURCE)});
      await q.locator('[data-cl-code-run]').click();await q.locator('.cl-code-runner[data-run-state="complete"]').waitFor();
      const contract=JSON.parse(await q.getAttribute('data-code'));
      if(await q.locator('[data-outcome="passed"]').count()!==contract.tests.length)throw new Error('Authored public tests failed for correct source');
      const state=await (await page.request.get(${JSON.stringify(base)}+'/api/state?classroom=rust&lesson='+${JSON.stringify(saved!.lesson)})).json();
      if(state.submissions?.length)throw new Error('Run created an attempt');
      const response=page.waitForResponse(r=>r.url().endsWith('/api/quiz/submit')&&r.request().method()==='POST');
      await page.getByRole('button',{name:'Submit for grading',exact:true}).click();const r=await response;if(r.status()!==201)throw new Error(await r.text());return r.json();
    }`,
    );
    const grade = await until("authored code grade", 185000, () => {
      const failed = readTeacherState("rust")?.requests.find(
        (r) => r.target === submission.id && r.status === "failed",
      );
      if (failed) throw new Error(failed.error);
      return (
        store.latestGrades("rust", saved!.lesson).find((g) => g.submissionId === submission.id) ??
        null
      );
    });
    assert.equal(grade.score, 100);
    const original = store.findSubmission(submission.id)!;
    const hash = createHash("sha256").update(JSON.stringify(original)).digest("hex");
    assert.equal(original.answers[0].value, DIRECTED_CODE_SOURCE);
    assert.equal(original.answers[0].type, "code");
    assert.ok(original.answers[0].code?.run);
    assert.ok(original.rubricCriteria?.[original.answers[0].questionId]);
    assert.equal(original.deterministicGrades?.length ?? 0, 0);
    await playwrightCode(
      browser,
      root,
      `async page=>{await page.reload();await page.locator('form[data-state="graded"]').waitFor();if(!await page.getByLabel('JavaScript source',{exact:true}).isDisabled())throw new Error('Authored code unlocked after grading');if(await page.locator('.cl-q-criteria li').count()<2)throw new Error('Missing authored criterion feedback');${artifacts ? `await page.screenshot({path:${JSON.stringify(path.join(artifacts, "authored-code-graded.png"))},fullPage:true});` : ""}return true;}`,
    );
    assert.equal(
      createHash("sha256")
        .update(JSON.stringify(store.findSubmission(submission.id)))
        .digest("hex"),
      hash,
    );
    if (artifacts)
      fs.writeFileSync(
        path.join(artifacts, "authored-code-submission.json"),
        JSON.stringify(
          { submission: original, grade, hash, loadedPackage: loaded, sourceHashes },
          null,
          2,
        ),
      );
    assert.deepEqual(inventory(ROOT), sourceHashes);
    assert.deepEqual(inventory(loaded!), sourceHashes);
    console.log(
      `[e2e:${host}] PASS: actual service-authored code ran public tests, submitted source for criterion grading and stayed locked on reload`,
    );
  }
  console.log(
    `[e2e:${host}] PASS: classroom Next lesson saved, checked without learner submissions, published and opened`,
  );
}
