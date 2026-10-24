/** Private local control transport. One service owns one classrooms root. */
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { runtimeIdentity, sameRuntimeIdentity, validRuntimeIdentity } from "./service-identity.ts";
import { readConfig } from "./config.ts";
import { classroomsRoot, packageRoot } from "./paths.ts";

export const DEFAULT_SERVICE_PORT = 43123;
export function servicePort(): number {
  const text = process.env.PI_CLASSROOM_SERVICE_PORT;
  if (text === undefined) return readConfig().port ?? DEFAULT_SERVICE_PORT;
  if (!/^[0-9]+$/.test(text) || Number(text) < 1 || Number(text) > 65535)
    throw new Error("PI_CLASSROOM_SERVICE_PORT must be an integer from 1 to 65535.");
  return Number(text);
}
export function servicePaths(): { dir: string; socket: string; log: string; lock: string } {
  if (!process.getuid) throw new Error("The persistent service requires Unix local sockets.");
  const root = path.resolve(classroomsRoot());
  const key = createHash("sha256").update(root).digest("hex").slice(0, 20);
  // Retain legacy ownership paths so upgrades cannot start a second service for this root.
  const dir = path.join(root, ".pi-teach-service");
  return {
    dir,
    socket: path.join(os.tmpdir(), `pi-teach-${process.getuid()}-${key}.sock`),
    log: path.join(dir, "service.log"),
    lock: path.join(dir, "owner.json"),
  };
}
export function control<T = any>(endpoint: string, value?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: servicePaths().socket,
        agent: false,
        path: endpoint,
        method: value === undefined ? "GET" : "POST",
        headers: { "Content-Type": "application/json" },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(body);
            if (res.statusCode !== 200)
              throw new Error(parsed.error ?? `Control request failed: ${res.statusCode}`);
            resolve(parsed);
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on("error", reject);
    const message = (
      value as { message?: { method?: unknown; params?: { name?: unknown } } } | undefined
    )?.message;
    const opening =
      endpoint === "/rpc" &&
      message?.method === "tools/call" &&
      message.params?.name === "open_classroom";
    // An ordered open can wait for several bounded teacher turns. Keep their deadlines.
    req.setTimeout(opening ? 0 : 190_000, () =>
      req.destroy(new Error("Classroom control request timed out.")),
    );
    req.end(value === undefined ? undefined : JSON.stringify(value));
  });
}
export async function serviceStatus(): Promise<any> {
  try {
    return await control("/status");
  } catch (err) {
    if (!["ENOENT", "ECONNREFUSED"].includes((err as NodeJS.ErrnoException).code ?? "")) throw err;
    return {
      running: false,
      root: path.resolve(classroomsRoot()),
      port: servicePort(),
      log: servicePaths().log,
    };
  }
}
export async function ensureService(): Promise<any> {
  const version = (
    JSON.parse(fs.readFileSync(path.join(packageRoot(), "package.json"), "utf8")) as {
      version: string;
    }
  ).version;
  const identity = runtimeIdentity(packageRoot());
  async function compatible(status: any): Promise<void> {
    if (!validRuntimeIdentity(status.identity))
      throw new Error(
        "Existing service has missing, malformed, or unsupported runtime package identity. Stop it explicitly before retrying; no replacement was started.",
      );
    if (
      status.root !== path.resolve(classroomsRoot()) ||
      status.port !== servicePort() ||
      status.version !== version ||
      !sameRuntimeIdentity(status.identity, identity)
    )
      throw new Error(
        "Existing service has a different root, port, version, or runtime package content. Stop it explicitly before retrying; no replacement was started.",
      );
    const checked = await control<any>("/attachment");
    if (checked.pid !== status.pid || !sameRuntimeIdentity(checked.identity, identity))
      throw new Error("Service ownership changed during attachment. Retry explicitly.");
  }
  const legacyRoute = path.join(classroomsRoot(), ".pi-teach-pi", "phone.json");
  if (fs.existsSync(legacyRoute))
    throw new Error(
      `A legacy Pi tailnet route is still recorded at ${legacyRoute}. Stop that server explicitly with the previous Pi package before retrying. No route or saved data was replaced.`,
    );
  const status = await serviceStatus();
  if (status.running) {
    await compatible(status);
    return status;
  }
  const paths = servicePaths();
  fs.mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  const log = fs.openSync(paths.log, "a", 0o600);
  const child = spawn(process.execPath, [path.join(packageRoot(), "src", "service-main.ts")], {
    cwd: packageRoot(),
    detached: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, PI_CLASSROOMS_DIR: path.resolve(classroomsRoot()) },
  });
  fs.closeSync(log);
  child.unref();
  let spawnError: Error | undefined;
  child.on("error", (err) => {
    spawnError = err;
  });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    const current = await serviceStatus();
    if (current.running) {
      // A matching winner may be ready while our own child is still importing.
      // Finish this start only after our child owns the service or has exited.
      if (current.pid === child.pid || child.exitCode !== null || child.signalCode !== null) {
        await compatible(current);
        return current;
      }
    }
    if (child.exitCode !== null && !fs.existsSync(paths.lock))
      throw new Error(`Classroom service failed to start. Read ${paths.log}.`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Classroom service did not start within 10 seconds. Read ${paths.log}.`);
}
