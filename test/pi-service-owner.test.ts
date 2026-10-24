import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import * as net from "node:net";
import { expect, it } from "vitest";
import {
  makeFixture,
  seedClassroom,
  seedPreparedReviewSource,
  closeReviewVariants,
  writeGradedAttempt,
  termAnswer,
} from "./helpers.ts";
import { control, ensureService, servicePaths, serviceStatus } from "../src/service-client.ts";
import { PiServiceClient } from "../src/pi-service-client.ts";
import { startDailyReview } from "../src/store/daily-review.ts";
import { reviewSessions } from "../src/review-session.ts";
import { TeacherService } from "../src/teacher-service.ts";
import { DAY_MS } from "../src/review.ts";
import { waitForOwnedServiceStop } from "../scripts/service-stop-observer.ts";
import type { ServiceOwner } from "./service-process-owner.ts";

it("rejects recorded legacy Pi route ownership without replacing the route or starting a service", async () => {
  const f = makeFixture();
  const route = f.write(
    ".pi-teach-pi/phone.json",
    JSON.stringify({ host: "old.tailnet.ts.net", port: 8444, target: "http://127.0.0.1:40000" }),
  );
  const before = fs.readFileSync(route);
  try {
    await expect(ensureService()).rejects.toThrow(/previous Pi package/);
    expect(fs.readFileSync(route)).toEqual(before);
    expect(fs.existsSync(servicePaths().lock)).toBe(false);
    expect(fs.existsSync(path.join(servicePaths().dir, "service.log"))).toBe(false);
  } finally {
    f.cleanup();
  }
});

it("rejects legacy route ownership even when the persistent service already runs", async () => {
  const f = makeFixture();
  seedClassroom(f);
  const previousPort = process.env.PI_CLASSROOM_SERVICE_PORT;
  const previousTailnet = process.env.PI_CLASSROOM_TAILSCALE;
  const listener = net.createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  process.env.PI_CLASSROOM_SERVICE_PORT = String((listener.address() as net.AddressInfo).port);
  await new Promise<void>((resolve) => listener.close(() => resolve()));
  process.env.PI_CLASSROOM_TAILSCALE = "0";
  let owner: ServiceOwner | undefined;
  let stopAcknowledged = false;
  try {
    const original = await ensureService();
    owner = original;
    const file = f.write(
      ".pi-teach-pi/phone.json",
      JSON.stringify({ host: "old.tailnet.ts.net", port: 8444, target: "http://127.0.0.1:40000" }),
    );
    const before = fs.readFileSync(file);
    await expect(
      new PiServiceClient().call("open_classroom", { classroom: "rust" }),
    ).rejects.toThrow("previous Pi package");
    expect(fs.readFileSync(file)).toEqual(before);
    expect(fs.existsSync(path.join(f.root, "rust/.teacher.json"))).toBe(false);
    expect((await serviceStatus()).pid).toBe(original.pid);
    // Management remains available so this error cannot trap an incompatible owner.
    await new PiServiceClient().call("classroom_service", { action: "stop" });
    stopAcknowledged = true;
  } finally {
    if (owner) {
      if (!stopAcknowledged) await control("/stop", {});
      await waitForOwnedServiceStop(owner, servicePaths());
    }
    if (previousPort === undefined) delete process.env.PI_CLASSROOM_SERVICE_PORT;
    else process.env.PI_CLASSROOM_SERVICE_PORT = previousPort;
    if (previousTailnet === undefined) delete process.env.PI_CLASSROOM_TAILSCALE;
    else process.env.PI_CLASSROOM_TAILSCALE = previousTailnet;
    f.cleanup();
  }
}, 30_000);

it.each(["pi", "claude", "codex"] as const)(
  "rejects unpublished legacy Pi daily plans before creating %s teacher ownership",
  async (backend) => {
    const f = makeFixture();
    seedClassroom(f);
    seedPreparedReviewSource(f.root, "rust");
    closeReviewVariants(f.root, "rust");
    writeGradedAttempt({
      classroom: "rust",
      at: Date.now() - 2 * DAY_MS,
      answers: [termAnswer("q1", "owner")],
      correct: { q1: true },
    });
    const request = startDailyReview(randomUUID(), "pi");
    const file = path.join(f.root, ".daily-reviews.json");
    const before = fs.readFileSync(file);
    const teacher = new TeacherService(async () => {
      throw new Error("Must not run before ownership is resolved.");
    });
    try {
      expect(request.groups).toHaveLength(1);
      expect(reviewSessions("rust")).toEqual([]);
      expect(() => teacher.attach("rust", backend)).toThrow(
        `unfinished legacy Pi work ${request.groups[0].plan.id}`,
      );
      expect(fs.readFileSync(file)).toEqual(before);
      expect(fs.existsSync(path.join(f.root, "rust/.teacher.json"))).toBe(false);
      expect(reviewSessions("rust")).toEqual([]);
    } finally {
      await teacher.stop();
      f.cleanup();
    }
  },
);
