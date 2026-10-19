import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  makeFixture,
  seedClassroom,
  seedPreparedReviewSource,
  closeReviewVariants,
  writeGradedAttempt,
  termAnswer,
} from "./helpers.ts";
import { ensureService, servicePaths } from "../src/service-client.ts";
import { startDailyReview } from "../src/store/daily-review.ts";
import { reviewSessions } from "../src/review-session.ts";
import { TeacherService } from "../src/teacher-service.ts";
import { DAY_MS } from "../src/review.ts";

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
