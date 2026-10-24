/** Exercise process lifetime through the actual MCP launcher and service. */
import * as fs from "node:fs";
import * as path from "node:path";
import * as net from "node:net";
import * as readline from "node:readline";
import { pathToFileURL } from "node:url";
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  makeFixture,
  seedClassroom,
  seedHistoricalReview,
  seedPreparedReviewSource,
  writeGradedAttempt,
  termAnswer,
  type Fixture,
} from "./helpers.ts";
import { currentReview } from "../src/review-session.ts";
import { readTeacherState } from "../src/service-state.ts";
import * as store from "../src/store.ts";
import { _overrideClassroomsDir, packageRoot } from "../src/paths.ts";
import { control, ensureService, servicePaths, serviceStatus } from "../src/service-client.ts";
import {
  readOwnedService,
  serviceOwnerExited,
  type ServiceOwner,
} from "./service-process-owner.ts";

let f: Fixture, env: NodeJS.ProcessEnv, originalPort: string | undefined;
let acknowledgedStop: ServiceOwner | undefined;
const mcpChildren = new Map<ChildProcessWithoutNullStreams, Promise<void>>();
beforeEach(async () => {
  acknowledgedStop = undefined;
  f = makeFixture();
  seedClassroom(f);
  f.write("rust/001-ownership/quiz/key.json", '{"q1":"dropped"}');
  const socket = net.createServer();
  await new Promise<void>((r) => socket.listen(0, "127.0.0.1", r));
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>((r) => socket.close(() => r()));
  originalPort = process.env.PI_CLASSROOM_SERVICE_PORT;
  process.env.PI_CLASSROOM_SERVICE_PORT = String(port);
  const bin = path.join(f.root, "bin");
  fs.mkdirSync(bin);
  f.write("behavior.json", "{}");
  fs.writeFileSync(
    path.join(bin, "codex"),
    `#!${process.execPath}\n` +
      String.raw`
const readline = require('node:readline');
const fs = require('node:fs');
const path = require('node:path');
const behaviorFile = path.join(process.cwd(), '../behavior.json');
const behavior = JSON.parse(fs.readFileSync(behaviorFile, 'utf8'));
const lines = readline.createInterface({input:process.stdin});
const send = value => process.stdout.write((behavior.packed && value.id ? '{"method":"test/progress","params":{}}' : '') + JSON.stringify(value) + '\n');
lines.on('line', line => {
 const m = JSON.parse(line);
 if (!m.id) return;
 if (m.method === 'initialize') send({id:m.id,result:{}});
 else if (m.method === 'mcpServerStatus/list') send({id:m.id,result:{data:[],nextCursor:null}});
 else if (m.method === 'config/read') send({id:m.id,result:{config:{model:'fixture-model'}}});
 else if (m.method === 'model/list') send({id:m.id,result:{data:[{id:'fixture-model',model:'fixture-model',displayName:'Fixture model',isDefault:true}],nextCursor:null}});
 else if (m.method === 'thread/start' || m.method === 'thread/resume') send({id:m.id,result:{model:m.params.model,thread:{id:m.params.threadId || 'test-dedicated-session'}}});
 else if (m.method === 'turn/start') {
  if (m.params.input[0].text.startsWith('Readiness check only.')) {
   send({id:m.id,result:{turn:{id:'ready'}}});
   send({method:'item/completed',params:{threadId:m.params.threadId,turnId:'ready',item:{type:'agentMessage',text:JSON.stringify({calls:[],message:'Ready.',learning_record:null,notes_markdown:''})}}});
   send({method:'turn/completed',params:{threadId:m.params.threadId,turn:{id:'ready',status:'completed'}}});
   return;
  }
  if (behavior.invalid) { process.stdout.write('diagnostic text\n'); return; }
  if (behavior.truncated) { process.stdout.write('{"method":'); process.exit(0); return; }
  const prompt = m.params.input[0].text;
  const ask = /annotation_id: "([^"]+)"/.exec(prompt);
  const quiz = /submission_id: "([^"]+)"/.exec(prompt);
  const calls = ask ? [{name:'answer_lesson_question',arguments_json:JSON.stringify({annotation_id:ask[1],answer_markdown:'The owner releases the value.'})}] :
   quiz ? [{name:'grade_quiz_answers',arguments_json:JSON.stringify({submission_id:quiz[1],feedback_markdown:'Check the lifetime.',questions:[{question_id:'q1',correct:false,feedback:'The value is dropped.'}]})}] : [];
  send({id:m.id,result:{turn:{id:'test-turn'}}});
  const finish = () => {
  if (behavior.foreign) {
   send({method:'item/completed',params:{threadId:'other-thread',turnId:'other-turn',item:{type:'agentMessage',text:'not a plan'}}});
   send({method:'turn/completed',params:{threadId:'other-thread',turn:{id:'other-turn',status:'failed',error:{message:'unrelated failure'}}}});
  }
  send({method:'item/completed',params:{threadId:'test-dedicated-session',turnId:'test-turn',item:{type:'agentMessage',text:JSON.stringify(ask ? {annotation_id:ask[1],answer_markdown:'The owner releases the value.'} : {calls,message:'What happens with another owner?',learning_record:null,notes_markdown:''})}}});
  send({method:'turn/completed',params:{threadId:'test-dedicated-session',turn:{id:'test-turn',status:'completed'}}});
  };
  if (behavior.gate) {
   fs.appendFileSync(path.join(process.cwd(), '../turns.log'), quiz[1] + '\n');
   const timer = setInterval(() => {
    if (behavior.progress) send({method:'item/agentMessage/delta',params:{threadId:'test-dedicated-session',turnId:'test-turn',delta:'working'}});
    if (behavior.noise) send({method:'item/agentMessage/delta',params:{threadId:'unrelated-thread',turnId:'unrelated-turn',delta:'working'}});
    if (fs.existsSync(path.join(process.cwd(), '../release'))) { clearInterval(timer); finish(); }
   }, 50);
  } else finish();
 }
});
`,
    { mode: 0o700 },
  );
  env = {
    ...process.env,
    PI_CLASSROOMS_DIR: f.root,
    PI_CLASSROOM_TAILSCALE: "0",
    PATH: `${bin}:${process.env.PATH}`,
  };
});
afterEach(async () => {
  _overrideClassroomsDir(f.root);
  const paths = servicePaths();
  try {
    for (const child of mcpChildren.keys()) child.stdin.end();
    await Promise.all(mcpChildren.values());
    mcpChildren.clear();
    const owner = readOwnedService(paths.lock, {
      packageRoot: packageRoot(),
      port: Number(env.PI_CLASSROOM_SERVICE_PORT),
    });
    if (owner) {
      // Cleanup also runs after a failed assertion or an acknowledged stop.
      // Signal only this fixture's recorded owner; never probe its closing listener.
      if (acknowledgedStop?.pid !== owner.pid) {
        try {
          process.kill(owner.pid, "SIGTERM");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
      }
      await waitFor(async () => serviceOwnerExited(owner, paths));
    }
    expect(fs.existsSync(paths.socket)).toBe(false);
    // Retain scratch evidence if teardown fails.
    f.cleanup();
  } finally {
    if (originalPort === undefined) delete process.env.PI_CLASSROOM_SERVICE_PORT;
    else process.env.PI_CLASSROOM_SERVICE_PORT = originalPort;
  }
});
function client(gateStartup = false) {
  const args = gateStartup
    ? ["--import", path.join(packageRoot(), "test/service-process-startup.mjs")]
    : [];
  const child = spawn(process.execPath, [...args, path.join(packageRoot(), "mcp/launch.mjs")], {
    cwd: packageRoot(),
    env,
    stdio: gateStartup ? ["pipe", "pipe", "pipe", "ipc"] : ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;
  const lines = readline.createInterface({ input: child.stdout });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const pending = new Map<number, (value: any) => void>();
  let id = 0;
  lines.on("line", (line) => {
    const m = JSON.parse(line);
    pending.get(m.id)?.(m);
    pending.delete(m.id);
  });
  const exited = new Promise<void>((r) => child.on("close", () => r()));
  mcpChildren.set(child, exited);
  const startups: Array<ServiceOwner & { root: string }> = [];
  const startupExits = new Map<number, { code: number; signal: string | null }>();
  let startupDecision: { winner: number; path: string } | undefined;
  child.on("message", (message: any) => {
    if (message.type === "fixture-service-held") startups.push(message);
    if (message.type === "fixture-service-exit") startupExits.set(message.pid, message);
    if (message.type === "fixture-startup-decision")
      startupDecision = { winner: message.winner, path: message.path };
  });
  return {
    startups,
    startupExits,
    startupDecision: () => startupDecision,
    releaseStartup(pid: number) {
      if (!startups.some((owner) => owner.pid === pid))
        throw new Error("Cannot release an unrecorded startup fixture child.");
      child.send({ type: "fixture-release-startup", pid });
    },
    child,
    exited,
    stderr: () => stderr,
    async call(method: string, params: unknown = {}) {
      const key = ++id;
      const reply = new Promise<any>((resolve) => pending.set(key, resolve));
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: key, method, params }) + "\n");
      return reply;
    },
  };
}
it.each(["codex", "claude"])(
  "stops explicitly before %s MCP exit without detaching again",
  async (name) => {
    const c = client();
    try {
      await c.call("initialize", { clientInfo: { name } });
      await c.call("tools/list");
      for (const action of ["status", "stop"]) {
        const response = await c.call("tools/call", {
          name: "classroom_service",
          arguments: { action },
        });
        expect(JSON.parse(response.result.content[0].text)).toMatchObject({
          running: false,
          root: f.root,
        });
        expect((await serviceStatus()).running).toBe(false);
      }
      const response = await c.call("tools/call", {
        name: "classroom_service",
        arguments: { action: "start" },
      });
      const status = JSON.parse(response.result.content[0].text);
      expect(status.root).toBe(f.root);
      expect(status.packageRoot).toBe(packageRoot());
      expect(status.port).toBe(Number(env.PI_CLASSROOM_SERVICE_PORT));
      expect(readOwnedService(servicePaths().lock, status)?.pid).toBe(status.pid);
      expect((await fetch(status.url)).status).toBe(200);
      const stopped = await c.call("tools/call", {
        name: "classroom_service",
        arguments: { action: "stop" },
      });
      if (
        stopped.result?.isError === false &&
        JSON.parse(stopped.result.content[0].text).stopping === true
      )
        acknowledgedStop = status;
      expect(stopped.result.isError).toBe(false);
      expect(JSON.parse(stopped.result.content[0].text).stopping).toBe(true);
      // The ACK precedes listener teardown. A new connection during close can reset.
      await waitFor(async () => serviceOwnerExited(status, servicePaths()));
      expect((await serviceStatus()).running).toBe(false);
    } finally {
      c.child.stdin.end();
      await c.exited;
    }
    expect(c.child.exitCode).toBe(0);
    expect(c.stderr()).not.toContain("detach failed");
  },
  30_000,
);

