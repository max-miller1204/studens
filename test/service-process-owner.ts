/** Observe fixture ownership without connecting to a listener during teardown. */
import * as fs from "node:fs";

export interface ServiceOwner {
  pid: number;
  packageRoot: string;
  port: number;
}

export function readOwnedService(
  lock: string,
  expected: Omit<ServiceOwner, "pid">,
): ServiceOwner | undefined {
  let text: string;
  try {
    text = fs.readFileSync(lock, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const owner = JSON.parse(text);
  if (
    !Number.isSafeInteger(owner.pid) ||
    owner.pid <= 0 ||
    owner.packageRoot !== expected.packageRoot ||
    owner.port !== expected.port
  )
    throw new Error(`Unexpected service fixture owner at ${lock}.`);
  return owner;
}

export function serviceOwnerExited(
  owner: ServiceOwner,
  paths: { lock: string; socket: string },
): boolean {
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
  return !fs.existsSync(paths.lock) && !fs.existsSync(paths.socket);
}
