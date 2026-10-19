/** Real model selection through settings, across active work and persistent service restart. */
import * as fs from "node:fs";
import * as path from "node:path";
import * as net from "node:net";
import { createHash } from "node:crypto";
import { makeFixture, seedClassroom, writeGradedAttempt, termAnswer } from "../test/helpers.ts";
import { notesStub } from "../src/prompts.ts";
import { useTestModel, TEST_MODELS, parseHarness } from "./harness.ts";
import { control, ensureService, serviceStatus, servicePaths } from "../src/service-client.ts";
import { readTeacherState } from "../src/service-state.ts";
import * as store from "../src/store.ts";
import { playwright, playwrightCode } from "./playwright.ts";

const backend = parseHarness(
  process.argv[2],
  "Usage: node scripts/e2e-settings.ts <claude|codex> [artifacts]",
);
const artifacts = path.resolve(
  process.argv[3] ?? `/tmp/studens-settings-${backend}-${process.pid}`,
);
fs.mkdirSync(artifacts, { recursive: true });
const restore = useTestModel(backend),
  f = makeFixture();
seedClassroom(f);
seedClassroom(f, { classroom: "algebra" });
f.write("rust/NOTES.md", notesStub());
f.write("rust/001-ownership/quiz/key.json", '{"q1":"dropped"}');
writeGradedAttempt({
  at: Date.now() - 10000,
  answers: [termAnswer("q1", "dropped")],
  correct: { q1: true },
});
const grades = () => JSON.stringify(store.listGrades("rust", "001-ownership"));
const originalGrades = grades();
const listener = net.createServer();
await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
process.env.PI_CLASSROOM_SERVICE_PORT = String((listener.address() as net.AddressInfo).port);
await new Promise<void>((resolve) => listener.close(() => resolve()));
process.env.PI_CLASSROOM_TAILSCALE = "0";
process.env.PI_CLASSROOM_CONFIG = f.write("config.json", '{"tailscale":false}');
const selected = backend === "claude" ? "sonnet" : "gpt-6.1-sol";
const unavailable = "studens-unavailable-model-verification";
const session = `studens-model-settings-${backend}-${process.pid}`;
const report: any = {
  backend,
  fixedSettings: TEST_MODELS[backend],
  deliberateSelection: selected,
  observations: [],
  artifacts,
};
let opened = false;
let base: string;
const shot = (name: string) =>
  `await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:${JSON.stringify(path.join(artifacts, name + ".png"))},fullPage:true});`;
async function settings(): Promise<any> {
  return (await fetch(`${base}/api/settings?classroom=rust`)).json();
}
async function until(
  label: string,
  predicate: () => Promise<boolean>,
  timeout = 190_000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}