it("keeps a refused explicit stop visible and HTTP live after MCP exit", async () => {
  const c = client();
  const phone = path.join(f.root, ".pi-teach-service/phone.json");
  try {
    await c.call("initialize", { clientInfo: { name: "codex" } });
    const started = await c.call("tools/call", {
      name: "classroom_service",
      arguments: { action: "start" },
    });
    const status = JSON.parse(started.result.content[0].text);
    fs.writeFileSync(phone, "{}");
    const stopped = await c.call("tools/call", {
      name: "classroom_service",
      arguments: { action: "stop" },
    });
    expect(stopped.result.isError).toBe(true);
    expect(stopped.result.content[0].text).toContain("Invalid phone route ownership file.");
    c.child.stdin.end();
    await c.exited;
    expect((await serviceStatus()).pid).toBe(status.pid);
    expect((await fetch(status.url)).status).toBe(200);
    expect(fs.readFileSync(phone, "utf8")).toBe("{}");
    expect(c.stderr()).not.toContain("detach failed");
  } finally {
    fs.rmSync(phone, { force: true });
    c.child.stdin.end();
    await c.exited;
  }
}, 30_000);
async function waitFor(probe: () => Promise<boolean>) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Process fixture did not finish.");
}
it.each([undefined, "   "])("rejects an unconfigured service root: %j", async (root) => {
  const home = path.join(f.root, "isolated-home");
  const bootstrap = f.write(
    "home.mjs",
    `import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
os.homedir = () => ${JSON.stringify(home)};
syncBuiltinESMExports();`,
  );
  await expect(
    promisify(execFile)(
      process.execPath,
      ["--import", bootstrap, path.join(packageRoot(), "src/service-main.ts")],
      { cwd: f.root, env: { ...env, PI_CLASSROOMS_DIR: root }, timeout: 2000 },
    ),
  ).rejects.toMatchObject({
    code: 1,
    stderr: expect.stringContaining("PI_CLASSROOMS_DIR is required"),
  });
  expect(fs.existsSync(path.join(home, ".pi/agent/classrooms"))).toBe(false);
});

