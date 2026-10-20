/** Gate actual startup children and report control-flow events to the process fixture. */
import * as path from "node:path";
import * as os from "node:os";
import { createHash } from "node:crypto";
import childProcess from "node:child_process";
import http from "node:http";
import { syncBuiltinESMExports } from "node:module";

const packageRoot = path.resolve(import.meta.dirname, "..");
const entry = path.join(packageRoot, "src/service-main.ts");
const root = path.resolve(process.env.PI_CLASSROOMS_DIR);
const port = Number(process.env.PI_CLASSROOM_SERVICE_PORT);
if (process.argv[1] === entry) {
  // This preload runs before any product import. No lock or listener exists yet.
  await new Promise((resolve, reject) => {
    process.once("disconnect", () => reject(new Error("Startup fixture lost its launcher.")));
    process.once("message", (message) => {
      if (message?.type !== "fixture-release-startup")
        reject(new Error("Unexpected startup fixture message."));
      else resolve();
    });
    process.send({ type: "fixture-service-held", pid: process.pid, packageRoot, root, port });
  });
  process.disconnect();
} else {
  const candidates = new Map();
  const spawn = childProcess.spawn;
  childProcess.spawn = function (command, args, options) {
    if (command !== process.execPath || args?.length !== 1 || args[0] !== entry)
      return Reflect.apply(spawn, this, [command, args, options]);
    const child = Reflect.apply(spawn, this, [
      command,
      ["--import", import.meta.filename, ...args],
      { ...options, stdio: [...options.stdio, "ipc"] },
    ]);
    candidates.set(child.pid, child);
    child.on("message", (message) => process.send(message));
    child.once("exit", (code, signal) => {
      process.send({ type: "fixture-service-exit", pid: child.pid, code, signal });
    });
    return child;
  };
  process.on("message", (message) => {
    if (message?.type !== "fixture-release-startup") return;
    const child = candidates.get(message.pid);
    if (!child?.connected)
      throw new Error("Startup fixture can release only its recorded held child.");
    child.send({ type: "fixture-release-startup" });
  });

  const key = createHash("sha256").update(root).digest("hex").slice(0, 20);
  const socket = path.join(os.tmpdir(), `pi-teach-${process.getuid()}-${key}.sock`);
  const request = http.request;
  let winner;
  let reported = false;
  http.request = function (options, callback) {
    if (options.socketPath !== socket) return Reflect.apply(request, this, [options, callback]);
    if (winner && !reported) {
      // The next request distinguishes continuing readiness from completing attach.
      reported = true;
      process.send({ type: "fixture-startup-decision", winner, path: options.path });
    }
    return Reflect.apply(request, this, [
      options,
      (response) => {
        callback(response);
        if (options.path !== "/status") return;
        let body = "";
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () => {
          const status = JSON.parse(body);
          if (
            status.running &&
            status.root === root &&
            status.packageRoot === packageRoot &&
            status.port === port &&
            [...candidates.keys()].some((pid) => pid !== status.pid)
          )
            winner = status.pid;
        });
      },
    ]);
  };
  syncBuiltinESMExports();
}
