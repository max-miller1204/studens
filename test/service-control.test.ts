import * as fs from "node:fs";
import * as http from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { control, servicePaths, ensureService } from "../src/service-client.ts";
import { makeFixture } from "./helpers.ts";

afterEach(() => vi.restoreAllMocks());

it("keeps ordered opens connected while ordinary control calls retain their timeout", async () => {
  const fixture = makeFixture();
  const socket = servicePaths().socket;
  const listener = http.createServer(async (req, res) => {
    for await (const _chunk of req) {
      /* Wait for the complete request. */
    }
    setTimeout(() => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ready":true}');
    }, 80);
  });
  const original = http.ClientRequest.prototype.setTimeout;
  const deadlines: number[] = [];
  vi.spyOn(http.ClientRequest.prototype, "setTimeout").mockImplementation(function (
    this: http.ClientRequest,
    ms,
    callback,
  ) {
    deadlines.push(ms);
    return original.call(this, ms === 0 ? 0 : 20, callback);
  });
  try {
    await new Promise<void>((resolve) => listener.listen(socket, resolve));
    await expect(control("/status")).rejects.toThrow("Classroom control request timed out");
    const opened = await control("/rpc", {
      message: { method: "tools/call", params: { name: "open_classroom" } },
    });
    expect(opened).toEqual({ ready: true });
    expect(deadlines).toEqual([190_000, 0]);
  } finally {
    await new Promise<void>((resolve, reject) =>
      listener.close((error) => (error ? reject(error) : resolve())),
    );
    if (fs.existsSync(socket)) fs.unlinkSync(socket);
    fixture.cleanup();
  }
});

it.each([undefined, { schema: 2, sha256: "a".repeat(64) }, { schema: 1, sha256: "invalid" }])(
  "refuses an older or unsupported owner without creating service state: %j",
  async (identity) => {
    const fixture = makeFixture();
    const paths = servicePaths();
    const endpoints: string[] = [];
    const listener = http.createServer((req, res) => {
      endpoints.push(req.url!);
      res.end(JSON.stringify({ running: true, identity }));
    });
    try {
      await new Promise<void>((resolve) => listener.listen(paths.socket, resolve));
      await expect(ensureService()).rejects.toThrow(
        "missing, malformed, or unsupported runtime package identity",
      );
      expect(endpoints).toEqual(["/status"]);
      expect(fs.existsSync(paths.dir)).toBe(false);
    } finally {
      await new Promise<void>((resolve) => listener.close(() => resolve()));
      fixture.cleanup();
    }
  },
);
