/** Explicitly retry a retained rejected Pi code grade; never regenerate its publication. */
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { makeFixture } from "../test/helpers.ts";
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
const original = inventory(retained);
fs.mkdirSync(artifacts); // A new directory is mandatory; failed evidence is immutable.
fs.cpSync(path.join(retained, "classroom"), path.join(artifacts, "before-classroom"), {
  recursive: true,
});
fs.cpSync(path.join(retained, "pi-sessions"), path.join(artifacts, "before-pi-sessions"), {
  recursive: true,
});
const f = makeFixture(),
  restore = useTestModel("pi");
fs.cpSync(path.join(retained, "classroom"), path.join(f.root, "rust"), { recursive: true });
const sessions = path.join(f.root, ".pi-teach-service/pi-sessions");
fs.cpSync(path.join(retained, "pi-sessions"), sessions, { recursive: true });
const old = readTeacherState("rust")!,
  identity = old.identity;
assert.equal(identity.backend, "pi");
const failed = old.requests.find((r) => r.kind === "quiz" && r.status === "failed")!;
assert.ok(failed && failed.plan && failed.planValidated === false);
assert.equal(failed.applied ?? 0, 0);
const submission = store.findSubmission(failed.target)!;
assert.ok(submission);
assert.equal(store.listGrades("rust", failed.lesson).length, 0);
const submissionHash = hash(JSON.stringify(submission)),
  sessionFile = path.join(sessions, identity.sessionId!),
  oldSession = fs.readFileSync(sessionFile);
const publication = inventory(path.join(f.root, "rust", failed.lesson));
const fixedFiles = ["lesson.html", "lesson.json", "quiz/key.json", "quiz/plan.json"];
const sourceFiles = [
  "src/teacher-service.ts",
  "src/teacher.ts",
  "src/pi-teacher.ts",
  "src/prompts.ts",
  "src/quiz.ts",
  "src/store/quizzes.ts",
  "assets/runtime/code-worker.mjs",
  "assets/runtime/code-ui.mjs",
  "assets/runtime/code.mjs",
  "src/lesson-output.ts",
  "src/next-lesson.ts",
];
const sourceInventory = Object.fromEntries(
  sourceFiles.map((file) => [file, hash(fs.readFileSync(path.join(ROOT, file)))]),
);
fs.writeFileSync(
  path.join(artifacts, "provenance.json"),
  JSON.stringify(
    {
      kind: "retained-failed-code-grade-explicit-retry",
      originalTargetExitCode: 1,
      retained,
      original,
      sourceInventory,
      model: TEST_MODELS.pi,
      budgetMs: 185000,
      submissionHash,
      oldPlanHash: hash(JSON.stringify(failed.plan)),
      oldSessionHash: hash(oldSession),
      identity,
      publication,
    },
    null,
    2,
  ),
);
const listener = net.createServer();
await new Promise<void>((r) => listener.listen(0, "127.0.0.1", r));
process.env.PI_CLASSROOM_SERVICE_PORT = String((listener.address() as net.AddressInfo).port);
await new Promise<void>((r) => listener.close(() => r()));
process.env.PI_CLASSROOM_TAILSCALE = "0";
process.env.PI_CLASSROOM_TEACHER = "pi";
let started = false,
  opened = false;
