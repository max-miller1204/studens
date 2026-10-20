import { afterEach, beforeEach, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { makeFixture, seedClassroom, type Fixture } from "./helpers.ts";
import * as server from "../src/server.ts";
import { readTeacherState } from "../src/service-state.ts";
import { stateReadError } from "../src/state-errors.ts";
let f: Fixture;
const secret = "SECRET_ACTIVITY_CANARY_PRIVATE_DOCUMENT";
beforeEach(() => {
  f = makeFixture();
  seedClassroom(f);
  server.setHooks({
    delivery: "service",
    onAsk() {
      throw new Error("Unexpected inference");
    },
    onFollowUp() {
      throw new Error("Unexpected inference");
    },
    onQuizSubmit() {
      throw new Error("Unexpected inference");
    },
    onReflect() {
      throw new Error("Unexpected inference");
    },
    teacherState: (c) => readTeacherState(c) ?? { identity: { backend: "pi" }, requests: [] },
  });
});
afterEach(async () => {
  await server.close();
  f.cleanup();
});
it.each([
  "rust/.lesson-requests.json",
  "rust/.reviews.json",
  "rust/.review-refills.json",
  ".daily-reviews.json",
  "rust/.teacher.json",
  "rust/001-ownership/lesson.json",
])(
  "keeps malformed %s bytes out of activity HTTP and SSE without changing the source",
  async (relative) => {
    const base = await server.start(0);
    expect((await fetch(`${base}/api/activity?classroom=rust`)).status).toBe(200);
    const abort = new AbortController();
    const readers = [];
    for (const query of ["scope=root", "scope=classroom&classroom=rust"]) {
      const response = await fetch(`${base}/api/events?${query}`, { signal: abort.signal });
      const reader = response.body!.getReader();
      await reader.read();
      readers.push(reader);
    }
    try {
      const file = f.write(relative, secret);
      const hash = () => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
      const before = hash();
      for (const query of ["classroom=rust", "scope=root"]) {
        const response = await fetch(`${base}/api/activity?${query}`);
        const text = await response.text();
        expect(response.status).toBe(500);
        expect(text).not.toContain("SECRET_ACT");
        expect(text).toContain("malformed JSON");
        expect(text).toContain(path.basename(file));
      }
      server.pushEvent("rust", "001-ownership", "teacher", { private: secret });
      for (const reader of readers) {
        const frame = new TextDecoder().decode((await reader.read()).value);
        expect(frame).toBe("event: activity\ndata: {}\n\n");
      }
      expect(hash()).toBe(before);
    } finally {
      abort.abort();
    }
  },
);
it("keeps wrapped causes private while retaining categories and the original diagnostic for logs", () => {
  const original = new SyntaxError(secret);
  const wrapped = new Error(`Private wrapper ${secret}`, { cause: original });
  const safe = stateReadError("lesson request state rust/.lesson-requests.json", wrapped);
  expect(String(safe)).not.toContain("SECRET_ACT");
  expect(safe.message).toContain("malformed JSON");
  expect(safe.cause).toBe(wrapped);
  expect(stateReadError("outer", safe)).toBe(safe);
  const denied = Object.assign(new Error(secret), { code: "EACCES" });
  expect(stateReadError("teacher state rust/.teacher.json", denied).message).toContain(
    "filesystem error EACCES",
  );
});

it("contains nested private daily-document parse errors at the owning reader", async () => {
  const { seedPreparedReviewSource, writeGradedAttempt, termAnswer } = await import("./helpers.ts");
  const { startDailyReview, saveDailyReview, dailyReviews } =
    await import("../src/store/daily-review.ts");
  const { randomUUID } = await import("node:crypto");
  seedPreparedReviewSource(f.root);
  writeGradedAttempt({
    at: Date.now() - 2 * 86400000,
    answers: [termAnswer("q1", "owner")],
    correct: { q1: true },
  });
  const daily = startDailyReview(randomUUID(), "service");
  daily.groups[0].plan.document!.rubric_json = secret;
  saveDailyReview(daily);
  let captured: unknown;
  try {
    dailyReviews();
  } catch (error) {
    captured = error;
  }
  expect(String(captured)).toContain(".daily-reviews.json");
  expect(String(captured)).not.toContain("SECRET_ACT");
  const base = await server.start(0);
  for (const route of ["activity?classroom=rust", "activity?scope=root", "daily-review"]) {
    const response = await fetch(`${base}/api/${route}`);
    const text = await response.text();
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(text).toContain("malformed JSON");
    expect(text).not.toContain("SECRET_ACT");
  }
});
