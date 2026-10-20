/** Actual Pi extension exit/reconnect and durable teacher recovery through browser controls. */
import * as fs from "node:fs";
import * as path from "node:path";
import * as net from "node:net";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { makeFixture, seedClassroom, lessonHtml } from "../test/helpers.ts";
import { control, ensureService, serviceStatus, servicePaths } from "../src/service-client.ts";
import { readTeacherState } from "../src/service-state.ts";
import * as store from "../src/store.ts";
import { useTestModel, TEST_MODELS, ROOT } from "./harness.ts";
import { playwright, playwrightCode } from "./playwright.ts";

export async function verifyPiLifecycle(artifacts: string): Promise<void> {
  fs.mkdirSync(artifacts, { recursive: true });
  const restore = useTestModel("pi"),
    f = makeFixture();
  seedClassroom(f);
  f.write(
    "rust/001-ownership/lesson.html",
    lessonHtml(
      "Ownership",
      '<p>Every value in Rust has one owner. When the owner leaves scope, the value is dropped.</p><form class="cl-quiz" data-quiz-id="check-1"><ol class="cl-questions"><li class="cl-q" data-question-id="q1" data-type="term"><p class="cl-q-prompt">What happens when the owner leaves scope?</p><input type="text"></li></ol></form>',
    ),
  );
  f.write("rust/001-ownership/quiz/key.json", '{"q1":"dropped"}');
  const listener = net.createServer();
  await new Promise<void>((r) => listener.listen(0, "127.0.0.1", r));
  process.env.PI_CLASSROOM_SERVICE_PORT = String((listener.address() as net.AddressInfo).port);
  await new Promise<void>((r) => listener.close(() => r()));
  process.env.PI_CLASSROOM_TAILSCALE = "0";
  const events: any[] = [],
    owned: ReturnType<typeof spawn>[] = [];
  const browser = `studens-pi-lifecycle-${process.pid}`;
  let browserOpen = false;
  function launch() {
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
        "--no-context-files",
        "--no-prompt-templates",
        "--no-themes",
        "--offline",
        "--extension",
        path.join(ROOT, "index.ts"),
      ],
      {
        cwd: f.root,
        env: { ...process.env, PI_CLASSROOMS_DIR: f.root },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    owned.push(child);
    let buffer = "";
    child.stdout!.on("data", (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (line) events.push({ pid: child.pid, ...JSON.parse(line) });
      }
    });
    child.stderr!.on("data", (chunk) => events.push({ pid: child.pid, stderr: String(chunk) }));
    return child;
  }
  async function wait<T>(label: string, probe: () => T | null | Promise<T | null>): Promise<T> {
    const until = Date.now() + 185_000;
    while (Date.now() < until) {
      const result = await probe();
      if (result !== null) return result;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`Timed out waiting for ${label}.`);
  }
  async function command(child: ReturnType<typeof spawn>, id: string, message: string) {
    child.stdin!.write(JSON.stringify({ id, type: "prompt", message }) + "\n");
    const event = await wait<any>(
      id,
      () => events.find((e) => e.pid === child.pid && e.id === id && e.type === "response") ?? null,
    );
    if (!event.success) throw new Error(JSON.stringify(event));
  }
  async function close(child: ReturnType<typeof spawn>) {
    const closed = new Promise<void>((r) => child.once("close", () => r()));
    child.kill("SIGTERM");
    await closed;
  }
  const saved = () => readTeacherState("rust")!;
  async function settled() {
    await wait("all teacher work", () => {
      const s = saved();
      const failed = s.requests.find((r) => r.status === "failed");
      if (failed) throw new Error(failed.error);
      return s.requests.every((r) => r.status === "done") ? s : null;
    });
  }
  const sessionHash = () =>
    createHash("sha256")
      .update(
        fs.readFileSync(path.join(servicePaths().dir, "pi-sessions", saved().identity.sessionId!)),
      )
      .digest("hex");
  try {
    const first = launch();
    await command(first, "start", "/classroom start");
    await command(first, "open", "/classroom rust");
    const initial = await serviceStatus();
    const base = initial.url;
    if (
      !events.some(
        (e) =>
          e.method === "setWidget" &&
          e.widgetLines?.some((line: string) => line.includes(String(initial.port))),
      )
    )
      throw new Error("Pi widget did not report the persistent service port.");
    await command(first, "status", "/classroom status");
    await playwright(browser, f.root, "open", `${base}/c/rust/001-ownership#cl-teacher`);
    browserOpen = true;
    await playwrightCode(
      browser,
      f.root,
      `async page=>{await page.getByLabel('Reply to your teacher',{exact:true}).fill('Explain ownership in Rust with one brief worked example; do not record learning evidence.');await page.getByRole('button',{name:'Send reply',exact:true}).click();return {};}`,
    );
    await wait("Pi teacher running", () =>
      saved().requests.some((r) => r.status === "running") ? true : null,
    );
    await close(first);
    if (!(await serviceStatus()).running || (await serviceStatus()).pid !== initial.pid)
      throw new Error("Closing initiating Pi stopped/replaced the service.");
    await playwrightCode(
      browser,
      f.root,
      `async page=>{const second=await page.context().newPage();await second.goto(${JSON.stringify(base + "/c/rust/001-ownership#cl-teacher")});await second.getByLabel('Reply to your teacher',{exact:true}).fill('Explain which owner drops a moved value; do not record learning evidence.');const sent=second.waitForResponse(r=>r.url().endsWith('/api/teacher/chat')&&r.request().method()==='POST');await second.getByRole('button',{name:'Send reply',exact:true}).click();if((await sent).status()!==201)throw new Error('Second-tab reply refused');await second.close();await page.getByLabel('Reply to your teacher',{exact:true}).fill('Explain why a moved-from binding cannot free the same value; do not record learning evidence.');const sentMain=page.waitForResponse(r=>r.url().endsWith('/api/teacher/chat')&&r.request().method()==='POST');await page.getByRole('button',{name:'Send reply',exact:true}).click();if((await sentMain).status()!==201)throw new Error('Main-tab reply refused');return {};}`,
    );
    await settled();
    const fifo = saved().requests;
    if (fifo.length !== 3 || fifo.some((r, i) => i > 0 && r.startedAt! < fifo[i - 1].finishedAt!))
      throw new Error("Pi requests did not finish in saved FIFO order.");
    const publicState = await (
      await fetch(`${base}/api/state?classroom=rust&lesson=001-ownership`)
    ).json();
    if (publicState.teacher.requests.some((r: any) => r.prompt || r.plan || r.modelOutput))
      throw new Error("Public Pi state exposed private teacher work.");
    const identity = saved().identity;
    if (
      identity.backend !== "pi" ||
      identity.activeModel !== `${TEST_MODELS.pi.provider}/${TEST_MODELS.pi.model}`
    )
      throw new Error("Wrong dedicated Pi model.");
    const privateFile = path.join(servicePaths().dir, "pi-sessions", identity.sessionId!);
    fs.mkdirSync(path.join(f.root, "rust/assets"), { recursive: true });
    fs.symlinkSync(privateFile, path.join(f.root, "rust/assets/pi-history.jsonl"));
    for (const route of [
      "/.pi-teach-service/pi-sessions/" + identity.sessionId,
      "/c/rust/.teacher.json",
      "/c/rust/assets/pi-history.jsonl",
      "/doc/rust/assets/pi-history.jsonl",
    ])
      if ((await fetch(base + route)).status !== 404)
        throw new Error(`Private Pi route readable: ${route}`);
    const second = launch();
    await command(second, "reconnect", "/classroom rust");
    if (
      (await serviceStatus()).pid !== initial.pid ||
      saved().identity.sessionId !== identity.sessionId
    )
      throw new Error("New Pi replaced service or teacher session.");
    await close(second);
    await playwrightCode(
      browser,
      f.root,
      `async page=>{await page.goto(${JSON.stringify(base + "/c/rust/settings")});await page.getByLabel('Teacher model',{exact:true}).selectOption('__custom__');await page.getByLabel('Model ID',{exact:true}).fill('openai-codex/studens-unavailable-model');await page.getByRole('button',{name:'Save teacher model',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved for the next'}).waitFor();await page.goto(${JSON.stringify(base + "/c/rust/001-ownership#cl-teacher")});await page.getByLabel('Reply to your teacher',{exact:true}).fill('Name the scope rule without recording learning evidence.');await page.getByRole('button',{name:'Send reply',exact:true}).click();await page.getByRole('button',{name:'Retry request',exact:true}).waitFor();await page.screenshot({path:${JSON.stringify(path.join(artifacts, "pi-unavailable.png"))},fullPage:true});return {};}`,
    );
    const failed = saved().requests.at(-1)!;
    if (failed.status !== "failed" || !failed.error?.includes("unavailable"))
      throw new Error("Unavailable Pi model was not a specific durable failure.");
    await playwrightCode(
      browser,
      f.root,
      `async page=>{await page.goto(${JSON.stringify(base + "/c/rust/settings")});await page.getByLabel('Teacher model',{exact:true}).selectOption('');await page.getByRole('button',{name:'Save teacher model',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved for the next'}).waitFor();return {};}`,
    );
    if (saved().requests.at(-1)!.status !== "failed")
      throw new Error("Selection silently retried Pi failure.");
    await playwrightCode(
      browser,
      f.root,
      `async page=>{await page.goto(${JSON.stringify(base + "/c/rust/001-ownership#cl-teacher")});await page.getByRole('button',{name:'Retry request',exact:true}).click();return {};}`,
    );
    await settled();
    // Fail the actual grade write after its actual Pi plan is saved; preserve the plan.
    const grades = path.join(f.root, "rust/001-ownership/quiz/grades");
    fs.mkdirSync(grades, { recursive: true });
    fs.chmodSync(grades, 0o500);
    await playwrightCode(
      browser,
      f.root,
      `async page=>{const form=page.locator('form.cl-quiz');await form.locator('input[type="text"]').fill('forever');await form.getByRole('button',{name:'Submit for grading',exact:true}).click();await page.getByRole('button',{name:'Retry request',exact:true}).waitFor();return {};}`,
    );
    const gradeRequest = saved().requests.find((r) => r.kind === "quiz")!;
    if (
      gradeRequest.status !== "failed" ||
      !gradeRequest.planValidated ||
      !gradeRequest.plan ||
      (gradeRequest.applied ?? 0) !== 0
    )
      throw new Error("Did not retain a valid unapplied Pi grade plan after the write failure.");
    fs.writeFileSync(
      path.join(artifacts, "saved-plan-before-restart.json"),
      JSON.stringify(saved(), null, 2),
    );
    const hash = sessionHash();
    fs.chmodSync(grades, 0o700);
    await control("/stop", {});
    await wait("service stop", async () => (!(await serviceStatus()).running ? true : null));
    await ensureService();
    if (saved().requests.find((r) => r.id === gradeRequest.id)!.status !== "failed")
      throw new Error("Restart silently retried the saved failed plan.");
    await playwrightCode(
      browser,
      f.root,
      `async page=>{await page.reload();await page.getByRole('button',{name:'Retry request',exact:true}).click();await page.waitForFunction(()=>document.querySelector('form.cl-quiz')?.dataset.state==='graded');await page.screenshot({path:${JSON.stringify(path.join(artifacts, "pi-recovered-grade.png"))},fullPage:true});return {};}`,
    );
    await settled();
    if (store.listGrades("rust", "001-ownership").length !== 1 || sessionHash() !== hash)
      throw new Error("Saved Pi plan regenerated inference or duplicated its grade.");
    const recoveredPlan = saved().requests.find((r) => r.id === gradeRequest.id)!;
    if (JSON.stringify(recoveredPlan.plan) !== JSON.stringify(gradeRequest.plan))
      throw new Error("Recovery replaced the saved Pi plan.");
    const savedGrades = JSON.stringify(store.listGrades("rust", "001-ownership"));
    await control("/stop", {});
    await wait("second service stop", async () => (!(await serviceStatus()).running ? true : null));
    await ensureService();
    if (
      store.listGrades("rust", "001-ownership").length !== 1 ||
      sessionHash() !== hash ||
      saved().identity.sessionId !== identity.sessionId ||
      JSON.stringify(store.listGrades("rust", "001-ownership")) !== savedGrades
    )
      throw new Error("Second recovery changed teacher/history.");
    const sessionText = fs.readFileSync(
      path.join(servicePaths().dir, "pi-sessions", identity.sessionId!),
      "utf8",
    );
    if (
      !sessionText
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .some(
          (e) => e.type === "thinking_level_change" && e.thinkingLevel === TEST_MODELS.pi.effort,
        )
    )
      throw new Error("Dedicated Pi session did not record low thinking.");
    fs.writeFileSync(
      path.join(artifacts, "lifecycle.json"),
      JSON.stringify(
        {
          initial,
          identity,
          fifo,
          failed,
          savedPlanId: gradeRequest.id,
          conversationHash: hash,
          grade: store.listGrades("rust", "001-ownership"),
          final: saved(),
        },
        null,
        2,
      ),
    );
    const finalHost = launch();
    await command(finalHost, "stop", "/classroom stop");
    await wait("Pi command stop", async () => (!(await serviceStatus()).running ? true : null));
    await close(finalHost);
    const extensionErrors = events.filter((event) => event.type === "extension_error");
    if (extensionErrors.length) throw new Error(JSON.stringify(extensionErrors));
    console.log(
      "PASS: actual Pi exit during work, FIFO across browser actions, reconnect, specific model failure, explicit retry, saved-plan restart with one grade and no inference, stable dedicated Pi session/SDK model selection/low thinking.",
    );
  } finally {
    fs.writeFileSync(
      path.join(artifacts, "initiating-pi-events.json"),
      JSON.stringify(events, null, 2),
    );
    fs.cpSync(path.join(f.root, "rust"), path.join(artifacts, "classroom"), { recursive: true });
    if (fs.existsSync(servicePaths().dir))
      fs.cpSync(servicePaths().dir, path.join(artifacts, "service"), { recursive: true });
    for (const child of owned)
      if (child.exitCode === null && child.signalCode === null) await close(child);
    if (browserOpen) await playwright(browser, f.root, "close");
    if ((await serviceStatus()).running) {
      await control("/stop", {});
      await wait("cleanup stop", async () => (!(await serviceStatus()).running ? true : null));
    }
    f.cleanup();
    restore();
  }
}
