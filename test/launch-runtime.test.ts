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
