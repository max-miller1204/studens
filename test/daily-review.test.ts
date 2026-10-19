import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _overrideClassroomsDir, lessonDir } from "../src/paths.ts";
import * as server from "../src/server.ts";
import * as store from "../src/store.ts";
import { completePreparedReview, reviewSessions, startReview } from "../src/review-session.ts";
import { dailyReviews, startDailyReview } from "../src/store/daily-review.ts";
import { saveTeacherState } from "../src/service-state.ts";
import { DAY_MS } from "../src/review.ts";
import {
  makeFixture,
  seedClassroom,
  seedPreparedReviewSource,
  closeReviewVariants,
  termAnswer,
  writeGradedAttempt,
  type Fixture,
} from "./helpers.ts";

let fixture: Fixture;
let base: string;
let published: string[];
let blocked: string;
beforeEach(async () => {
  fixture = makeFixture();
  for (const classroom of ["biology", "rust"]) {
    seedClassroom(fixture, { classroom, title: classroom });
    seedPreparedReviewSource(fixture.root, classroom);
    closeReviewVariants(fixture.root, classroom);
    writeGradedAttempt({
      classroom,
      at: Date.now() - 2 * DAY_MS,
      answers: [
        termAnswer("q1", "owner", {
          learning: {
            objectiveId: "owner",
            objective: { statement: "Explain ownership.", application: false },
            task: "retrieval",
            support: "independent",
            assistance: "none",
          },
        }),
      ],
      correct: { q1: true },
    });
  }
  published = [];
  blocked = "";
  server.setHooks({
    delivery: "service",
    reviewOwner: "service",
    canAccept: (classroom) => {
      if (classroom === blocked) throw new Error(`No teacher owns classroom ${classroom}.`);
    },
    onReview: (session) => {
      // Every plan must precede the first classroom publication.
      expect(dailyReviews()[0].groups).toHaveLength(2);
      published.push(session.classroom);
      completePreparedReview(session);
    },
    onReviewRetry: (session) => completePreparedReview(session),
    onAsk: () => {},
    onFollowUp: () => {},
    onQuizSubmit: () => {},
    onReflect: () => {},
  });
  base = await server.start(0);
});
afterEach(async () => {
  await server.close();
  fixture.cleanup();
});
const post = async (route: string, body: unknown) => {
  const response = await fetch(`${base}/api/${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};
async function finish(classroom: string) {
  const session = reviewSessions(classroom)[0];
  const response = await post("quiz/submit", {
    classroom,
    lesson: session.lesson,
    quizId: "review",
    kind: "review",
    answers: [
      {
        questionId: "r1",
        type: "choice",
        assistance: "none",
        value: "owner",
        label: "The new owner",
        reviewOf: session.items[0].key,
      },
    ],
  });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
}

describe("daily review durability", () => {
  it("saves grouped plans before publication, reuses clicks, and rejects stale progression", async () => {
    const id = randomUUID();
    const first = await post("daily-review", { id });
    expect(first.status).toBe(202);
    expect(first.body.daily.groups.map((g: { classroom: string }) => g.classroom)).toEqual([
      "biology",
      "rust",
    ]);
    expect(published).toEqual(["biology"]);
    expect(reviewSessions("rust")).toHaveLength(0);
    await Promise.all([post("daily-review", { id }), post("daily-review", { id: randomUUID() })]);
    expect(dailyReviews()).toHaveLength(1);
    expect(reviewSessions("biology")).toHaveLength(1);
    await post("daily-review/continue", { id, classroom: "rust" });
    expect(reviewSessions("rust")).toHaveLength(0);
    await finish("biology");
    await post("daily-review", { id: randomUUID() });
    expect(reviewSessions("rust")).toHaveLength(0);
    await post("daily-review/continue", { id, classroom: "biology" });
    expect(reviewSessions("rust")).toHaveLength(0);
    await post("daily-review/continue", { id, classroom: "rust" });
    expect(published).toEqual(["biology", "rust"]);
    await finish("rust");
    const result = await (await fetch(`${base}/api/daily-review?id=${id}`)).json();
    expect(result.daily.complete).toBe(true);
    expect(result.due).toEqual({ biology: 0, rust: 0 });
    await post("daily-review", { id });
    expect(dailyReviews()).toHaveLength(1);
    expect(reviewSessions("rust")).toHaveLength(1);
  });
  it("retains partial progress and ownership failures until explicit retry", async () => {
    const id = randomUUID();
    await post("daily-review", { id });
    await finish("biology");
    const original = store.listGrades("biology", reviewSessions("biology")[0].lesson);
    blocked = "rust";
    const failed = await post("daily-review/continue", { id, classroom: "rust" });
    expect(failed.body.daily.groups[1].error).toContain("No teacher owns classroom rust");
    expect(reviewSessions("rust")).toHaveLength(0);
    blocked = "";
    await post("daily-review", { id });
    await fetch(`${base}/api/daily-review?id=${id}`);
    expect(reviewSessions("rust")).toHaveLength(0);
    await post("daily-review/retry", { id, classroom: "rust" });
    expect(reviewSessions("rust")).toHaveLength(1);
    expect(store.listGrades("biology", reviewSessions("biology")[0].lesson)).toEqual(original);
  });
  it("refuses another host's unpublished review and competing unfinished work", async () => {
    const foreign = startReview("biology", randomUUID(), "pi").session;
    const failed = await post("daily-review", { id: randomUUID() });
    expect(failed.status).toBe(409);
    expect(failed.body.error).toContain("belongs to pi");
    expect(dailyReviews()).toHaveLength(0);
    completePreparedReview(foreign);
    const id = randomUUID();
    await post("daily-review", { id });
    await finish("biology");
    const competing = startReview("rust", randomUUID(), "service").session;
    const stale = await post("daily-review/continue", { id, classroom: "rust" });
    expect(stale.body.daily.groups[1].error).toContain("Another unfinished review");
    expect(reviewSessions("rust").map((r) => r.id)).toEqual([competing.id]);
  });
  it("requires explicit refresh when an unstarted group's canonical due selection changes", async () => {
    const id = randomUUID();
    await post("daily-review", { id });
    await finish("biology");
    writeGradedAttempt({
      classroom: "rust",
      at: Date.now(),
      answers: [
        termAnswer("q1", "owner", {
          learning: {
            objectiveId: "owner",
            objective: { statement: "Explain ownership.", application: false },
            task: "retrieval",
            support: "independent",
            assistance: "none",
          },
        }),
      ],
      correct: { q1: true },
    });
    const original = store.listGrades("rust", "001-ownership");
    const stale = await post("daily-review/continue", { id, classroom: "rust" });
    expect(stale.body.daily.groups[1].error).toContain("no longer due or eligible");
    expect(reviewSessions("rust")).toHaveLength(0);
    await fetch(`${base}/api/daily-review?id=${id}`);
    expect(dailyReviews()[0].groups[1].empty).toBeUndefined();
    const refreshed = await post("daily-review/retry", { id, classroom: "rust" });
    expect(refreshed.body.daily.complete).toBe(true);
    expect(refreshed.body.daily.groups[1].empty).toBe(true);
    expect(refreshed.body.daily.groups[1].count).toBe(0);
    expect(reviewSessions("rust")).toHaveLength(0);
    expect(store.listGrades("rust", "001-ownership")).toEqual(original);
  });
  it("keeps a persistent classroom backend on reload through a Pi daily request", async () => {
    saveTeacherState("biology", {
      version: 1,
      identity: { backend: "claude" },
      requests: [],
      messages: [],
    });
    server.setHooks({
      reviewOwner: "pi",
      onReview: completePreparedReview,
      onReviewRetry: completePreparedReview,
      onAsk: () => {},
      onFollowUp: () => {},
      onQuizSubmit: () => {},
      onReflect: () => {},
    });
    const result = await post("daily-review", { id: randomUUID() });
    expect(result.status).toBe(409);
    expect(result.body.error).toContain("belongs to claude");
    expect(dailyReviews()).toHaveLength(0);
    expect(reviewSessions("biology")).toHaveLength(0);
    const read = await (await fetch(`${base}/api/daily-review`)).json();
    expect(read.daily).toBeNull();
    expect(reviewSessions("biology")).toHaveLength(0);
  });
  it.each(["daily-review", "daily-review/continue", "daily-review/retry"])(
    "rejects foreign %s without changing an existing owner's batch",
    async (route) => {
      saveTeacherState("biology", {
        version: 1,
        identity: { backend: "claude" },
        requests: [],
        messages: [],
      });
      const id = randomUUID();
      await post("daily-review", { id });
      const state = path.join(fixture.root, ".daily-reviews.json");
      const snapshot = fs.readFileSync(state, "utf8");
      const publishedBefore = [...published];
      server.setHooks({
        reviewOwner: "pi",
        onReview: completePreparedReview,
        onReviewRetry: completePreparedReview,
        onAsk() {},
        onFollowUp() {},
        onQuizSubmit() {},
        onReflect() {},
      });
      const foreign = await post(route, {
        id: route === "daily-review" ? randomUUID() : id,
        classroom: "biology",
      });
      expect.soft(fs.readFileSync(state, "utf8")).toBe(snapshot);
      expect(foreign.status).toBe(409);
      expect(foreign.body.error).toContain("belongs to claude");
      expect(fs.readFileSync(state, "utf8")).toBe(snapshot);
      expect(published).toEqual(publishedBefore);
      const read = await (await fetch(`${base}/api/daily-review?id=${id}`)).json();
      expect(read.daily.groups[0].error).toContain("belongs to claude");
      expect(fs.readFileSync(state, "utf8")).toBe(snapshot);
      expect(
        (await fetch(`${base}/c/biology/reviews/${reviewSessions("biology")[0].lesson}`)).status,
      ).toBe(200);
    },
  );
  it("keeps private selections off routes and rejects state and ancestor symlinks", async () => {
    const request = startDailyReview(randomUUID(), "service");
    for (const route of [
      "/.daily-reviews.json",
      "/reviews/daily/.daily-reviews.json",
      "/c/rust/.daily-reviews.json",
      "/c/rust/.reviews.json",
      `/c/rust/reviews/${request.groups[1].plan.lesson}/quiz/key.json`,
    ])
      expect((await fetch(base + route)).status).toBe(404);
    const state = path.join(fixture.root, ".daily-reviews.json");
    const outside = fixture.write("outside.json", "{}");
    fs.renameSync(state, `${state}.original`);
    fs.symlinkSync(outside, state);
    expect(() => dailyReviews()).toThrow("cannot be a symlink");
    fs.unlinkSync(state);
    fs.renameSync(`${state}.original`, state);
    const alias = `${fixture.root}-alias`;
    fs.symlinkSync(fixture.root, alias);
    _overrideClassroomsDir(alias);
    try {
      expect(() => dailyReviews()).toThrow("cannot be a symlink");
    } finally {
      _overrideClassroomsDir(fixture.root);
      fs.unlinkSync(alias);
    }
  });
  it("rejects concurrent and interrupted edits until explicit retry, including private lock symlinks", async () => {
    const lock = fixture.write(".daily-reviews.lock", "123\n");
    const id = randomUUID();
    const busy = await post("daily-review", { id });
    expect(busy.status).toBe(409);
    expect(busy.body.error).toContain("Another server has locked daily review edits");
    expect(dailyReviews()).toHaveLength(0);
    fs.unlinkSync(lock);
    await post("daily-review", { id });
    await finish("biology");
    const snapshot = fs.readFileSync(path.join(fixture.root, ".daily-reviews.json"), "utf8");
    fixture.write(".daily-reviews.lock", "stale\n");
    const blocked = await post("daily-review/continue", { id, classroom: "rust" });
    expect(blocked.status).toBe(409);
    expect(fs.readFileSync(path.join(fixture.root, ".daily-reviews.json"), "utf8")).toBe(snapshot);
    expect(reviewSessions("rust")).toHaveLength(0);
    await fetch(`${base}/api/daily-review?id=${id}`);
    expect(reviewSessions("rust")).toHaveLength(0);
    fs.unlinkSync(lock);
    await post("daily-review/continue", { id, classroom: "rust" });
    expect(reviewSessions("rust")).toHaveLength(1);
    fs.symlinkSync(fixture.write("outside-lock", "private"), lock);
    expect((await post("daily-review", { id })).body.error).toContain("cannot be a symlink");
    expect(fs.readFileSync(path.join(fixture.root, "outside-lock"), "utf8")).toBe("private");
  });
  it("refreshes an unstarted retired objective without altering completed evidence", async () => {
    const id = randomUUID();
    await post("daily-review", { id });
    await finish("biology");
    const completed = store.listGrades("biology", reviewSessions("biology")[0].lesson);
    const item = store.reviewItems("rust")[0];
    store.setReviewRetired("rust", item.key, true, 0);
    const stale = await post("daily-review/continue", { id, classroom: "rust" });
    expect(stale.body.daily.groups[1].error).toContain("no longer due or eligible");
    expect(reviewSessions("rust")).toHaveLength(0);
    const refreshed = await post("daily-review/retry", { id, classroom: "rust" });
    expect(refreshed.body.daily.complete).toBe(true);
    expect(reviewSessions("rust")).toHaveLength(0);
    expect(store.listGrades("biology", reviewSessions("biology")[0].lesson)).toEqual(completed);
    expect(store.reviewItems("rust")[0].retiredAt).toBeDefined();
  });
  it("reports malformed state and empty eligibility without writes", async () => {
    for (const classroom of ["biology", "rust"])
      fs.rmSync(path.join(fixture.root, classroom, "001-ownership", "quiz", "grades"), {
        recursive: true,
      });
    const empty = await post("daily-review", { id: randomUUID() });
    expect(empty.body.error).toContain("No questions are due");
    expect(dailyReviews()).toHaveLength(0);
    fixture.write(".daily-reviews.json", "{invalid");
    const result = await (await fetch(`${base}/api/daily-review`)).json();
    expect(result.error).toContain("Cannot read daily review state");
    expect(fs.readFileSync(path.join(fixture.root, ".daily-reviews.json"), "utf8")).toBe(
      "{invalid",
    );
    expect(fs.existsSync(lessonDir("rust", `review-${randomUUID()}`))).toBe(false);
  });
});
