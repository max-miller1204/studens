import { afterEach, beforeEach, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import {
  discoverRefills,
  refillRequests,
  updateRefill,
  saveRefillPlan,
  applyRefill,
} from "../src/review-refill.ts";
import { lessonPools } from "../src/review-pool.ts";
import { startReview, completePreparedReview } from "../src/review-session.ts";
import * as store from "../src/store.ts";
import {
  makeFixture,
  seedClassroom,
  seedPreparedReviewSource,
  termAnswer,
  writeGradedAttempt,
  refillPlan,
} from "./helpers.ts";
import type { Fixture } from "./helpers.ts";
let fixture: Fixture;
beforeEach(() => {
  fixture = makeFixture();
  seedClassroom(fixture);
  seedPreparedReviewSource(fixture.root);
  writeGradedAttempt({
    at: 1,
    answers: [termAnswer("q1", "the original owner", { prompt: "Who releases a moved value?" })],
    correct: { q1: false },
  });
});
afterEach(() => fixture.cleanup());
const variants = (request: ReturnType<typeof discoverRefills>[number]) =>
  JSON.parse(refillPlan(request).calls[0].arguments_json).variants;

it("deduplicates targeted misses and low pools, and keeps plans and keys private", () => {
  const request = discoverRefills("rust", "pi")[0];
  expect(request.reason).toBe("miss");
  expect(request.prompt).toContain("the original owner");
  expect(request.prompt).toContain("Not quite");
  expect(discoverRefills("rust", "pi")).toHaveLength(1);
  expect(discoverRefills("rust", "service")).toHaveLength(0);
  const key = fs.readFileSync(path.join(fixture.root, "rust/001-ownership/quiz/key.json"), "utf8");
  updateRefill(request, "running");
  saveRefillPlan(request, variants(request));
  expect(lessonPools("rust", "001-ownership").get("check-1/q1")).toHaveLength(2);
  applyRefill(request);
  applyRefill(request);
  expect(lessonPools("rust", "001-ownership").get("check-1/q1")).toHaveLength(3);
  expect(fs.readFileSync(path.join(fixture.root, "rust/001-ownership/quiz/key.json"), "utf8")).toBe(
    key,
  );
  const session = startReview("rust", randomUUID(), "pi").session;
  completePreparedReview(session);
  // Three variants still leave two unseen questions, so there is no low-pool request.
  expect(discoverRefills("rust", "pi")).toHaveLength(1);
  expect(store.listGrades("rust", "001-ownership")).toHaveLength(1);
});

it("rejects invalid or colliding output before saving a plan", () => {
  const request = discoverRefills("rust", "pi")[0];
  updateRefill(request, "running");
  const bad = variants(request);
  bad[0].id = "v1";
  bad[0].html = bad[0].html.replace(/data-question-id="[^"]+"/, 'data-question-id="v1"');
  expect(() => saveRefillPlan(request, bad)).toThrow("existing variant id");
  expect(refillRequests("rust")[0].plan).toBeUndefined();
  expect(() => saveRefillPlan(request, [])).toThrow("one");
});
