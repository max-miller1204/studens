import * as fs from "node:fs";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { packageRoot } from "../src/paths.ts";
import { makeFixture } from "./helpers.ts";

it("rejects a declared Node version below the production SDK minimum before launching", () => {
  const fixture = makeFixture();
  try {
    // Exercise the actual launcher guard; this is not a Node 22.18 compatibility run.
    const launch = pathToFileURL(path.join(packageRoot(), "mcp/launch.mjs")).href;
    const result = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `Object.defineProperty(process.versions, "node", { value: "22.18.0" }); await import(${JSON.stringify(launch)});`,
      ],
      {
        input: "",
        encoding: "utf8",
        cwd: fixture.root,
        env: { ...process.env, PI_CLASSROOMS_DIR: fixture.root, PI_CLASSROOM_TAILSCALE: "0" },
      },
    );
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("22.19");
    expect(result.stderr).toContain("22.18.0");
  } finally {
    fixture.cleanup();
  }
});

it("loads the parser after first-start bootstrap with other dependencies already present", () => {
  const fixture = makeFixture();
  try {
    const app = path.join(fixture.root, "app"),
      bin = path.join(fixture.root, "bin");
    fs.mkdirSync(path.join(app, "mcp"), { recursive: true });
    fs.mkdirSync(path.join(app, "src"));
    fs.mkdirSync(bin);
    fs.copyFileSync(path.join(packageRoot(), "mcp/launch.mjs"), path.join(app, "mcp/launch.mjs"));
    fs.writeFileSync(path.join(app, "package.json"), '{"type":"module"}');
    // Unit package/installer fixtures isolate Node's missing-package resolution
    // cache. The real production archive gate separately uses npm ci and the SDK.
    for (const name of ["marked", "@earendil-works/pi-coding-agent"]) {
      const dir = path.join(app, "node_modules", name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name, main: "index.js" }));
      fs.writeFileSync(path.join(dir, "index.js"), "");
    }
    fs.writeFileSync(
      path.join(app, "src/mcp-stdio.ts"),
      'import { fixture } from "parse5"; console.log(JSON.stringify({ loaded: fixture }));',
    );
    fs.writeFileSync(
      path.join(bin, "npm"),
      `#!${process.execPath}\n` +
        'const fs = require("node:fs"); fs.writeFileSync("install-arguments.json", JSON.stringify(process.argv.slice(2))); fs.mkdirSync("node_modules/parse5/dist", { recursive: true }); fs.writeFileSync("node_modules/parse5/package.json", JSON.stringify({ name: "parse5", type: "module", exports: { ".": "./dist/index.js" } })); fs.writeFileSync("node_modules/parse5/dist/index.js", "export const fixture = true;");',
      { mode: 0o700 },
    );
    const result = spawnSync(process.execPath, [path.join(app, "mcp/launch.mjs")], {
      cwd: app,
      input: "",
      encoding: "utf8",
      timeout: 10000,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        PI_CLASSROOMS_DIR: fixture.root,
        PI_CLASSROOM_TAILSCALE: "0",
      },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ loaded: true });
    expect(JSON.parse(fs.readFileSync(path.join(app, "install-arguments.json"), "utf8"))).toEqual([
      "ci",
      "--omit=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ]);
  } finally {
    fixture.cleanup();
  }
});
