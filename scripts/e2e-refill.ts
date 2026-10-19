/** Drive a saved refill failure and explicit browser retry through the real MCP host. */
import * as fs from "node:fs";
import * as path from "node:path";
import * as net from "node:net";
import * as readline from "node:readline";
import { spawn } from "node:child_process";
import { packageRoot } from "../src/paths.ts";
import { control, serviceStatus } from "../src/service-client.ts";
import { discoverRefills, refillRequests } from "../src/review-refill.ts";
import { lessonPools } from "../src/review-pool.ts";
import { readTeacherState, saveTeacherState } from "../src/service-state.ts";
import * as store from "../src/store.ts";
import {
  makeFixture,
  seedClassroom,
  seedPreparedReviewSource,
  termAnswer,
  writeGradedAttempt,
} from "../test/helpers.ts";
import { parseHarness, useTestModel, until } from "./harness.ts";
import { playwright, playwrightCode } from "./playwright.ts";

const host = parseHarness(
  process.argv[2],
  "Usage: node scripts/e2e-refill.ts <claude|codex> [artifacts]",
);
const artifacts = process.argv[3] ? path.resolve(process.argv[3]) : null;
if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
const fixture = makeFixture();
const previousPort = process.env.PI_CLASSROOM_SERVICE_PORT;
let restoreModel: (() => void) | undefined;
let child: ReturnType<typeof spawn> | undefined;
let exited: Promise<void> | undefined;
let opened = false;
const session = `studens-refill-${host}-${process.pid}`;
let stderr = "",
  stdout = "";
try {
  restoreModel = useTestModel(host);
  seedClassroom(fixture);
  seedPreparedReviewSource(fixture.root);
  writeGradedAttempt({
    at: 1,
    answers: [termAnswer("q1", "The original owner releases a moved value.")],
    correct: { q1: false },
  });
  const request = discoverRefills("rust", "service")[0];
  // A saved invalid plan exercises the same failure and retry boundary as bad provider output.
  saveTeacherState("rust", {
    version: 1,
    identity: { backend: host },
    messages: [],
    requests: [
      {
        id: request.id,
        classroom: "rust",
        lesson: request.lesson,
        kind: "refill",
        target: request.id,
        prompt: request.prompt,
        at: request.at,
        status: "planned",
        planVersion: 2,
        plan: {
          calls: [
            {
              name: "save_review_variants",
              arguments_json: JSON.stringify({
                classroom: "rust",
                request_id: "wrong-request",
                variants: [],
              }),
            },
          ],
          message: "",
          learning_record: "",
          notes_markdown: "",
        },
      },
    ],
  });
  const keyPath = path.join(fixture.root, "rust/001-ownership/quiz/key.json");
  const originalKey = fs.readFileSync(keyPath, "utf8");
  const originalGrades = store.listGrades("rust", "001-ownership");
  const socket = net.createServer();
  await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  process.env.PI_CLASSROOM_SERVICE_PORT = String(port);
  child = spawn(process.execPath, [path.join(packageRoot(), "mcp/launch.mjs")], {
    cwd: packageRoot(),
    env: { ...process.env, PI_CLASSROOM_TAILSCALE: "0" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const pending = new Map<number, (value: any) => void>();
  let sequence = 0;
  const lines = readline.createInterface({ input: child.stdout! });
  lines.on("line", (line) => {
    stdout += line + "\n";
    const message = JSON.parse(line);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  });
  child.stderr!.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  exited = new Promise((resolve) => child!.on("exit", () => resolve()));
  const call = async (method: string, params: unknown) => {
    const id = ++sequence;
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([
        new Promise<any>((resolve) => {
          pending.set(id, resolve);
          child!.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
        }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`MCP ${method} timed out: ${stderr}`)), 30_000);
        }),
      ]);
    } finally {
      clearTimeout(timer!);
      pending.delete(id);
    }
  };
  await call("initialize", { clientInfo: { name: host } });
  const openedClassroom = await call("tools/call", {
    name: "open_classroom",
    arguments: { classroom: "rust", teacher_backend: host },
  });
  if (openedClassroom.result?.isError || openedClassroom.error)
    throw new Error(JSON.stringify(openedClassroom));
  await until("saved refill rejection", 30_000, () =>
    refillRequests("rust")[0].status === "failed" ? true : null,
  );
  const base = (await serviceStatus()).url!;
  await playwright(session, fixture.root, "open", `${base}/c/rust/001-ownership`);
  opened = true;
  const shot = (name: string) =>
    artifacts
      ? `await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:${JSON.stringify(path.join(artifacts, name + ".png"))},fullPage:true});`
      : "";
  await playwrightCode(
    session,
    fixture.root,
    `async page=>{
    await page.getByRole('button',{name:'Retry request',exact:true}).waitFor();
    ${shot("failed-refill")}
    await page.reload();
    await page.getByRole('button',{name:'Retry request',exact:true}).waitFor();
    const response=page.waitForResponse(r=>r.url().endsWith('/api/teacher/retry'));
    await page.getByRole('button',{name:'Retry request',exact:true}).click();
    if(!(await response).ok())throw new Error('Explicit refill retry was refused.');
    return true;
  }`,
  );
  await until("targeted private refill", 305_000, () => {
    const saved = refillRequests("rust")[0];
    if (saved.status === "failed") throw new Error(saved.error);
    return saved.status === "done" ? true : null;
  });
  await playwrightCode(
    session,
    fixture.root,
    `async page=>{
    await page.waitForFunction(()=>!document.querySelector('.cl-teacher-requests button'));
    if(await page.locator('form.cl-quiz').getAttribute('data-state')!=='graded')throw new Error('Refill changed the locked quiz.');
    ${shot("retried-refill")}
    return true;
  }`,
  );
  if (lessonPools("rust", "001-ownership").get("check-1/q1")!.length !== 3)
    throw new Error("Targeted refill did not add exactly one variant.");
  if (
    fs.readFileSync(keyPath, "utf8") !== originalKey ||
    JSON.stringify(store.listGrades("rust", "001-ownership")) !== JSON.stringify(originalGrades)
  )
    throw new Error("Refill changed an original key or grade.");
  if (readTeacherState("rust")!.messages.length)
    throw new Error("Private refill wrote learner conversation.");
  for (const route of [
    "/c/rust/001-ownership/quiz/review-pool.json",
    "/c/rust/.review-refills.json",
  ])
    if ((await fetch(base + route)).status !== 404)
      throw new Error("A private refill file is public.");
  console.log(
    `PASS: ${host} targeted refill, saved failure, browser retry, private publication, and preserved grades`,
  );
} finally {
  if (artifacts) {
    fs.writeFileSync(path.join(artifacts, "mcp.stdout.jsonl"), stdout);
    fs.writeFileSync(path.join(artifacts, "mcp.stderr.log"), stderr);
    if (fs.existsSync(path.join(fixture.root, "rust")))
      fs.cpSync(path.join(fixture.root, "rust"), path.join(artifacts, "classroom"), {
        recursive: true,
      });
  }
  try {
    if (opened) await playwright(session, fixture.root, "close");
  } finally {
    child?.stdin?.end();
    if (exited) await exited;
    if ((await serviceStatus()).running) await control("/stop", {});
    restoreModel?.();
    if (previousPort === undefined) delete process.env.PI_CLASSROOM_SERVICE_PORT;
    else process.env.PI_CLASSROOM_SERVICE_PORT = previousPort;
    fixture.cleanup();
  }
}