it("keeps HTTP and submissions alive after MCP exit, reconnects, and preserves grades after restart", async () => {
  const first = client();
  await first.call("initialize", { clientInfo: { name: "codex-test" } });
  const tools = await first.call("tools/list");
  expect(tools.result.tools.map((t: any) => t.name).sort()).toEqual(
    [
      "begin_teaching",
      "classroom_service",
      "lesson_health",
      "list_classrooms",
      "open_classroom",
      "scaffold_classroom",
      "scaffold_lesson",
      "scaffold_review",
      "resume_lesson_teacher",
    ].sort(),
  );
  expect(
    tools.result.tools.find((t: any) => t.name === "scaffold_lesson").inputSchema.properties.mode
      .enum,
  ).toEqual(["lesson", "quiz", "pretest"]);
  expect((await serviceStatus()).running).toBe(false);
  const opened = await first.call("tools/call", {
    name: "open_classroom",
    arguments: { classroom: "rust" },
  });
  expect(opened.result.isError).toBe(false);
  const before = await serviceStatus(),
    base = before.url;
  first.child.stdin.end();
  await first.exited;
  expect((await fetch(`${base}/c/rust/001-ownership`)).status).toBe(200);
  const body = { classroom: "rust", lesson: "001-ownership" };
  const asked = await fetch(`${base}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, question: "Why?", anchor: { exact: "Some lesson prose" } }),
  });
  expect(asked.status).toBe(201);
  const submitted = await fetch(`${base}/api/quiz/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...body,
      quizId: "check-1",
      kind: "check",
      answers: [{ questionId: "q1", type: "term", prompt: "Lifetime?", value: "forever" }],
    }),
  });
  expect(submitted.status).toBe(201);
  const stateUrl = `${base}/api/state?classroom=rust&lesson=001-ownership`;
  await waitFor(async () => {
    const state = await (await fetch(stateUrl)).json();
    return (
      state.annotations[0]?.status === "answered" &&
      !!state.quizzes[0]?.grade &&
      state.teacher.requests.every((r: any) => r.status === "done")
    );
  });
  const second = client();
  await second.call("initialize", { clientInfo: { name: "codex-test" } });
  await second.call("tools/call", { name: "open_classroom", arguments: { classroom: "rust" } });
  expect((await serviceStatus()).pid).toBe(before.pid);
  second.child.stdin.end();
  await second.exited;
  await control("/stop", {});
  await waitFor(async () => {
    try {
      process.kill(before.pid, 0);
      return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      return true;
    }
  });
  expect((await serviceStatus()).running).toBe(false);
  // Use the same fake authenticated executable for the restarted service.
  const oldPath = process.env.PATH;
  process.env.PATH = env.PATH;
  try {
    await ensureService();
  } finally {
    process.env.PATH = oldPath;
  }
  const restarted = await (await fetch(stateUrl)).json();
  expect(restarted.quizzes[0].grade.score).toBe(0);
  expect(restarted.teacher.identity).not.toHaveProperty("sessionId");
  expect(readTeacherState("rust")!.identity.sessionId).toBe("test-dedicated-session");
  const grades = fs.readdirSync(path.join(f.root, "rust/001-ownership/quiz/grades"));
  expect(grades).toHaveLength(1);
  expect((await fetch(`${base}/c/rust/001-ownership/quiz/key.json`)).status).toBe(404);
}, 25_000);