const browser = "studens-code-retry-" + process.pid;
try {
  const status = await ensureService();
  started = true;
  assert.equal(status.packageRoot, path.resolve(ROOT));
  assert.equal(readTeacherState("rust")!.identity.sessionId, identity.sessionId);
  await playwright(browser, f.root, "open", status.url + "/c/rust/" + failed.lesson);
  opened = true;
  await playwrightCode(
    browser,
    f.root,
    `async page=>{await page.getByRole('button',{name:'Retry request',exact:true}).waitFor();await page.reload();await page.getByRole('button',{name:'Retry request',exact:true}).waitFor();if(!await page.getByLabel('JavaScript source',{exact:true}).isDisabled())throw new Error('Submitted source unlocked');return true;}`,
  );
  assert.deepEqual(fs.readFileSync(sessionFile), oldSession);
  assert.equal(store.listGrades("rust", failed.lesson).length, 0);
  await playwrightCode(
    browser,
    f.root,
    `async page=>{const response=page.waitForResponse(r=>r.url().endsWith('/api/teacher/retry')&&r.request().method()==='POST');await page.getByRole('button',{name:'Retry request',exact:true}).click();const r=await response;if(r.status()!==200)throw new Error(await r.text());return r.json();}`,
  );
  const done = await until("explicit Pi code retry", 185000, () => {
    const r = readTeacherState("rust")!.requests.find((r) => r.id === failed.id)!;
    if (r.status === "failed") throw new Error(r.error);
    return r.status === "done" ? r : null;
  });
  assert.equal(done.applied, 1);
  assert.equal(done.planValidated, true);
  const grade = store
    .latestGrades("rust", failed.lesson)
    .find((g) => g.submissionId === submission.id)!;
  assert.equal(grade.score, 100);
  assert.equal(grade.questions[0].criteria?.length, 2);
  assert.equal(store.listGrades("rust", failed.lesson).length, 1);
  assert.equal(store.listSubmissions("rust", failed.lesson).length, 1);
  assert.equal(hash(JSON.stringify(store.findSubmission(submission.id))), submissionHash);
  assert.equal(readTeacherState("rust")!.identity.sessionId, identity.sessionId);
  assert.ok(readTeacherState("rust")!.identity.activeModel?.includes(TEST_MODELS.pi.model));
  const newSession = fs.readFileSync(sessionFile);
  assert.ok(newSession.subarray(0, oldSession.length).equals(oldSession));
  const added = newSession.subarray(oldSession.length).toString();
  const entries = added
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const inputs = entries.filter((e) => e.type === "message" && e.message?.role === "user");
  assert.equal(inputs.length, 1);
  const actualInput = JSON.stringify(inputs[0]);
  assert.ok(actualInput.includes("check-1/q1") && actualInput.includes("not an eligibility grant"));
  fs.writeFileSync(
    path.join(artifacts, "actual-retry-user-input.json"),
    JSON.stringify(inputs[0], null, 2),
  );
  for (const file of fixedFiles)
    assert.equal(
      hash(fs.readFileSync(path.join(f.root, "rust", failed.lesson, file))),
      publication[file],
    );
  const repeated = await playwrightCode<{ status: number; body: string }>(
    browser,
    f.root,
    `async page=>{await page.reload();await page.locator('form[data-state="graded"]').waitFor();if(!await page.getByLabel('JavaScript source',{exact:true}).isDisabled()||!await page.locator('[data-cl-code-run]').isDisabled())throw new Error('Graded code unlocked');if(await page.getByRole('button',{name:'Retry request',exact:true}).count())throw new Error('Retry persisted');await page.screenshot({path:${JSON.stringify(path.join(artifacts, "retried-code-graded.png"))},fullPage:true});return page.evaluate(async()=>{const r=await fetch('/api/teacher/retry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({classroom:'rust',id:${JSON.stringify(failed.id)}})});return {status:r.status,body:await r.text()};});}`,
  );
  assert.equal(repeated.status, 409);
  assert.equal(store.listGrades("rust", failed.lesson).length, 1);
  assert.deepEqual(fs.readFileSync(sessionFile), newSession);
  for (const [file, expected] of Object.entries(sourceInventory))
    assert.equal(hash(fs.readFileSync(path.join(ROOT, file))), expected);
  fs.writeFileSync(
    path.join(artifacts, "report.json"),
    JSON.stringify(
      {
        verdict: "PASS",
        kind: "retained-failed-code-grade-explicit-retry",
        authoringInference: false,
        newGradingInference: true,
        submissionHash,
        oldPlan: failed.plan,
        grade,
        done,
        repeated,
        sessionHash: hash(newSession),
        addedSessionEntries: entries,
        teacher: readTeacherState("rust"),
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: same failed Pi request/session, explicit Retry with canonical code reference forms, immutable attempt/publication, one grade, repeated retry rejected. Original full target FAIL retained.",
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
  fs.cpSync(sessions, path.join(artifacts, "after-pi-sessions"), { recursive: true });
  if (fs.existsSync(servicePaths().log))
    fs.copyFileSync(servicePaths().log, path.join(artifacts, "service.log"));
  assert.deepEqual(inventory(retained), original);
  f.cleanup();
  restore();
}
