import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { afterAll, afterEach, expect, it } from "vitest";
import { readOwnedService, serviceOwnerExited } from "./service-process-owner.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "studens-owner-contract-"));
const paths = { lock: path.join(root, "owner.json"), socket: path.join(root, "control.sock") };
const owner = { pid: process.pid, packageRoot: root, port: 43123 };
afterAll(() => fs.rmSync(root, { recursive: true }));
afterEach(() => {
  for (const file of Object.values(paths)) fs.rmSync(file, { force: true });
});

it("requires the recorded package and port before fixture cleanup", () => {
  fs.writeFileSync(paths.lock, JSON.stringify(owner));
  expect(readOwnedService(paths.lock, owner)).toEqual(owner);
  expect(() => readOwnedService(paths.lock, { ...owner, port: owner.port + 1 })).toThrow();
  expect(() => readOwnedService(paths.lock, { ...owner, packageRoot: root + "-other" })).toThrow();
});

it("does not classify a live owner as stopped even when its paths are absent", () => {
  expect(serviceOwnerExited(owner, paths)).toBe(false);
});

it("requires owner exit and both ownership paths to disappear", async () => {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  const [code] = await once(child, "exit");
  expect(code).toBe(0);
  const exited = { ...owner, pid: child.pid! };
  fs.writeFileSync(paths.lock, JSON.stringify(exited));
  fs.writeFileSync(paths.socket, "stale");
  expect(serviceOwnerExited(exited, paths)).toBe(false);
  fs.unlinkSync(paths.lock);
  expect(serviceOwnerExited(exited, paths)).toBe(false);
  fs.unlinkSync(paths.socket);
  expect(serviceOwnerExited(exited, paths)).toBe(true);
});