it("attaches simultaneous MCP clients to one owner without a port conflict", async () => {
  const a = client(true),
    b = client(true);
  let released = false;
  let failure: unknown;
  try {
    await Promise.all([
      a.call("initialize", { clientInfo: { name: "codex-test" } }),
      b.call("initialize", { clientInfo: { name: "codex-test" } }),
    ]);
    const first = a.call("tools/call", {
      name: "open_classroom",
      arguments: { classroom: "rust" },
    });
    let secondFinished = false;
    const second = b
      .call("tools/call", { name: "open_classroom", arguments: { classroom: "rust" } })
      .then((reply) => {
        secondFinished = true;
        return reply;
      });
    await waitFor(async () => a.startups.length === 1 && b.startups.length === 1);
    for (const candidate of [...a.startups, ...b.startups]) {
      expect(candidate).toMatchObject({
        root: f.root,
        packageRoot: packageRoot(),
        port: Number(env.PI_CLASSROOM_SERVICE_PORT),
      });
      expect(candidate.pid).toBeGreaterThan(0);
    }
    a.releaseStartup(a.startups[0].pid);
    const firstReply = await first;
    const owner = await serviceStatus();
    expect(owner.pid).toBe(a.startups[0].pid);
    await waitFor(async () => !!b.startupDecision());
    // A successful winner probe must keep the losing start in readiness, not attach.
    expect(b.startupDecision()).toEqual({ winner: owner.pid, path: "/status" });
    expect(secondFinished).toBe(false);
    expect((await fetch(owner.url)).status).toBe(200);
    expect(serviceOwnerExited(owner, servicePaths())).toBe(false);
    b.releaseStartup(b.startups[0].pid);
    released = true;
    const replies = [firstReply, await second];
    await waitFor(async () => b.startupExits.has(b.startups[0].pid));
    expect(b.startupExits.get(b.startups[0].pid)).toMatchObject({ code: 1, signal: null });
    for (const reply of replies) expect(reply.result.isError).toBe(false);
    expect(replies[0].result.content).toEqual(replies[1].result.content);
    expect((await serviceStatus()).running).toBe(true);
    expect((await serviceStatus()).pid).toBe(owner.pid);
    b.child.stdin.end();
    await b.exited;
    expect((await fetch(owner.url)).status).toBe(200);
    const stopped = await a.call("tools/call", {
      name: "classroom_service",
      arguments: { action: "stop" },
    });
    if (
      stopped.result?.isError === false &&
      JSON.parse(stopped.result.content[0].text).stopping === true
    )
      acknowledgedStop = owner;
    expect(stopped.result.isError).toBe(false);
    expect(JSON.parse(stopped.result.content[0].text).stopping).toBe(true);
    await waitFor(async () => serviceOwnerExited(owner, servicePaths()));
    await waitFor(async () => a.startupExits.has(owner.pid));
    expect(a.startupExits.get(owner.pid)).toMatchObject({ code: 0, signal: null });
    expect((await serviceStatus()).running).toBe(false);
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      // Release/reap a held loser while the original owner remains live after failure.
      if (!released && b.startups[0]) {
        b.releaseStartup(b.startups[0].pid);
        await waitFor(async () => b.startupExits.has(b.startups[0].pid));
      }
    } catch (error) {
      if (failure)
        throw new AggregateError([failure, error], "MCP assertion and startup cleanup failed.");
      throw error;
    } finally {
      a.child.stdin.end();
      b.child.stdin.end();
      await Promise.all([a.exited, b.exited]);
    }
  }
  for (const c of [a, b]) {
    expect(c.child.exitCode).toBe(0);
    expect(c.stderr()).not.toContain("detach failed");
  }
}, 15_000);

