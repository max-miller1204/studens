import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

describe("release version commands", () => {
  let root: string;
  const files = ["package.json", "package-lock.json", ".codex-plugin/plugin.json"];
  function read(file: string): string {
    return fs.readFileSync(path.join(root, file), "utf8");
  }
  function write(file: string, value: unknown): void {
    fs.writeFileSync(path.join(root, file), JSON.stringify(value, null, 2) + "\n");
  }
  function run(...args: string[]) {
    return spawnSync(process.execPath, [path.join(root, "scripts/versions.ts"), ...args], {
      encoding: "utf8",
    });
  }
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "studens-versions-"));
    fs.mkdirSync(path.join(root, "scripts"));
    fs.mkdirSync(path.join(root, ".codex-plugin"));
    fs.copyFileSync(
      new URL("../scripts/versions.ts", import.meta.url),
      path.join(root, "scripts/versions.ts"),
    );
    write("package.json", { name: "fixture", version: "1.2.3", private: true, type: "module" });
    write("package-lock.json", {
      name: "fixture",
      version: "1.2.3",
      lockfileVersion: 3,
      packages: {
        "": { name: "fixture", version: "1.2.3", dependencies: { marked: "^15.0.12" } },
        "node_modules/marked": {
          version: "15.0.12",
          resolved: "https://registry.npmjs.org/marked/-/marked-15.0.12.tgz",
          integrity: "fixture-integrity",
        },
      },
    });
    write(".codex-plugin/plugin.json", { name: "fixture", version: "1.2.3" });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("checks matching versions without writing", () => {
    const before = files.map(read);
    expect(run("check").status).toBe(0);
    expect(files.map(read)).toEqual(before);
  });

  it.each(["package", "lock", "lock root", "plugin"])("detects drift in %s", (field) => {
    const file = field === "package" ? files[0] : field === "plugin" ? files[2] : files[1];
    const document = JSON.parse(read(file));
    if (field === "lock root") document.packages[""].version = "9.0.0";
    else document.version = "9.0.0";
    write(file, document);
    const before = files.map(read);
    const result = run("check");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("9.0.0");
    expect(result.stderr).toContain(file);
    expect(files.map(read)).toEqual(before);
    expect(run("bump", "2.0.0").status).toBe(0);
    expect(run("check").status).toBe(0);
  });

  it.each(["2.0.0", "2.0.0-beta.1+build.7"])(
    "sets all four versions to %s and preserves every other field",
    (version) => {
      const before = files.map((file) => JSON.parse(read(file)));
      expect(run("bump", version).status).toBe(0);
      const after = files.map((file) => JSON.parse(read(file)));
      expect(after.map((document) => document.version)).toEqual([version, version, version]);
      expect(after[1].packages[""].version).toBe(version);
      for (const document of after) document.version = "1.2.3";
      after[1].packages[""].version = "1.2.3";
      expect(after).toEqual(before);
      const firstBump = files.map(read);
      expect(run("bump", version).status).toBe(0);
      expect(files.map(read)).toEqual(firstBump);
    },
  );

  it("preserves formatting and escapes, including dependency versions equal to the old release", () => {
    const plugin =
      '{ "name": "fixture", "version": "1.2.3", "keywords": ["a", "b"], "description": "\\u0061" }';
    fs.writeFileSync(path.join(root, files[2]), plugin);
    const lock = JSON.parse(read(files[1]));
    lock.packages["node_modules/marked"].version = "1.2.3";
    write(files[1], lock);
    const before = files.map(read);
    expect(run("bump", "2.0.0").status).toBe(0);
    expect(read(files[0])).toBe(before[0].replace('"version": "1.2.3"', '"version": "2.0.0"'));
    expect(read(files[1])).toBe(
      before[1]
        .replace('"version": "1.2.3"', '"version": "2.0.0"')
        .replace('      "version": "1.2.3"', '      "version": "2.0.0"'),
    );
    expect(read(files[2])).toBe(plugin.replace('"version": "1.2.3"', '"version": "2.0.0"'));
  });

  it.each([
    [],
    ["bump"],
    ["bump", "patch"],
    ["bump", "v1.0.0"],
    ["bump", "01.0.0"],
    ["bump", "1.0.0-01"],
    ["check", "extra"],
  ])("rejects invalid arguments %j without writing", (...args) => {
    const before = files.map(read);
    expect(run(...args).status).toBe(1);
    expect(files.map(read)).toEqual(before);
  });

  it.each(["missing root", "invalid version", "invalid JSON"])(
    "validates all input before writes: %s",
    (problem) => {
      if (problem === "invalid JSON") fs.writeFileSync(path.join(root, files[2]), "{");
      else {
        const lock = JSON.parse(read(files[1]));
        if (problem === "missing root") delete lock.packages[""];
        else lock.version = "broken";
        write(files[1], lock);
      }
      const before = files.map(read);
      expect(run("check").status).toBe(1);
      expect(run("bump", "2.0.0").status).toBe(1);
      expect(files.map(read)).toEqual(before);
    },
  );
});
