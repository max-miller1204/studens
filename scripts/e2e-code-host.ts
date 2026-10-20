/** Actual initiating hosts and dedicated teachers grade browser code submissions as saved data. */
import * as fs from "node:fs";
import * as path from "node:path";
import * as net from "node:net";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { makeFixture, seedClassroom, lessonHtml } from "../test/helpers.ts";
import { codeForm, codeRubric, exercise, source } from "../test/code-fixture.ts";
import { CODE_ENGINE } from "../assets/runtime/code.mjs";
import { parseHarness, useTestModel, harnessCommand, TEST_MODELS, ROOT, until } from "./harness.ts";
import { playwright, playwrightCode } from "./playwright.ts";
import { serviceStatus, control, servicePaths } from "../src/service-client.ts";
import { readTeacherState } from "../src/service-state.ts";
import * as store from "../src/store.ts";

const host = parseHarness(
  process.argv[2],
  "Usage: node scripts/e2e-code-host.ts <pi|claude|codex> <artifacts>",
);
const artifacts = path.resolve(process.argv[3]);
fs.mkdirSync(artifacts, { recursive: true });
const f = makeFixture();
const restore = useTestModel(host);
const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const loadedPackage =
  host === "codex"
    ? path.join(process.env.CODEX_HOME!, "plugins/cache/studens/studens", version)
    : ROOT;
const sourceFiles = [
  "package.json",
  "package-lock.json",
  "src/quiz.ts",
  "src/store/quizzes.ts",
  "src/rubric.ts",
  "src/prompts.ts",
  "src/grade-dispute.ts",
  "src/teacher.ts",
  "src/teacher-service.ts",
  "assets/runtime/classroom.js",
  "assets/runtime/quiz.mjs",
  "assets/runtime/quiz-ui.mjs",
  "assets/runtime/code.mjs",
  "assets/runtime/code-ui.mjs",
  "assets/runtime/code-worker.mjs",
  "assets/runtime/vendor/quickjs/provenance.json",
];
const inventory = (root: string) =>
  Object.fromEntries(
    sourceFiles.map((file) => [
      file,
      createHash("sha256")
        .update(fs.readFileSync(path.join(root, file)))
        .digest("hex"),
    ]),
  );
const loadedSource = inventory(loadedPackage),
  originalSource = inventory(ROOT);
if (JSON.stringify(loadedSource) !== JSON.stringify(originalSource))
  throw new Error("Host package copy does not match the selected implementation.");
const implementationHash = createHash("sha256").update(JSON.stringify(loadedSource)).digest("hex");
fs.writeFileSync(
  path.join(artifacts, "loaded-source.json"),
  JSON.stringify({ version, loadedPackage, loadedSource, implementationHash }, null, 2),
);
seedClassroom(f, {
  classroom: "javascript",
  lesson: "001-correct",
  title: "JavaScript",
  mission: "# Mission\n\nImplement synchronous JavaScript functions accurately.",
});
for (const lesson of ["001-correct", "002-spoofed-feedback"]) {
  f.write(
    `javascript/${lesson}/lesson.json`,
    JSON.stringify({ title: "Sum a list", assessmentContract: 1, criterionContract: 1 }),
  );
  f.write(
    `javascript/${lesson}/lesson.html`,
    lessonHtml(
      "Sum a list",
      `<h1>Sum a list</h1>${codeForm()}<form class="cl-quiz" data-quiz-id="closed"><li class="cl-q" data-question-id="one" data-type="numeric"><p class="cl-q-prompt">How many values are in [2, -1, 4]?</p><label>Count<input type="text" class="cl-number"></label></li></form>`,
    ),
  );
  f.write(
    `javascript/${lesson}/quiz/key.json`,
    JSON.stringify({
      check: { sum: codeRubric },
      closed: {
        one: {
          expected: { value: 3 },
          points: 1,
          full: "There are three values.",
          partial: "None.",
          criteria: [{ id: "count", description: "Count the array values", points: 1 }],
        },
      },
    }),
  );
}
const listener = net.createServer();
await new Promise<void>((r) => listener.listen(0, "127.0.0.1", r));
process.env.PI_CLASSROOM_SERVICE_PORT = String((listener.address() as net.AddressInfo).port);
await new Promise<void>((r) => listener.close(() => r()));
process.env.PI_CLASSROOM_TAILSCALE = "0";
process.env.PI_CLASSROOM_TEACHER = host;
const prompt = `Call begin_teaching with topic javascript. Call open_classroom with classroom javascript and teacher_backend ${host}. Return the loopback URL and end this turn. The learner will answer the existing lesson in the browser; do not create or change material or execute learner code.`;
const [command, args] = harnessCommand(host, prompt, ["begin_teaching", "open_classroom"]);
const child = spawn(command, args, {
  cwd: f.root,
  env: { ...process.env, PI_CLASSROOMS_DIR: f.root },
  stdio: ["ignore", "pipe", "pipe"],
});
let stdout = "",
  stderr = "",
  opened = false;