it("rejects an occupied explicit port without selecting another port", async () => {
  const occupied = net.createServer();
  await new Promise<void>((resolve) =>
    occupied.listen(Number(env.PI_CLASSROOM_SERVICE_PORT), "127.0.0.1", resolve),
  );
  try {
    await expect(ensureService()).rejects.toThrow("failed to start");
    expect((await serviceStatus()).running).toBe(false);
    expect(fs.readFileSync(path.join(f.root, ".pi-teach-service/service.log"), "utf8")).toContain(
      "EADDRINUSE",
    );
  } finally {
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
  }
}, 15_000);

async function openDetached() {
  const c = client();
  try {
    await c.call("initialize", { clientInfo: { name: "codex-test" } });
    const opened = await c.call("tools/call", {
      name: "open_classroom",
      arguments: { classroom: "rust" },
    });
    expect(opened.result.isError).toBe(false);
  } finally {
    c.child.stdin.end();
    await c.exited;
  }
  return (await serviceStatus()).url as string;
}
function quizBody(lesson: string) {
  return {
    classroom: "rust",
    lesson,
    quizId: "check-1",
    kind: "check",
    answers: [{ questionId: "q1", type: "term", prompt: "Lifetime?", value: "forever" }],
  };
}
async function submit(base: string, lesson: string) {
  const response = await fetch(`${base}/api/quiz/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(quizBody(lesson)),
    signal: AbortSignal.timeout(1000),
  });
  expect(response.status).toBe(201);
  return response.json();
}
it("reads several Codex JSON values without a newline", async () => {
  f.write("behavior.json", JSON.stringify({ packed: true, foreign: true }));
  const base = await openDetached();
  await submit(base, "001-ownership");
  await waitFor(async () => {
    const state = await (
      await fetch(`${base}/api/state?classroom=rust&lesson=001-ownership`)
    ).json();
    if (state.teacher.requests[0]?.status === "failed")
      throw new Error(state.teacher.requests[0].error);
    return !!state.quizzes[0]?.grade;
  });
}, 15_000);
it("accepts another lesson submission and control requests during a long Codex grade", async () => {
  seedClassroom(f, { lesson: "002-borrowing" });
  f.write("rust/002-borrowing/quiz/key.json", '{"q1":"dropped"}');
  f.write("behavior.json", JSON.stringify({ gate: true, progress: true }));
  accelerateDeadline();
  const c = client();
  await c.call("initialize", { clientInfo: { name: "codex" } });
  await c.call("tools/call", { name: "open_classroom", arguments: { classroom: "rust" } });
  const base = (await serviceStatus()).url;
  const first = await submit(base, "001-ownership");
  await waitFor(async () => fs.existsSync(path.join(f.root, "turns.log")));
  const second = await submit(base, "002-borrowing");
  const before = await serviceStatus();
  expect(before.running).toBe(true);
  const state = JSON.parse(fs.readFileSync(path.join(f.root, "rust/.teacher.json"), "utf8"));
  expect(state.requests.map((r: any) => r.status)).toEqual(["running", "queued"]);
  expect(fs.readFileSync(path.join(f.root, "turns.log"), "utf8").trim()).toBe(first.id);
  const teacherBefore = fs.readFileSync(path.join(f.root, "rust/.teacher.json"), "utf8");
  c.child.stdin.end();
  await c.exited;
  expect(c.stderr()).not.toContain("detach failed");
  expect((await fetch(base)).status).toBe(200);
  expect(fs.readFileSync(path.join(f.root, "rust/.teacher.json"), "utf8")).toBe(teacherBefore);
  await new Promise((r) => setTimeout(r, 2000));
  f.write("release", "");
  await waitFor(async () => {
    const state = JSON.parse(fs.readFileSync(path.join(f.root, "rust/.teacher.json"), "utf8"));
    return state.requests.every((r: any) => r.status === "done");
  });
  expect(fs.readFileSync(path.join(f.root, "turns.log"), "utf8").trim().split("\n")).toEqual([
    first.id,
    second.id,
  ]);
  for (const lesson of ["001-ownership", "002-borrowing"])
    expect(fs.readdirSync(path.join(f.root, "rust", lesson, "quiz/grades"))).toHaveLength(1);
  expect((await serviceStatus()).pid).toBe(before.pid);
}, 15_000);

function accelerateDeadline(total = false) {
  // Scale only the teacher deadline. Keep service and HTTP timers unchanged.
  const preload = f.write(
    "deadline.mjs",
    `const original = globalThis.setTimeout;
globalThis.setTimeout = (callback, ms, ...args) => original(callback, ms === ${total ? 300000 : 180000} ? 1000 : ms, ...args);
`,
  );
  env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(preload).href}`;
}
it.each(["invalid", "truncated"])(
  "fails malformed Codex stdout loudly: %s",
  async (mode) => {
    f.write("behavior.json", JSON.stringify({ [mode]: true }));
    const base = await openDetached();
    await submit(base, "001-ownership");
    await waitFor(async () => {
      const state = JSON.parse(fs.readFileSync(path.join(f.root, "rust/.teacher.json"), "utf8"));
      return state.requests[0]?.status === "failed";
    });
    const state = JSON.parse(fs.readFileSync(path.join(f.root, "rust/.teacher.json"), "utf8"));
    expect(state.requests[0].error).toContain(
      mode === "invalid" ? "Invalid Codex stdout" : "stdout ended inside a JSON object",
    );
    expect(state.requests[0].error).toContain("rust/001-ownership");
    expect(fs.existsSync(path.join(f.root, "rust/001-ownership/quiz/grades"))).toBe(false);
    expect((await serviceStatus()).running).toBe(true);
  },
  15_000,
);
it.each(["noise", "progress"])(
  "times out an unfinished grade despite %s and requires retry",
  async (mode) => {
    f.write("behavior.json", JSON.stringify({ gate: true, [mode]: true }));
    accelerateDeadline(mode === "progress");
    const base = await openDetached();
    const submission = await submit(base, "001-ownership");
    await waitFor(async () => {
      const state = JSON.parse(fs.readFileSync(path.join(f.root, "rust/.teacher.json"), "utf8"));
      return state.requests[0]?.status === "failed";
    });
    const file = path.join(f.root, "rust/.teacher.json");
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(state.requests[0].error).toContain(
      `quiz request quiz:${submission.id} in rust/001-ownership`,
    );
    expect(state.requests[0].error).toContain(
      "running turn test-turn in thread test-dedicated-session",
    );
    expect(state.requests[0].error).toContain(
      mode === "progress" ? "300 second request limit" : "made no progress",
    );
    expect(state.requests[0].error).toContain(
      `Last progress: ${mode === "progress" ? "item/agentMessage/delta" : "none"}`,
    );
    expect(fs.existsSync(path.join(f.root, "rust/001-ownership/quiz/grades"))).toBe(false);
    f.write("release", "");
    await new Promise((r) => setTimeout(r, 1200));
    expect(JSON.parse(fs.readFileSync(file, "utf8")).requests[0].status).toBe("failed");
    const retried = await fetch(`${base}/api/teacher/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classroom: "rust", id: `quiz:${submission.id}` }),
    });
    expect(retried.status).toBe(200);
    await waitFor(
      async () => JSON.parse(fs.readFileSync(file, "utf8")).requests[0].status === "done",
    );
    expect(fs.readdirSync(path.join(f.root, "rust/001-ownership/quiz/grades"))).toHaveLength(1);
  },
  15_000,
);

it("discovers and resumes a historical review through the actual MCP transport", async () => {
  const input = seedHistoricalReview(f.root);
  const mcp = client();
  await mcp.call("initialize", { clientInfo: { name: "codex-test" } });
  const opened = await mcp.call("tools/call", {
    name: "open_classroom",
    arguments: { classroom: "rust" },
  });
  expect(opened.result.isError).toBe(false);
  const response = await mcp.call("tools/call", {
    name: "resume_lesson_teacher",
    arguments: input,
  });
  expect(response.result.isError).toBe(false);
  expect(response.result.content[0].text).toContain("/c/rust/999-historical-review#cl-teacher");
  const base = (await serviceStatus()).url;
  const url = `${base}/api/state?classroom=rust&lesson=${input.lesson}`;
  await waitFor(
    async () => (await (await fetch(url)).json()).teacher.requests[0]?.status === "done",
  );
  await mcp.call("tools/call", { name: "resume_lesson_teacher", arguments: input });
  const state = await (await fetch(url)).json();
  expect(state.teacher.requests).toHaveLength(1);
  expect(state.teacher.requests[0].kind).toBe("resume");
  expect(state.teacher.messages.map((m: any) => m.role)).toEqual(["teacher"]);
  expect(state.quizzes[0].grade.score).toBe(67);
}, 30_000);

it("uses local links without Tailscale and reports a failed tailnet route", async () => {
  // The fake CLI fails until tailscale-up exists, then emulates a connected node.
  fs.writeFileSync(
    path.join(f.root, "bin", "tailscale"),
    `#!${process.execPath}\n` +
      String.raw`
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const file = path.join(root, 'tailscale-state.json');
if (!fs.existsSync(path.join(root, 'tailscale-up'))) process.exit(1);
const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const args = process.argv.slice(2);
if (args[0] === 'status') console.log(JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'test.tailnet.ts.net.' } }));
else if (args[1] === 'status') console.log(JSON.stringify(state));
else {
 const key = 'test.tailnet.ts.net:' + args.find((a) => a.startsWith('--https=')).split('=')[1];
 state.Web ??= {};
 if (args.at(-1) === 'off') delete state.Web[key];
 else state.Web[key] = { Handlers: { '/': { Proxy: args.at(-1) } } };
 fs.writeFileSync(file, JSON.stringify(state));
}
`,
    { mode: 0o700 },
  );
  delete env.PI_CLASSROOM_TAILSCALE;
  env.PI_CLASSROOM_CONFIG = path.join(f.root, "config.json");
  const mcp = client();
  await mcp.call("initialize", { clientInfo: { name: "codex-test" } });
  const open = () =>
    mcp.call("tools/call", { name: "open_classroom", arguments: { classroom: "rust" } });
  const local = await open();
  expect(local.result.isError).toBe(false);
  expect(local.result.content[0].text).toContain("http://127.0.0.1:");
  f.write("tailscale-up", "");
  const failed = await open();
  // The fake tailnet name does not resolve, so the URL check fails without a local fallback.
  expect(failed.result?.isError ?? true).toBe(true);
  expect(JSON.stringify(failed)).toContain('\\"tailscale\\": false');
  expect(JSON.stringify(failed)).not.toContain("http://127.0.0.1:");
  // Disabling tailnet links in config removes the owned route on the next open.
  f.write("config.json", '{"tailscale":false}');
  const disabled = await open();
  expect(disabled.result.content[0].text).toContain("http://127.0.0.1:");
  expect(JSON.parse(fs.readFileSync(path.join(f.root, "tailscale-state.json"), "utf8"))).toEqual({
    Web: {},
  });
  mcp.child.stdin.end();
  await mcp.exited;
  const { pid } = await serviceStatus();
  await control("/stop", {});
  await waitFor(async () => {
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      return true;
    }
  });
  expect(JSON.parse(fs.readFileSync(path.join(f.root, "tailscale-state.json"), "utf8"))).toEqual({
    Web: {},
  });
}, 30_000);

