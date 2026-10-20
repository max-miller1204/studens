import * as fs from "node:fs";
import * as path from "node:path";
import { expect, it } from "vitest";
import { makeFixture } from "./helpers.ts";
import { ensureService, servicePaths } from "../src/service-client.ts";

it("reports a recorded live-session Pi route from the format upgrade without replacing it", async () => {
  const f = makeFixture();
  const route = f.write(
    ".pi-teach-pi/phone.json",
    JSON.stringify({ host: "old.tailnet.ts.net", port: 8444, target: "http://127.0.0.1:40000" }),
  );
  const before = fs.readFileSync(route);
  try {
    await expect(ensureService()).rejects.toThrow(
      /^Classroom format upgrade failed: .*previous Studens package/,
    );
    expect(fs.readFileSync(route)).toEqual(before);
    expect(fs.existsSync(servicePaths().lock)).toBe(false);
    expect(fs.existsSync(path.join(f.root, ".studens-format.json"))).toBe(false);
  } finally {
    f.cleanup();
  }
});