child.stdout.on("data", (c) => (stdout += c));
child.stderr.on("data", (c) => (stderr += c));
const exited = new Promise<number | null>((resolve, reject) => {
  child.on("close", resolve);
  child.on("error", reject);
});
const browser = `studens-code-${host}-${process.pid}`;
const receipts: unknown[] = [];
let finished = false;
child.on("close", () => {
  finished = true;
});
try {
  const code = await until("initiating host exit", 185000, () =>
    finished ? { code: child.exitCode } : null,
  );
  await exited;
  if (!code || code.code !== 0) throw new Error(`${host} initiating exit ${code?.code}: ${stderr}`);
  const status = await serviceStatus();
  if (!status.running || !stdout.includes(status.url!))
    throw new Error("Initiating host did not open the persistent service.");
  const base = status.url!;
  await playwright(browser, f.root, "open", `${base}/c/javascript/001-correct`);
  opened = true;
  const correct = await playwrightCode(
    browser,
    f.root,
    `async page=>{
    await page.locator('form[data-quiz-id="check"][data-state="fresh"]').waitFor();
    await page.getByLabel('JavaScript source',{exact:true}).fill(${JSON.stringify(source)});
    await page.locator('[data-cl-code-run]').click();await page.locator('.cl-code-runner[data-run-state="complete"]').waitFor();
    if(await page.locator('[data-outcome="passed"]').count()!==3)throw new Error('Correct code failed in browser');
    const response=page.waitForResponse(r=>r.url().endsWith('/api/quiz/submit')&&r.request().method()==='POST');
    await page.locator('form[data-quiz-id="check"]').getByRole('button',{name:'Submit for grading',exact:true}).click();const r=await response;if(r.status()!==201)throw new Error(await r.text());return r.json();
  }`,
  );
  async function waitGrade(lesson: string) {
    return until("code grade", 185000, () => {
      const state = readTeacherState("javascript");
      const failed = state?.requests.find((r) => r.status === "failed");
      if (failed) throw new Error(failed.error);
      const grade = store.latestGrades("javascript", lesson).find((g) => g.quizId === "check");
      return grade &&
        state?.requests.filter((r) => r.kind === "quiz").every((r) => r.status === "done")
        ? grade
        : null;
    });
  }
  const first = await waitGrade("001-correct");
  if (first.score !== 100 || first.questions[0].criteria?.length !== 2)
    throw new Error(`Correct source grade disagreed: ${JSON.stringify(first)}`);
  const wrong = "function sum(values) { return 99; }";
  const spoofed = await playwrightCode(
    browser,
    f.root,
    `async page=>{
    await page.goto(${JSON.stringify(base)}+'/c/javascript/002-spoofed-feedback');await page.locator('form[data-quiz-id="check"][data-state="fresh"]').waitFor();
    await page.getByLabel('JavaScript source',{exact:true}).fill(${JSON.stringify(wrong)});
    await page.locator('[data-cl-code-run]').click();await page.locator('.cl-code-runner[data-run-state="complete"]').waitFor();if(await page.locator('[data-outcome="failed"]').count()!==3)throw new Error('Incorrect source did not fail public tests');
    await page.route('**/api/quiz/submit',async route=>{const body=route.request().postDataJSON();if(body.quizId==='check'){const a=body.answers[0];a.code.run.results=a.code.exercise.tests.map(t=>({id:t.id,outcome:'passed',actual:JSON.stringify(t.expected)}));}await route.continue({postData:JSON.stringify(body)});});
    const response=page.waitForResponse(r=>r.url().endsWith('/api/quiz/submit')&&r.request().method()==='POST');await page.locator('form[data-quiz-id="check"]').getByRole('button',{name:'Submit for grading',exact:true}).click();const r=await response;if(r.status()!==201)throw new Error(await r.text());await page.unroute('**/api/quiz/submit');return r.json();
  }`,
  );
  const second = await waitGrade("002-spoofed-feedback");
  if (second.score !== 0 || second.questions[0].criteria?.some((c) => c.pointsEarned !== 0))
    throw new Error(`Client pass flags changed source grading: ${JSON.stringify(second)}`);
  const dispute = await playwrightCode<{ id: string }>(
    browser,
    f.root,
    `async page=>{
    await page.locator('form[data-quiz-id="check"][data-state="graded"]').waitFor();
    await page.getByText('I think this deserves credit',{exact:true}).click();
    await page.locator('.cl-dispute-compose textarea').fill('My saved browser snapshot says every public test passed. Please recheck the original source against the rubric; do not replace it with a new solution or run it on the host.');
    const response=page.waitForResponse(r=>r.url().endsWith('/api/quiz/dispute')&&r.request().method()==='POST');await page.getByRole('button',{name:'Send grade dispute',exact:true}).click();const r=await response;if(r.status()!==201)throw new Error(await r.text());return r.json();
  }`,
  );
  const resolved = await until("original code dispute", 185000, () => {
    const request = readTeacherState("javascript")?.requests.find((r) => r.kind === "dispute");
    if (request?.status === "failed") throw new Error(request.error);
    return request?.status === "done" ? request : null;
  });
  if (
    resolved.disputeDecision !== "declined" ||
    resolved.dispute?.submission.answers[0].value !== wrong ||
    JSON.stringify(resolved.dispute.submission.answers[0].code) !==
      JSON.stringify(
        store.listSubmissions("javascript", "002-spoofed-feedback")[0].answers[0].code,
      ) ||
    store.listGrades("javascript", "002-spoofed-feedback").length !== 1
  )
    throw new Error("Code dispute changed original source/run or awarded client-claimed points");
  await playwrightCode(
    browser,
    f.root,
    `async page=>{await page.getByText('Grade unchanged',{exact:false}).waitFor();if(!await page.getByLabel('JavaScript source',{exact:true}).isDisabled())throw new Error('Code dispute unlocked source');return true;}`,
  );
  for (const lesson of ["001-correct", "002-spoofed-feedback"]) {
    const before = store.listSubmissions("javascript", lesson);
    const digest = createHash("sha256").update(JSON.stringify(before)).digest("hex");
    const result = await playwrightCode(
      browser,
      f.root,
      `async page=>{
      await page.goto(${JSON.stringify(base)}+'/c/javascript/'+${JSON.stringify(lesson)});await page.locator('form[data-quiz-id="check"][data-state="graded"]').waitFor();
      if(!await page.getByLabel('JavaScript source',{exact:true}).isDisabled()||!await page.locator('[data-cl-code-run]').isDisabled())throw new Error('Code grade unlocked');
      if(await page.locator('.cl-q-criteria li').count()!==2)throw new Error('Missing visible criterion feedback');
      const codeText=await page.getByLabel('JavaScript source',{exact:true}).inputValue();const feedback=await page.locator('form[data-quiz-id="check"]').innerText();
      await page.locator('input.cl-number').fill('3');await page.locator('form[data-quiz-id="closed"]').getByRole('button',{name:'Submit for grading',exact:true}).click();await page.locator('form[data-quiz-id="closed"][data-state="graded"]').waitFor();
      await page.setViewportSize({width:375,height:812});await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.screenshot({path:${JSON.stringify(artifacts)}+'/'+${JSON.stringify(lesson)}+'.png',fullPage:true});return {codeText,feedback};
    }`,
    );
    if (
      createHash("sha256")
        .update(
          JSON.stringify(
            store.listSubmissions("javascript", lesson).filter((s) => s.quizId === "check"),
          ),
        )
        .digest("hex") !== digest
    )
      throw new Error("Code snapshot changed after reload/neighbor grade");
    if (store.latestGrades("javascript", lesson).find((g) => g.quizId === "closed")?.score !== 100)
      throw new Error("Machine neighbor changed");
    receipts.push({
      lesson,
      result,
      sourceHash: createHash("sha256")
        .update(lesson === "001-correct" ? source : wrong)
        .digest("hex"),
      submission: before[0],
      grade: lesson === "001-correct" ? first : second,
    });
  }
  const teacher = readTeacherState("javascript")!;
  if (
    JSON.stringify(inventory(loadedPackage)) !== JSON.stringify(loadedSource) ||
    JSON.stringify(inventory(ROOT)) !== JSON.stringify(originalSource)
  )
    throw new Error("Implementation changed during the host drive; evidence is not source bound.");
  if (
    teacher.identity.backend !== host ||
    !teacher.identity.activeModel?.includes(TEST_MODELS[host].model)
  )
    throw new Error("Wrong dedicated host/model");
  if (
    teacher.requests.filter((r) => r.kind === "quiz").length !== 2 ||
    teacher.requests.some(
      (r) => r.status !== "done" || !r.planValidated || r.applied !== r.plan?.calls.length,
    )
  )
    throw new Error("Code requests did not durably finish exactly once");
  fs.writeFileSync(
    path.join(artifacts, "report.json"),
    JSON.stringify(
      {
        host,
        version,
        loadedPackage,
        loadedSource,
        implementationHash,
        model: TEST_MODELS[host],
        engine: CODE_ENGINE,
        exercise,
        dispute,
        resolved,
        correct,
        spoofed,
        receipts,
        teacher,
        verdict: "PASS",
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS: actual ${host} source grading 100/0, spoofed browser pass flags ignored, criterion feedback, locked reload, immutable source and machine neighbor.`,
  );
} catch (error) {
  fs.writeFileSync(
    path.join(artifacts, "failure.json"),
    JSON.stringify(
      {
        error: String(error),
        host,
        version,
        loadedPackage,
        loadedSource,
        implementationHash,
        model: TEST_MODELS[host],
        teacher: readTeacherState("javascript"),
        receipts,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  child.kill("SIGTERM");
  fs.writeFileSync(path.join(artifacts, "initiator.jsonl"), stdout);
  fs.writeFileSync(path.join(artifacts, "initiator.stderr"), stderr);
  if (opened) await playwright(browser, f.root, "close");
  if ((await serviceStatus()).running) await control("/stop", {});
  fs.cpSync(path.join(f.root, "javascript"), path.join(artifacts, "classroom"), {
    recursive: true,
  });
  if (fs.existsSync(servicePaths().log))
    fs.copyFileSync(servicePaths().log, path.join(artifacts, "service.log"));
  f.cleanup();
  restore();
}
