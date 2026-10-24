/** Deterministic control-transport contracts through the actual MCP stdio process. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as http from "node:http";
import * as readline from "node:readline";
import { createHash } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import { runtimeIdentity } from "../src/service-identity.ts";

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const identity = runtimeIdentity(source);
const version = JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8")).version;
let root: string, socket: string, boundary: http.Server;
let calls: Array<{ endpoint: string; body: any }>;
let rpc: (body: any, res: http.ServerResponse) => void;
let afterStatus: (() => void) | undefined;
let release: (() => void) | undefined;
const clients: Array<{ child: ChildProcessWithoutNullStreams; closed: Promise<number | null> }> =
  [];

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "studens-mcp-"));
  socket = path.join(
    os.tmpdir(),
    `pi-teach-${process.getuid!()}-${createHash("sha256").update(root).digest("hex").slice(0, 20)}.sock`,
  );
  calls = [];
  afterStatus = release = undefined;
  rpc = (body, res) => res.end(JSON.stringify(ok(body.message.id, { stopping: true })));
  boundary = http.createServer((req, res) => {
    void (async () => {
      let text = "";
      for await (const chunk of req) text += chunk;
      const body = text ? JSON.parse(text) : undefined;
      calls.push({ endpoint: req.url!, body });
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/status" || req.url === "/attachment") {
        res.end(
          JSON.stringify({
            running: true,
            pid: process.pid,
            identity,
            root,
            packageRoot: source,
            version,
            port: 43123,
          }),
        );
        if (req.url === "/status") afterStatus?.();
      } else if (req.url === "/disconnect") res.end(JSON.stringify({ detached: true }));
      else rpc(body, res);
    })();
  });
  await new Promise<void>((resolve) => boundary.listen(socket, resolve));
});
afterEach(async () => {
  release?.();
  for (const c of clients.splice(0)) {
    c.child.stdin.end();
    if (c.child.exitCode === null) c.child.kill("SIGTERM");
    await c.closed;
  }
  boundary.closeAllConnections();
  if (boundary.listening) await new Promise<void>((resolve) => boundary.close(() => resolve()));
  fs.rmSync(root, { recursive: true, force: true });
});
function ok(id: number, value: unknown) {
  return {
    jsonrpc: "2.0",
    id,
    result: { content: [{ type: "text", text: JSON.stringify(value) }], isError: false },
  };
}
function client() {
  const guard = path.join(root, "assert-root.mjs");
  fs.writeFileSync(
    guard,
    `import assert from 'node:assert/strict';
const {classroomsRoot} = await import(${JSON.stringify(path.join(source, "src/paths.ts"))});
assert.equal(classroomsRoot(), process.env.PI_CLASSROOMS_DIR);
assert.equal(classroomsRoot(), ${JSON.stringify(root)});`,
  );
  const child = spawn(process.execPath, ["--import", guard, path.join(source, "mcp/launch.mjs")], {
    cwd: source,
    env: {
      ...process.env,
      PI_CLASSROOMS_DIR: root,
      PI_CLASSROOM_SERVICE_PORT: "43123",
      PI_CLASSROOM_TAILSCALE: "0",
      PI_CLASSROOM_CONFIG: path.join(root, "config.json"),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "",
    sequence = 0;
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const pending = new Map<number, (reply: any) => void>();
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    const reply = JSON.parse(line);
    pending.get(reply.id)?.(reply);
    pending.delete(reply.id);
  });
  const closed = new Promise<number | null>((resolve) => child.on("close", resolve));
  const c = {
    child,
    closed,
    stderr: () => stderr,
    call(method: string, params: unknown = {}) {
      const id = ++sequence;
      const reply = new Promise<any>((resolve) => pending.set(id, resolve));
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      return reply;
    },
    tool(action: string) {
      return c.call("tools/call", { name: "classroom_service", arguments: { action } });
    },
  };
  clients.push(c);
  return c;
}

it.each(["codex", "claude"])(
  "does not detach after %s receives a successful stop",
  async (name) => {
    const c = client();
    await c.call("initialize", { clientInfo: { name } });
    const response = await c.tool("stop");
    expect(response.result.isError).toBe(false);
    c.child.stdin.end();
    expect(await c.closed).toBe(0);
    expect(calls.map((call) => call.endpoint)).toEqual(["/status", "/rpc"]);
    expect(calls[1].body.backend).toBe(name);
    expect(c.stderr()).not.toContain("detach failed");
  },
);

it.each([false, true])("waits for an in-flight stop at EOF (refused: %s)", async (refused) => {
  let arrived!: () => void;
  const seen = new Promise<void>((resolve) => (arrived = resolve));
  rpc = (body, res) => {
    release = () => {
      const reply = ok(body.message.id, { stopping: true });
      reply.result.isError = refused;
      res.end(JSON.stringify(reply));
    };
    arrived();
  };
  const c = client();
  const reply = c.tool("stop");
  await seen;
  c.child.stdin.end();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(c.child.exitCode).toBeNull();
  expect(calls.map((call) => call.endpoint)).toEqual(["/status", "/rpc"]);
  release!();
  expect((await reply).result.isError).toBe(refused);
  expect(await c.closed).toBe(0);
  expect(calls.map((call) => call.endpoint)).toEqual([
    "/status",
    "/rpc",
    ...(refused ? ["/disconnect"] : []),
  ]);
  expect(c.stderr()).not.toContain("detach failed");
});

it.each(["tool", "rpc", "transport"])(
  "keeps detach and the specific %s stop failure",
  async (kind) => {
    rpc = (body, res) => {
      if (kind === "transport") res.destroy();
      else if (kind === "rpc")
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.message.id,
            error: { code: -32603, message: "Stop refused by owner." },
          }),
        );
      else
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.message.id,
            result: { isError: true, content: [{ type: "text", text: "Stop refused by owner." }] },
          }),
        );
    };
    const c = client();
    const response = await c.tool("stop");
    expect(JSON.stringify(response)).toContain(
      kind === "transport" ? "socket hang up" : "Stop refused by owner.",
    );
    c.child.stdin.end();
    expect(await c.closed).toBe(0);
    expect(calls.map((call) => call.endpoint)).toEqual(["/status", "/rpc", "/disconnect"]);
    expect(calls[2].body.client).toBe(calls[1].body.client);
    if (kind === "transport") expect(c.stderr()).toContain("MCP request failed");
  },
);

it("reports an unexpected missing socket on live disconnect", async () => {
  const c = client();
  await c.tool("start");
  await new Promise<void>((resolve) => boundary.close(() => resolve()));
  c.child.stdin.end();
  expect(await c.closed).toBe(0);
  expect(c.stderr()).toContain("detach failed");
  expect(c.stderr()).toContain("ENOENT");
});

it.each(["status", "stop"])("does not restart an owner lost after the %s probe", async (action) => {
  afterStatus = () => boundary.close();
  const c = client();
  const response = await c.tool(action);
  expect(response.error.message).toMatch(/ENOENT|ECONNREFUSED/);
  c.child.stdin.end();
  expect(await c.closed).toBe(0);
  expect(calls.map((call) => call.endpoint)).toEqual(["/status"]);
  expect(fs.existsSync(path.join(root, ".pi-teach-service"))).toBe(false);
  expect(c.stderr()).toContain("MCP request failed");
  expect(c.stderr()).toContain("detach failed");
});
