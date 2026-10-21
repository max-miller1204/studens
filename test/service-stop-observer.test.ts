import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it("reproduces a closing IPC reset and observes ownership release before one final status assertion", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [
    new URL("./service-stop-observer-driver.mjs", import.meta.url).pathname,
  ]);
  expect(JSON.parse(stdout)).toEqual({
    oldObserver: "ECONNRESET",
    barrier: "PASS",
    finalStatusProbes: 1,
    noInference: true,
  });
}, 20_000);
