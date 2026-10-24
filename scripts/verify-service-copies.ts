/** Real installed-copy MCP lifecycle, using owned scratch installs, sockets, and HTTP. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as net from "node:net";
import * as http from "node:http";
import * as readline from "node:readline";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { runtimeIdentity, runtimePaths } from "../src/service-identity.ts";
import { packageRoot } from "../src/paths.ts";

const exec = promisify(execFile);
const artifacts = path.resolve(
  process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), "studens-copies-evidence-")),
);
fs.mkdirSync(artifacts, { recursive: true });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "studens-copies-"));
const a = path.join(scratch, ".codex/plugins/studens"),
  b = path.join(scratch, ".claude/plugins/studens");
const root = path.join(scratch, "classrooms");
fs.mkdirSync(root, { recursive: true });
const key = createHash("sha256").update(root).digest("hex").slice(0, 20);
const socket = path.join(os.tmpdir(), `pi-teach-${process.getuid!()}-${key}.sock`);
const lock = path.join(root, ".pi-teach-service/owner.json");
const reservation = net.createServer();
await new Promise<void>((r) => reservation.listen(0, "127.0.0.1", r));
const port = (reservation.address() as net.AddressInfo).port;
await new Promise<void>((r) => reservation.close(() => r()));
const env = {
  ...process.env,
  PI_CLASSROOMS_DIR: root,
  PI_CLASSROOM_SERVICE_PORT: String(port),
  PI_CLASSROOM_TAILSCALE: "0",
  PI_CLASSROOM_CONFIG: path.join(scratch, "config.json"),
};
const spawnLog = path.join(scratch, "service-spawns.jsonl");
const observer = path.join(scratch, "observe-spawns.mjs");
fs.writeFileSync(
  observer,
  `import cp from 'node:child_process';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const spawn = cp.spawn;
cp.spawn = function(command, args, options) {
  const child = Reflect.apply(spawn, this, [command, args, options]);
  if (args?.some(arg => arg.endsWith('/src/service-main.ts')))
    fs.appendFileSync(${JSON.stringify(spawnLog)}, JSON.stringify({pid:child.pid, entry:args[0]})+'\\n');
  return child;
};
syncBuiltinESMExports();`,
);
function spawns(): string {
  return fs.existsSync(spawnLog) ? fs.readFileSync(spawnLog, "utf8") : "";
}
const evidence: any[] = [];
interface Client {
  child: ReturnType<typeof spawn>;
  exited: Promise<void>;
  initialize(): Promise<any>;
  start(): Promise<any>;
  close(): Promise<void>;
}
const children: Client[] = [];
let owner: any;
let passed = false;
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function control(endpoint: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: socket,
        path: endpoint,
        method: endpoint === "/stop" ? "POST" : "GET",
        agent: false,
      },
      (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () =>
          res.statusCode === 200 ? resolve(JSON.parse(text)) : reject(new Error(text)),
        );
      },
    );
    req.on("error", reject);
    req.end(endpoint === "/stop" ? "{}" : undefined);
  });
}
function client(copy: string, name: string): Client {
  const child = spawn(process.execPath, ["--import", observer, path.join(copy, "mcp/launch.mjs")], {
    cwd: scratch,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let sequence = 0,
    stderr = "";
  const pending = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  child.stderr.on("data", (c) => (stderr += c));
  const exited = new Promise<void>((resolve, reject) =>
    child.once("exit", (code) => {
      for (const p of pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error(`Client exited: ${code}: ${stderr}`));
      }
      pending.clear();
      code === 0 ? resolve() : reject(new Error(`Client exit ${code}: ${stderr}`));
    }),
  );
  void exited.catch(() => {});
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    const reply = JSON.parse(line),
      p = pending.get(reply.id);
    if (p) {
      clearTimeout(p.timer);
      pending.delete(reply.id);
      p.resolve(reply);
    }
  });
  function request(method: string, params: unknown): Promise<any> {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Client ${name} timed out: ${stderr}`));
      }, 20000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  const result = {
    child,
    exited,
    initialize: () =>
      request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name, version: "1" },
      }),
    start: () =>
      request("tools/call", { name: "classroom_service", arguments: { action: "start" } }),
    async close() {
      if (child.exitCode === null) child.stdin.end();
      await exited;
      check(!stderr.includes("detach failed"), stderr);
    },
  };
  children.push(result);
  return result;
}
function parsed(reply: any): any {
  check(!reply.error && !reply.result?.isError, JSON.stringify(reply));
  return JSON.parse(reply.result.content[0].text);
}
function snapshot(): string {
  return JSON.stringify(
    fs
      .readdirSync(root, { recursive: true })
      .sort()
      .map((f) => {
        const file = path.join(root, String(f));
        return [
          f,
          fs.statSync(file).isFile()
            ? createHash("sha256").update(fs.readFileSync(file)).digest("hex")
            : "directory",
        ];
      }),
  );
}
async function stop() {
  if (!owner) return;
  check(
    JSON.parse(fs.readFileSync(lock, "utf8")).pid === owner.pid,
    "Owner changed before cleanup",
  );
  await control("/stop");
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    let alive = true;
    try {
      process.kill(owner.pid, 0);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e;
      alive = false;
    }
    if (!alive && !fs.existsSync(lock) && !fs.existsSync(socket)) {
      owner = undefined;
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Owned service did not exit");
}
try {
  for (const copy of [a, b]) {
    fs.mkdirSync(copy, { recursive: true });
    for (const file of runtimePaths) {
      fs.mkdirSync(path.dirname(path.join(copy, file)), { recursive: true });
      fs.cpSync(path.join(packageRoot(), file), path.join(copy, file), { recursive: true });
    }
  }
  const fullInstall = await exec("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: a,
  });
  fs.writeFileSync(
    path.join(artifacts, "development-install.log"),
    fullInstall.stdout + fullInstall.stderr,
  );
  const install = await exec(
    "npm",
    ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd: b },
  );
  fs.writeFileSync(path.join(artifacts, "production-install.log"), install.stdout + install.stderr);
  if (JSON.stringify(runtimeIdentity(a)) !== JSON.stringify(runtimeIdentity(b))) {
    function files(copy: string): Record<string, string> {
      const lock = JSON.parse(fs.readFileSync(path.join(copy, "package-lock.json"), "utf8"));
      const result: Record<string, string> = {};
      function visit(relative: string) {
        const file = path.join(copy, relative);
        if (fs.statSync(file).isDirectory())
          for (const name of fs.readdirSync(file)) {
            if (name !== "node_modules") visit(relative + "/" + name);
          }
        else result[relative] = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
      }
      for (const [file, entry] of Object.entries(lock.packages) as [string, any][])
        if (file && !entry.dev && fs.existsSync(path.join(copy, file))) visit(file);
      return result;
    }
    const left = files(a),
      right = files(b);
    const differences = [...new Set([...Object.keys(left), ...Object.keys(right)])].filter(
      (file) => left[file] !== right[file],
    );
    evidence.push({ step: "installation differences", differences, scratch });
    throw new Error("Dev and production-only closures differ: " + JSON.stringify(differences));
  }
  const first = client(a, "Codex"),
    second = client(b, "Claude Code");
  await Promise.all([first.initialize(), second.initialize()]);
  const statuses = (await Promise.all([first.start(), second.start()])).map(parsed);
  owner = await control("/status");
  check(
    statuses.every((s) => s.pid === owner.pid),
    "Concurrent copies selected different owners",
  );
  check(JSON.parse(fs.readFileSync(lock, "utf8")).pid === owner.pid, "Lock disagrees");
  check((await fetch(owner.url)).status === 200, "HTTP not live");
  evidence.push({ step: "concurrent Codex/Claude copies", statuses, socket, owner });
  await first.close();
  await second.close();
  check((await control("/status")).pid === owner.pid, "Detach replaced owner");
  const reconnect = client(b, "Claude Code");
  await reconnect.initialize();
  check(parsed(await reconnect.start()).pid === owner.pid, "Reconnect replaced owner");
  await reconnect.close();
  const before = snapshot(),
    spawnedBeforeRejection = spawns();
  for (const file of ["src/server.ts", "node_modules/marked/lib/marked.esm.js"]) {
    const target = path.join(b, file),
      original = fs.readFileSync(target);
    fs.appendFileSync(target, "\n// unequal copy\n");
    const rejected = client(b, "Claude Code");
    await rejected.initialize();
    const reply = await rejected.start();
    check(
      reply.error?.message.includes("different root, port, version, or runtime package content"),
      "Unequal copy was not rejected: " + JSON.stringify(reply),
    );
    await rejected.close();
    fs.writeFileSync(target, original);
    check(snapshot() === before, "Rejected attachment mutated service state");
    check(spawns() === spawnedBeforeRejection, "Rejected attachment spawned a service");
    check((await control("/status")).pid === owner.pid, "Rejected copy replaced owner");
    evidence.push({
      step: "unequal copy rejected",
      file,
      reply,
      stateUnchanged: true,
      noServiceSpawn: true,
    });
  }
  const runningFile = path.join(owner.packageRoot, "src/server.ts"),
    original = fs.readFileSync(runningFile);
  fs.appendFileSync(runningFile, "\n// post-start mutation\n");
  // Match the changed disk bytes from the other installation: startup evidence must still win.
  const otherFile = path.join(owner.packageRoot === a ? b : a, "src/server.ts");
  fs.appendFileSync(otherFile, "\n// post-start mutation\n");
  const changed = client(b, "Claude Code");
  await changed.initialize();
  const reply = await changed.start();
  check(
    reply.error?.message.includes("runtime package content"),
    "Startup identity was replaced by current disk bytes",
  );
  await changed.close();
  // Direct attachment validation must also reject the changed owner even to an old client.
  await control("/attachment").then(
    () => {
      throw new Error("Mutated owner accepted attachment");
    },
    (error) => {
      check(String(error).includes("changed after startup"), String(error));
      evidence.push({ step: "mutated owner rejected", reply, ownerError: String(error) });
    },
  );
  fs.writeFileSync(runningFile, original);
  fs.writeFileSync(otherFile, original);
  fs.copyFileSync(
    path.join(root, ".pi-teach-service/service.log"),
    path.join(artifacts, "service.log"),
  );
  await stop();
  const unequalFile = path.join(b, "src/server.ts");
  fs.appendFileSync(unequalFile, "\n// unequal concurrent contender\n");
  const left = client(a, "Codex"),
    right = client(b, "Claude Code");
  await Promise.all([left.initialize(), right.initialize()]);
  const outcomes = await Promise.all([left.start(), right.start()]);
  owner = await control("/status");
  check(
    outcomes.filter((reply) => reply.error).length === 1,
    "Unequal concurrent starts must have one rejection",
  );
  check(
    outcomes
      .filter((reply) => !reply.error)
      .map(parsed)
      .every((status) => status.pid === owner.pid),
    "Unequal contender replaced owner",
  );
  check(
    outcomes.find((reply) => reply.error).error.message.includes("runtime package content"),
    "Unexpected concurrent incompatibility",
  );
  evidence.push({ step: "unequal concurrent starts", outcomes, owner });
  await left.close();
  await right.close();
  await stop();
  evidence.push({
    step: "public stop",
    ownerExited: true,
    socketAbsent: !fs.existsSync(socket),
    lockAbsent: !fs.existsSync(lock),
  });
  passed = true;
  console.log(JSON.stringify({ verdict: "PASS", evidence }, null, 2));
} finally {
  const completed = passed;
  const cleanup = await Promise.allSettled(children.map((c) => c.close()));
  const errors = cleanup.flatMap((result) =>
    result.status === "rejected" ? [String(result.reason)] : [],
  );
  try {
    if (!owner && fs.existsSync(lock)) {
      const recorded = JSON.parse(fs.readFileSync(lock, "utf8"));
      check(
        [a, b].includes(recorded.packageRoot) && recorded.port === port,
        "Unexpected scratch owner",
      );
      owner = recorded;
    }
    await stop();
  } catch (error) {
    errors.push(String(error));
  }
  if (errors.length) {
    passed = false;
    evidence.push({ step: "cleanup errors", errors });
  }
  fs.writeFileSync(path.join(artifacts, "copies.json"), JSON.stringify(evidence, null, 2));
  fs.writeFileSync(path.join(artifacts, "service-spawns.jsonl"), spawns());
  if (passed) fs.rmSync(scratch, { recursive: true, force: true });
  else console.error(`Failed scratch retained: ${scratch}`);
  if (completed && errors.length)
    throw new Error("Installed-copy cleanup failed: " + errors.join("; "));
}