it("opens a prepared review through MCP without a review authoring request", async () => {
  seedPreparedReviewSource(f.root);
  writeGradedAttempt({ at: 1, answers: [termAnswer("q1", "owner")], correct: { q1: true } });
  f.write("behavior.json", JSON.stringify({ invalid: true }));
  const mcp = client();
  try {
    await mcp.call("initialize", { clientInfo: { name: "codex-test" } });
    await mcp.call("tools/call", { name: "open_classroom", arguments: { classroom: "rust" } });
    const response = await mcp.call("tools/call", {
      name: "scaffold_review",
      arguments: { classroom: "rust" },
    });
    expect(response.result.isError).toBe(false);
    const review = currentReview("rust")!;
    expect(review.status).toBe("done");
    expect(readTeacherState("rust")!.requests.filter((r) => r.kind === "review")).toEqual([]);
    const base = (await serviceStatus()).url!;
    expect((await fetch(`${base}/c/rust/${review.lesson}`)).status).toBe(200);
    expect((await fetch(`${base}/c/rust/001-ownership/quiz/key.json`)).status).toBe(404);
    await mcp.call("tools/call", { name: "scaffold_review", arguments: { classroom: "rust" } });
    expect(currentReview("rust")!.id).toBe(review.id);
    expect(store.listGrades("rust", "001-ownership")).toHaveLength(1);
    expect(store.listSubmissions("rust", review.lesson)).toHaveLength(0);
  } finally {
    mcp.child.stdin.end();
    await mcp.exited;
  }
}, 30_000);