async function waitDone(count: number, failed = false): Promise<void> {
  await until(`request ${count} ${failed ? "failure" : "completion"}`, async () => {
    const state = readTeacherState("rust");
    if (!state || state.requests.length < count) return false;
    const last = state.requests[count - 1];
    if (last.status === "failed" && !failed) throw new Error(last.error);
    return last.status === (failed ? "failed" : "done");
  });
}
async function choose(model: string | null): Promise<void> {
  await playwrightCode(
    session,
    f.root,
    `async page=>{
 await page.goto(${JSON.stringify(base + "/c/rust/settings")});
 await page.getByRole('button',{name:'Reload models',exact:true}).waitFor({state:'visible'});
 await page.getByRole('button',{name:'Reload models',exact:true}).isEnabled();
 const field=page.getByLabel('Teacher model',{exact:true});
 ${model === unavailable ? `await field.selectOption('__custom__');await page.getByLabel('Model ID',{exact:true}).fill(${JSON.stringify(model)});` : `await field.selectOption(${JSON.stringify(model ?? "")});`}
 await page.getByRole('button',{name:'Save teacher model',exact:true}).click();
 await page.getByRole('status').filter({hasText:'Saved for the next'}).waitFor();return {};
}`,
  );
}
async function reply(text: string): Promise<void> {
  await playwrightCode(
    session,
    f.root,
    `async page=>{
 await page.goto(${JSON.stringify(base + "/c/rust/001-ownership#cl-teacher")});
 await page.getByLabel('Reply to your teacher',{exact:true}).fill(${JSON.stringify(text)});
 await page.getByRole('button',{name:'Send reply',exact:true}).click();return {};
}`,
  );
}
try {
  const service = await ensureService();
  base = service.url;
  const response = await control("/rpc", {
    client: "settings-verification",
    backend,
    message: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "open_classroom",
        arguments: { classroom: "rust", teacher_backend: backend },
      },
    },
  });
  if (response.result.isError) throw new Error(response.result.content[0].text);
  await control("/disconnect", { client: "settings-verification" });
  const models = await (await fetch(`${base}/api/settings/models?classroom=rust`)).json();
  report.catalog = models;
  if (!models.models?.some((model: any) => model.id === selected))
    throw new Error(`The installed catalog does not offer deliberate selection ${selected}.`);
  await playwright(session, f.root, "open", `${base}/c/rust/settings`);
  opened = true;
  await playwrightCode(
    session,
    f.root,
    `async page=>{await page.getByLabel('Teacher model',{exact:true}).waitFor();await page.setViewportSize({width:1280,height:800});${shot("default-before-answer")}return {};}`,
  );
  await reply(
    "Explain Rust ownership carefully with three distinct worked examples and their scope boundaries, then ask me one new short question. Put the complete explanation in your message. I have not answered any question yet, so do not record retrieval evidence.",
  );
  await until("active first request", async () => Boolean((await settings()).teacher?.running));
  await choose(selected);
  const during = await settings();
  report.observations.push({ step: "selected-during-work", settings: during });
  if (!during.teacher?.running || during.teacher.running.requestedModel !== null)
    throw new Error(
      "Active-request model change was not observed before the first request completed.",
    );
  await playwrightCode(session, f.root, `async page=>{${shot("selection-during-work")}return {};}`);
  await waitDone(1);
  await playwrightCode(
    session,
    f.root,
    `async page=>{await page.getByText(${JSON.stringify("Last answering model: " + TEST_MODELS[backend].model)},{exact:true}).waitFor();return {};}`,
  );
  let saved = readTeacherState("rust")!;
  const identity = saved.identity.sessionId;
  if (
    saved.requests[0].requestedModel !== null ||
    saved.requests[0].resolvedModel !== TEST_MODELS[backend].model
  )
    throw new Error("First request did not retain the fixed configured model.");
  report.observations.push({
    step: "first-answer",
    identity: saved.identity,
    request: saved.requests[0],
  });
  await reply(
    "Give me one more short question about moving ownership. Do not record evidence because I am asking a question rather than answering.",
  );
  await waitDone(2);
  saved = readTeacherState("rust")!;
  if (
    saved.identity.sessionId !== identity ||
    saved.requests[1].requestedModel !== selected ||
    !saved.requests[1].resolvedModel ||
    saved.requests[1].resolvedModel === TEST_MODELS[backend].model
  )
    throw new Error("Selected model did not change while retaining the conversation.");
  report.observations.push({
    step: "selected-answer",
    identity: saved.identity,
    request: saved.requests[1],
  });
  await playwrightCode(
    session,
    f.root,
    `async page=>{await page.goto(${JSON.stringify(base + "/c/rust/settings")});await page.getByText(${JSON.stringify("Last answering model: " + saved.identity.activeModel)},{exact:true}).waitFor();${shot("selected-active-desktop")}await page.setViewportSize({width:375,height:812});${shot("selected-active-mobile")}if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Mobile settings overflow.');return {};}`,
  );
  await control("/stop", {});
  await until("owned service stop", async () => !(await serviceStatus()).running, 10_000);
  base = (await ensureService()).url;
  const restarted = await settings();
  report.observations.push({ step: "service-restart", settings: restarted });
  if (
    restarted.teacher?.identity.requestedModel !== selected ||
    restarted.teacher.identity.sessionId !== identity
  )
    throw new Error("Model or conversation lost over persistent service restart.");
  if (readTeacherState("algebra"))
    throw new Error("Model settings wrote another classroom's teacher state.");
  await choose(unavailable);
  await reply("Ask one ownership question using my selected model.");
  await waitDone(3, true);
  const failed = readTeacherState("rust")!;
  report.observations.push({
    step: "unavailable",
    identity: failed.identity,
    request: failed.requests[2],
  });
  if (!failed.requests[2].error?.includes(unavailable))
    throw new Error("Model error did not identify the unavailable selection.");
  if (failed.identity.activeModel !== saved.identity.activeModel)
    throw new Error("Unavailable model invented an active model.");
  await playwrightCode(
    session,
    f.root,
    `async page=>{await page.reload();await page.getByRole('button',{name:'Retry request',exact:true}).waitFor();${shot("unavailable-lesson")}await page.goto(${JSON.stringify(base + "/c/rust/settings")});await page.locator('[data-teacher-error]').filter({hasText:${JSON.stringify(unavailable)}}).waitFor();${shot("unavailable-settings")}return {};}`,
  );
  await choose(null);
  if (readTeacherState("rust")!.requests[2].status !== "failed")
    throw new Error("Choosing another model retried a request without permission.");
  await playwrightCode(
    session,
    f.root,
    `async page=>{await page.goto(${JSON.stringify(base + "/c/rust/001-ownership#cl-teacher")});await page.getByRole('button',{name:'Retry request',exact:true}).click();return {};}`,
  );
  await waitDone(3);
  saved = readTeacherState("rust")!;
  if (
    saved.identity.sessionId !== identity ||
    saved.requests[2].requestedModel !== null ||
    saved.requests[2].resolvedModel !== TEST_MODELS[backend].model
  )
    throw new Error(
      "Explicit retry failed to return to the configured model in the same conversation.",
    );
  if (grades() !== originalGrades)
    throw new Error("Model changes or recovery rewrote the saved grade.");
  report.observations.push({
    step: "explicit-retry-default",
    state: saved,
    gradeDigest: createHash("sha256").update(grades()).digest("hex"),
  });
  report.verdict = "PASS";
  console.log(
    `PASS: ${backend} default ${TEST_MODELS[backend].model}, explicit ${selected} resolved ${saved.requests[1].resolvedModel}, active-work boundary, persistent restart, unavailable error, explicit retry, unchanged grade and same session ${identity}.`,
  );
} catch (error) {
  report.verdict = "FAIL";
  report.error = String(error);
  throw error;
} finally {
  fs.writeFileSync(path.join(artifacts, "settings-report.json"), JSON.stringify(report, null, 2));
  if (fs.existsSync(servicePaths().log))
    fs.copyFileSync(servicePaths().log, path.join(artifacts, "service.log"));
  fs.cpSync(path.join(f.root, "rust"), path.join(artifacts, "classroom"), { recursive: true });
  if (opened) await playwright(session, f.root, "close");
  if ((await serviceStatus()).running) {
    await control("/stop", {});
    await until("cleanup", async () => !(await serviceStatus()).running, 10_000);
  }
  f.cleanup();
  restore();
}
