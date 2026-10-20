/** New corrected learner action against an unchanged retained Claude publication; never regenerate it. */
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { makeFixture } from "../test/helpers.ts";
import { DIRECTED_CODE_SOURCE } from "./next-lesson-actions.ts";
import { ROOT, TEST_MODELS, useTestModel, until } from "./harness.ts";
import { ensureService, serviceStatus, control, servicePaths } from "../src/service-client.ts";
import { readTeacherState } from "../src/service-state.ts";
import * as store from "../src/store.ts";
import { playwright, playwrightCode } from "./playwright.ts";

const retained = path.resolve(process.argv[2]),
  artifacts = path.resolve(process.argv[3]);
const hash = (v: string | Uint8Array) => createHash("sha256").update(v).digest("hex");
const inventory = (dir: string): Record<string, string> =>
  Object.fromEntries(
    fs
      .readdirSync(dir, { withFileTypes: true })
      .flatMap((e) =>
        e.isDirectory()
          ? Object.entries(inventory(path.join(dir, e.name))).map(([k, v]) => [e.name + "/" + k, v])
          : [[e.name, hash(fs.readFileSync(path.join(dir, e.name)))]],
      ),
  );
const original = inventory(path.join(retained, "classroom"));
const published = JSON.parse(
  fs.readFileSync(path.join(retained, "stored-next-lesson.json"), "utf8"),
);
assert.equal(published.status, "done");
assert.ok(published.document && published.pageCheck);
fs.mkdirSync(artifacts); // Never overwrite a previous run.
fs.cpSync(path.join(retained, "classroom"), path.join(artifacts, "before-classroom"), {
  recursive: true,
});
const f = makeFixture(),
  restore = useTestModel("claude");
fs.cpSync(path.join(retained, "classroom"), path.join(f.root, "rust"), { recursive: true });
const originalIdentity = readTeacherState("rust")!.identity;
assert.equal(originalIdentity.backend, "claude");
const sourceFiles = [
  "src/quiz.ts",
  "src/code-questions.ts",
  "src/teacher.ts",
  "src/teacher-service.ts",
  "src/prompts.ts",
  "src/next-lesson.ts",
  "src/lesson-output.ts",
  "src/store/quizzes.ts",
  "assets/runtime/code-worker.mjs",
  "assets/runtime/code-ui.mjs",
  "assets/runtime/code.mjs",
  "assets/runtime/quiz-ui.mjs",
  "assets/runtime/quiz.mjs",
  "assets/runtime/vendor/quickjs/provenance.json",
  "docs/TEACHING-PLAN.md",
  "docs/CODE-EXERCISES.md",
];
const sourceInventory = Object.fromEntries(
  sourceFiles.map((file) => [file, hash(fs.readFileSync(path.join(ROOT, file)))]),
);
const harnessHashes = Object.fromEntries(
  ["scripts/replay-code-authoring.ts", "scripts/next-lesson-actions.ts"].map((file) => [
    file,
    hash(fs.readFileSync(path.join(ROOT, file))),
  ]),
);
fs.writeFileSync(
  path.join(artifacts, "provenance.json"),
  JSON.stringify(
    {
      kind: "retained-publication-new-corrected-learner-action",
      originalTargetExitCode: 1,
      authoringInference: false,
      newGradingInference: true,
      retained,
      original,
      sourceInventory,
      harnessHashes,
      source: DIRECTED_CODE_SOURCE,
      sourceHash: hash(DIRECTED_CODE_SOURCE),
      model: TEST_MODELS.claude,
    },
    null,
    2,
  ),
);
const receipt = JSON.parse(published.pageCheck.report);
for (const [file, expected] of Object.entries(receipt.preflight.inputHashes))
  assert.equal(hash(fs.readFileSync(path.join(f.root, "rust", published.lesson, file))), expected);
assert.equal(store.listSubmissions("rust", published.lesson).length, 0);
const listener = net.createServer();
await new Promise<void>((r) => listener.listen(0, "127.0.0.1", r));
process.env.PI_CLASSROOM_SERVICE_PORT = String((listener.address() as net.AddressInfo).port);
await new Promise<void>((r) => listener.close(() => r()));
process.env.PI_CLASSROOM_TAILSCALE = "0";
process.env.PI_CLASSROOM_TEACHER = "claude";
let started = false,
  opened = false;
