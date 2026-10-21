/** Actual service IPC shutdown with a queued connection, without provider inference. */
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import assert from "node:assert/strict";
import { syncBuiltinESMExports } from "node:module";
import { makeFixture } from "./helpers.ts";
import { control, ensureService, servicePaths, serviceStatus } from "../src/service-client.ts";
import { readOwnedService, serviceOwnerExited } from "./service-process-owner.ts";
import { waitForOwnedServiceStop } from "../scripts/service-stop-observer.ts";

const f = makeFixture();
const gate = path.join(f.root, "stop");
process.env.STUDENS_STOP_GATE = gate;
process.env.NODE_OPTIONS = `--import ${path.join(import.meta.dirname, "service-stop-gate.mjs")}`;
process.env.PI_CLASSROOM_TAILSCALE = "0";
const listener = net.createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
process.env.PI_CLASSROOM_SERVICE_PORT = String(listener.address().port);
await new Promise((resolve) => listener.close(resolve));
const wait = async (predicate) => {
  const deadline = Date.now() + 10_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Shutdown observer gate timed out.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};
const originalRequest = http.request;
let owner;
try {
  const start = async () => {
    for (const suffix of [".closing", ".release"]) fs.rmSync(gate + suffix, { force: true });
    const status = await ensureService();
    owner = readOwnedService(servicePaths().lock, {
      packageRoot: path.resolve(import.meta.dirname, ".."),
      port: status.port,
    });
    assert.ok(owner);
    await control("/stop", {});
    await wait(() => fs.existsSync(gate + ".closing"));
  };
  await start();
  let connected;
  const ready = new Promise((resolve) => {
    connected = resolve;
  });
  http.request = function (...args) {
    const req = Reflect.apply(originalRequest, this, args);
    req.once("socket", (socket) => socket.once("connect", connected));
    return req;
  };
  syncBuiltinESMExports();
  // Hold the actual service event loop just before ipc.close. The client's
  // connection is queued in the kernel but cannot yet be accepted by Node.
  const oldObserver = serviceStatus();
  const rejection = assert.rejects(oldObserver, { code: "ECONNRESET" });
  await ready;
  fs.writeFileSync(gate + ".release", "");
  await rejection;
  http.request = originalRequest;
  syncBuiltinESMExports();
  await wait(() => serviceOwnerExited(owner, servicePaths()));

  await start();
  let probes = 0;
  http.request = function (...args) {
    if (args[0].path === "/status") probes++;
    return Reflect.apply(originalRequest, this, args);
  };
  syncBuiltinESMExports();
  const stopped = waitForOwnedServiceStop(owner, servicePaths());
  assert.equal(probes, 0);
  assert.ok(fs.existsSync(servicePaths().lock));
  fs.writeFileSync(gate + ".release", "");
  await stopped;
  assert.equal(probes, 1);
  assert.equal(fs.existsSync(servicePaths().lock), false);
  assert.equal(fs.existsSync(servicePaths().socket), false);
  console.log(
    JSON.stringify({
      oldObserver: "ECONNRESET",
      barrier: "PASS",
      finalStatusProbes: probes,
      noInference: true,
    }),
  );
} finally {
  http.request = originalRequest;
  syncBuiltinESMExports();
  fs.writeFileSync(gate + ".release", "");
  if (owner) await wait(() => serviceOwnerExited(owner, servicePaths()));
  f.cleanup();
}
