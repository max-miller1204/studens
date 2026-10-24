/** Scoped real-host proof for legacy pool publication and independent spacing. */
import * as fs from "node:fs";
import * as path from "node:path";
import * as net from "node:net";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  makeFixture,
  seedClassroom,
  seedPreparedReviewSource,
  closeReviewVariants,
  termAnswer,
  writeGradedAttempt,
} from "../test/helpers.ts";
import { DAY_MS } from "../src/review.ts";
import { currentReview } from "../src/review-session.ts";
import { refillRequests } from "../src/review-refill.ts";
import { lessonPools } from "../src/review-pool.ts";
import { readTeacherState } from "../src/service-state.ts";
import { serviceStatus, servicePaths, control } from "../src/service-client.ts";
import { lessonUrl } from "../src/paths.ts";
import * as store from "../src/store.ts";
import { parseHarness, useTestModel, harnessCommand, ROOT, until } from "./harness.ts";
import { playwright, playwrightCode } from "./playwright.ts";

const host = parseHarness(
  process.argv[2],
  "Usage: node scripts/e2e-legacy-review-host.ts <pi|claude|codex> <artifacts>",
);
const artifacts = path.resolve(process.argv[3]);
fs.mkdirSync(artifacts, { recursive: true });
const f = makeFixture();
const restore = useTestModel(host);
const sourceFiles = [
  "src/review.ts",
  "src/review-pool.ts",
  "src/review-variants.ts",
  "src/store/quizzes.ts",
];
const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const loadedPackage =
  host === "codex"
    ? path.join(process.env.CODEX_HOME!, "plugins/cache/studens/studens", version)
    : ROOT;
const inventory = (root: string) =>
  Object.fromEntries(
    sourceFiles.map((file) => [
      file,
      createHash("sha256")
        .update(fs.readFileSync(path.join(root, file)))
        .digest("hex"),
    ]),
  );
const source = inventory(ROOT);
if (JSON.stringify(source) !== JSON.stringify(inventory(loadedPackage)))
  throw new Error("Native host package does not match changed review sources.");
fs.writeFileSync(
  path.join(artifacts, "loaded-source.json"),
  JSON.stringify({ loadedPackage, source }, null, 2),
);
seedClassroom(f);
seedPreparedReviewSource(f.root);
closeReviewVariants(f.root);
f.write(
  "rust/001-ownership/lesson.json",
  JSON.stringify({ title: "Legacy numeric ownership", createdAt: 2 }),
);
// Refill replays the immutable answer prompt, not the current lesson HTML.
// Keep this verification-only format example in both copies of the fixture.
const sourcePrompt =
  'Who releases a value after ownership moves? Authoring format reminder: use HTML attributes with equals signs, for example <li class="cl-q" data-question-id="fresh-id" data-type="short"><p class="cl-q-prompt">Fresh question</p><textarea></textarea></li>. Return html as a direct string in the typed response.';
const html = path.join(f.root, "rust/001-ownership/lesson.html");
fs.writeFileSync(
  html,
  fs
    .readFileSync(html, "utf8")
    .replace('data-type="short"', 'data-type="numeric"')
    .replace(
      "Prompt for q1",
      sourcePrompt.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"),
    )
    .replace("<textarea></textarea>", '<input type="number" class="cl-number">'),
);
writeGradedAttempt({
  at: Date.now() - 2 * DAY_MS,
  answers: [termAnswer("q1", "owner", { prompt: sourcePrompt })],
  correct: { q1: true },
});
const before = store.reviewItems("rust")[0];
const keyFile = path.join(f.root, "rust/001-ownership/quiz/key.json");
const originalKey = fs.readFileSync(keyFile, "utf8");
const originalGrades = JSON.stringify(store.listGrades("rust", "001-ownership"));
const listener = net.createServer();
await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
process.env.PI_CLASSROOM_SERVICE_PORT = String((listener.address() as net.AddressInfo).port);
await new Promise<void>((resolve) => listener.close(() => resolve()));
process.env.PI_CLASSROOM_TAILSCALE = "0";
process.env.PI_CLASSROOM_TEACHER = host;
const prompt = `Call begin_teaching with topic rust. Call open_classroom with classroom rust and teacher_backend ${host}. Return the loopback URL and end this turn. Do not author lessons or change the existing files. The learner will start a prepared review in the browser.`;
const [command, args] = harnessCommand(host, prompt, ["begin_teaching", "open_classroom"]);
const child = spawn(command, args, {
  cwd: f.root,
  env: { ...process.env, PI_CLASSROOMS_DIR: f.root },
  stdio: ["ignore", "pipe", "pipe"],
});
let stdout = "",
  stderr = "",
  finished = false,
  opened = false;
