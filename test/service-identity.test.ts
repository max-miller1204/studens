import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import {
  runtimeIdentity,
  runtimePaths,
  sameRuntimeIdentity,
  assertRuntimeUnchanged,
} from "../src/service-identity.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "studens-identity-"));
  roots.push(root);
  for (const file of runtimePaths) {
    if (["src", "assets", "skills", "mcp"].includes(file)) fs.mkdirSync(path.join(root, file));
    else write(root, file, "fixture");
  }
  write(root, "src/runtime.ts", "export const value = 1;");
  write(root, "package.json", JSON.stringify({ version: "0.12.0", dependencies: { prod: "1" } }));
  write(
    root,
    "package-lock.json",
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        "": {},
        "node_modules/prod": { version: "1" },
        "node_modules/dev": { dev: true, version: "1" },
      },
    }),
  );
  write(root, "node_modules/prod/package.json", JSON.stringify({ version: "1", main: "index.js" }));
  write(root, "node_modules/prod/index.js", "module.exports = 1;");
  return root;
}
function write(root: string, file: string, bytes: string): void {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), bytes);
}
it("accepts equal copies across paths and development vs production-only installs", () => {
  const a = fixture(),
    b = fixture();
  write(a, "node_modules/dev/package.json", '{"version":"1"}');
  write(a, "node_modules/.package-lock.json", "cache");
  write(a, "test/dev.ts", "development");
  expect(runtimeIdentity(a)).toEqual(runtimeIdentity(b));
});
it.each([
  "src/runtime.ts",
  "assets/template.html",
  "skills/teach/SKILL.md",
  "docs/TEACHING.md",
  "mcp/launch.mjs",
  "node_modules/prod/index.js",
  "node_modules/prod/package.json",
])("rejects same-version changes in %s", (file) => {
  const a = fixture(),
    b = fixture();
  // Keep dependency manifests valid while changing their bytes.
  write(
    b,
    file,
    file.endsWith("package.json") ? '{"version":"1","main":"index.js","changed":true}' : "changed",
  );
  expect(sameRuntimeIdentity(runtimeIdentity(a), runtimeIdentity(b))).toBe(false);
});
it("retains the startup identity and rejects mutation even when another copy matches new disk bytes", () => {
  const root = fixture(),
    startup = runtimeIdentity(root);
  write(root, "src/runtime.ts", "changed");
  expect(() => assertRuntimeUnchanged(root, startup)).toThrow("changed after startup");
});
it.each([
  undefined,
  {},
  { schema: 2, sha256: "a".repeat(64) },
  { schema: 1, sha256: "invalid" },
  { schema: 1, sha256: "a".repeat(64), extra: 1 },
])("rejects missing/malformed/unsupported evidence %j", (identity) => {
  expect(sameRuntimeIdentity(identity, runtimeIdentity(fixture()))).toBe(false);
});
it.each(["docs/TEACHING.md", "node_modules/prod/package.json", "node_modules/prod"])(
  "rejects missing required %s",
  (file) => {
    const root = fixture();
    fs.rmSync(path.join(root, file), { recursive: true });
    expect(() => runtimeIdentity(root)).toThrow();
  },
);
it("rejects symbolic links and special files rather than hashing their targets", () => {
  const root = fixture();
  fs.symlinkSync("runtime.ts", path.join(root, "src/linked.ts"));
  expect(() => runtimeIdentity(root)).toThrow("symbolic links");
});
it("rejects production dependency resolution into a development-only package", () => {
  const root = fixture();
  write(root, "node_modules/prod/package.json", '{"version":"1","dependencies":{"dev":"1"}}');
  write(root, "node_modules/dev/package.json", '{"version":"1"}');
  expect(() => runtimeIdentity(root)).toThrow("outside the production closure");
});

async function guardedImport(root: string, files: Map<string, string>): Promise<void> {
  const helper = pathToFileURL(path.resolve("src/service-identity.ts")).href;
  const entry = pathToFileURL(path.join(root, "src/runtime.ts")).href;
  await promisify(execFile)(process.execPath, [
    "--input-type=module",
    "-e",
    `
    import {guardRuntimeModules} from ${JSON.stringify(helper)};
    guardRuntimeModules(new Map(${JSON.stringify([...files])}));
    await import(${JSON.stringify(entry)});
  `,
  ]);
}
it("prevents undeclared runtime imports from using an unhashed development package", async () => {
  const root = fixture();
  write(root, "src/runtime.ts", 'import "dev";');
  write(root, "node_modules/dev/package.json", '{"version":"1","main":"index.js"}');
  write(root, "node_modules/dev/index.js", "throw new Error('must not execute');");
  const files = new Map<string, string>();
  runtimeIdentity(root, files);
  await expect(guardedImport(root, files)).rejects.toThrow("outside the package identity");
});
it("checks the source delivered by Node before evaluating a changed lazy module", async () => {
  const root = fixture(),
    files = new Map<string, string>();
  runtimeIdentity(root, files);
  write(root, "src/runtime.ts", "throw new Error('must not execute');");
  await expect(guardedImport(root, files)).rejects.toThrow("Runtime module changed after startup");
});
it("loads matching source from its captured runtime closure", async () => {
  const root = fixture(),
    files = new Map<string, string>();
  runtimeIdentity(root, files);
  await expect(guardedImport(root, files)).resolves.toBeUndefined();
});