const browser = "studens-code-author-replay-" + process.pid;
try {
  const status = await ensureService();
  started = true;
  assert.equal(status.packageRoot, path.resolve(ROOT));
  assert.equal(readTeacherState("rust")!.identity.sessionId, originalIdentity.sessionId);
  await playwright(browser, f.root, "open", status.url + "/c/rust/" + published.lesson);
  opened = true;
  const run = await playwrightCode<any>(
    browser,
    f.root,
    `async page=>{const q=page.locator('.cl-q[data-type="code"]');await page.locator('form[data-state="fresh"]').waitFor();if(await q.count()!==1)throw new Error('Wrong code question count');await q.getByLabel('JavaScript source',{exact:true}).fill(${JSON.stringify(DIRECTED_CODE_SOURCE)});await q.locator('[data-cl-code-run]').click();await q.locator('.cl-code-runner[data-run-state="complete"]').waitFor();const exercise=JSON.parse(await q.getAttribute('data-code'));if(await q.locator('[data-outcome="passed"]').count()!==exercise.tests.length)throw new Error('Corrected finite-number source failed declared tests');return {text:await q.locator('.cl-code-results').innerText(),exercise};}`,
  );
  assert.equal(store.listSubmissions("rust", published.lesson).length, 0);
  assert.equal(store.listGrades("rust", published.lesson).length, 0);
  const submission = await playwrightCode<{ id: string }>(
    browser,
    f.root,
    `async page=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/quiz/submit')&&r.request().method()==='POST');await page.getByRole('button',{name:'Submit for grading',exact:true}).click();const r=await response;if(r.status()!==201)throw new Error(await r.text());return r.json();}`,
  );
  const saved = store.findSubmission(submission.id)!;
  const savedHash = hash(JSON.stringify(saved));
  assert.equal(saved.answers[0].value, DIRECTED_CODE_SOURCE);
  assert.deepEqual(saved.answers[0].code?.exercise, run.exercise);
  assert.ok(saved.answers[0].code?.run);
  assert.equal(saved.deterministicGrades?.length ?? 0, 0);
  const grade = await until("retained authored code first grade", 185000, () => {
    const r = readTeacherState("rust")!.requests.find((r) => r.target === submission.id);
    if (r?.status === "failed") throw new Error(r.error);
    return (
      store.latestGrades("rust", published.lesson).find((g) => g.submissionId === submission.id) ??
      null
    );
  });
  assert.equal(grade.score, 100);
  assert.equal(
    grade.questions[0].criteria?.length,
    saved.rubricCriteria![saved.answers[0].questionId].length,
  );
  await playwrightCode(
    browser,
    f.root,
    `async page=>{await page.reload();await page.locator('form[data-state="graded"]').waitFor();if(!await page.getByLabel('JavaScript source',{exact:true}).isDisabled()||!await page.locator('[data-cl-code-run]').isDisabled())throw new Error('Graded source/Run unlocked');if(await page.locator('.cl-q-criteria li').count()!==${saved.rubricCriteria![saved.answers[0].questionId].length})throw new Error('Wrong visible criterion count');await page.setViewportSize({width:375,height:812});await page.evaluate(()=>{document.documentElement.dataset.theme='dark';scrollTo(0,0)});await page.screenshot({path:${JSON.stringify(path.join(artifacts, "replayed-code-graded.png"))},fullPage:true});return true;}`,
  );
  assert.equal(hash(JSON.stringify(store.findSubmission(submission.id))), savedHash);
  assert.equal(store.listGrades("rust", published.lesson).length, 1);
  for (const [file, expected] of Object.entries(receipt.preflight.inputHashes))
    assert.equal(
      hash(fs.readFileSync(path.join(f.root, "rust", published.lesson, file))),
      expected,
    );
  assert.equal(readTeacherState("rust")!.identity.sessionId, originalIdentity.sessionId);
  fs.writeFileSync(
    path.join(artifacts, "report.json"),
    JSON.stringify(
      {
        verdict: "PASS",
        kind: "retained-publication-new-corrected-learner-action",
        authoringInference: false,
        newGradingInference: true,
        run,
        submission: saved,
        submissionHash: savedHash,
        grade,
        teacher: readTeacherState("rust"),
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: unchanged retained publication, corrected learner Run/Submit, first new real Claude grade, exact criteria/source hashes and locked reload; original target FAIL remains.",
  );
} catch (error) {
  fs.writeFileSync(
    path.join(artifacts, "failure.json"),
    JSON.stringify({ error: String(error), teacher: readTeacherState("rust") }, null, 2),
  );
  throw error;
} finally {
  if (opened) await playwright(browser, f.root, "close");
  if (started && (await serviceStatus()).running) await control("/stop", {});
  fs.cpSync(path.join(f.root, "rust"), path.join(artifacts, "after-classroom"), {
    recursive: true,
  });
  if (fs.existsSync(servicePaths().log))
    fs.copyFileSync(servicePaths().log, path.join(artifacts, "service.log"));
  assert.deepEqual(inventory(path.join(retained, "classroom")), original);
  f.cleanup();
  restore();
}