child.stdout.on("data", (c) => (stdout += c));
child.stderr.on("data", (c) => (stderr += c));
child.on("close", () => (finished = true));
child.on("error", (error) => {
  stderr += String(error);
  finished = true;
});
const browser = `studens-legacy-native-${host}-${process.pid}`;
try {
  await until("native initiating host exit", 185_000, () => (finished ? true : null));
  if (child.exitCode !== 0) throw new Error(`${host} initiating exit ${child.exitCode}: ${stderr}`);
  const status = await serviceStatus();
  if (!status.running || !stdout.includes(status.url!))
    throw new Error("Native initiating host did not return the persistent service URL.");
  const base = status.url!;
  const teacherBefore = readTeacherState("rust");
  if (teacherBefore?.identity.backend !== host) throw new Error("Wrong native teacher owner.");
  await playwright(browser, f.root, "open", `${base}/c/rust`);
  opened = true;
  await playwrightCode(
    browser,
    f.root,
    `async page => {
    await page.setViewportSize({width:1280,height:800});
    await page.getByRole('button',{name:'Start review',exact:true}).click();
    await page.waitForURL('**/c/rust/reviews/**');
    await page.waitForFunction(()=>document.querySelector('form.cl-quiz')?.dataset.state==='fresh');
    await page.getByLabel('The new owner',{exact:true}).check();
    await page.locator('[data-cl-assistance]').selectOption('none');
    await page.screenshot({path:${JSON.stringify(path.join(artifacts, "review-answer.png"))},fullPage:true});
    await page.getByRole('button',{name:'Submit for grading',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('form.cl-quiz')?.dataset.state==='graded');
    await page.reload();
    await page.waitForFunction(()=>document.querySelector('form.cl-quiz')?.dataset.state==='graded');
    await page.screenshot({path:${JSON.stringify(path.join(artifacts, "review-complete.png"))},fullPage:true});
    return true;
  }`,
  );
  const review = currentReview("rust")!;
  const after = store.reviewItems("rust")[0];
  if (
    review.status !== "done" ||
    after.key !== before.key ||
    after.context !== "unknown" ||
    after.objective !== undefined ||
    after.dueAt <= after.lastFeedbackAt + DAY_MS
  )
    throw new Error(
      "Native legacy review did not preserve identity and extend independent spacing.",
    );
  // Low-pool maintenance is a downstream caller of legacy rubric parsing.
  await until("native low-pool refill", 305_000, () => {
    const requests = refillRequests("rust");
    const failure = requests.find((request) => request.status === "failed");
    if (failure) throw new Error(failure.error);
    return requests.length > 0 && requests.every((request) => request.status === "done")
      ? true
      : null;
  });
  if (lessonPools("rust", "001-ownership").get("check-1/q1")!.length !== 4)
    throw new Error("Native low-pool refill did not append exactly two strict variants.");
  if (
    fs.readFileSync(keyFile, "utf8") !== originalKey ||
    JSON.stringify(store.listGrades("rust", "001-ownership")) !== originalGrades ||
    store.listGrades("rust", review.lesson).length !== 1
  )
    throw new Error("Native review/refill changed original assessments or duplicated a grade.");
  for (const route of [
    "/c/rust/001-ownership/quiz/key.json",
    "/c/rust/001-ownership/quiz/review-pool.json",
  ])
    if ((await fetch(base + route)).status !== 404)
      throw new Error("Private native pool was exposed.");
  await control("/stop", {});
  // Reopen through the real initiating host, retaining only this scratch classroom state.
  const restarted = spawn(command, args, {
    cwd: f.root,
    env: { ...process.env, PI_CLASSROOMS_DIR: f.root },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let restartOut = "",
    restartErr = "";
  restarted.stdout.on("data", (c) => (restartOut += c));
  restarted.stderr.on("data", (c) => (restartErr += c));
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      restarted.kill("SIGTERM");
      reject(new Error("Native reopen timed out."));
    }, 185_000);
    restarted.on("error", reject);
    restarted.on("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  fs.writeFileSync(path.join(artifacts, "restart.jsonl"), restartOut);
  if (exitCode !== 0) throw new Error(`Native reopen failed: ${restartErr}`);
  const reopened = await serviceStatus();
  await playwrightCode(
    browser,
    f.root,
    `async page => {
    await page.goto(${JSON.stringify(reopened.url! + lessonUrl("rust", review.lesson))});
    await page.waitForFunction(()=>document.querySelector('form.cl-quiz')?.dataset.state==='graded');
    return true;
  }`,
  );
  if (
    JSON.stringify(store.reviewItems("rust")[0]) !== JSON.stringify(after) ||
    store.listGrades("rust", review.lesson).length !== 1
  )
    throw new Error("Native restart changed spacing or graded twice.");
  fs.writeFileSync(
    path.join(artifacts, "result.json"),
    JSON.stringify(
      {
        verdict: "PASS",
        host,
        source,
        before,
        after,
        review,
        refills: refillRequests("rust"),
        teacher: readTeacherState("rust"),
        events: store.reviewEvents("rust"),
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS: native ${host} legacy numeric pool, closed independent spacing, real low-pool refill, private keys, original preservation, and restart.`,
  );
} catch (error) {
  fs.writeFileSync(
    path.join(artifacts, "failure.json"),
    JSON.stringify(
      {
        error: String(error),
        teacher: readTeacherState("rust"),
        review: currentReview("rust"),
        refills: refillRequests("rust"),
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
  fs.cpSync(path.join(f.root, "rust"), path.join(artifacts, "classroom"), { recursive: true });
  if (fs.existsSync(servicePaths().log))
    fs.copyFileSync(servicePaths().log, path.join(artifacts, "service.log"));
  f.cleanup();
  restore();
}
