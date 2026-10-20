import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DAY_MS, scheduleItems, summarize, pickReviewItems, reviewTopic } from "../src/review.ts";
import {
  workload,
  pickDailyItems,
  classroomWorkload,
  reviewDay,
  rootWorkload,
  pickAcrossClassrooms,
} from "../src/review-workload.ts";
import type { ReviewReservation } from "../src/review-workload.ts";
import {
  startReview,
  reviewSessions,
  completePreparedReview,
  resumableReview,
  savePlannedReview,
  plannedReviewEligible,
} from "../src/review-session.ts";
import { dailyReviews, startDailyReview } from "../src/store/daily-review.ts";
import * as store from "../src/store.ts";
import {
  makeFixture,
  seedClassroom,
  seedPreparedReviewSource,
  closeReviewVariants,
  termAnswer,
  writeGradedAttempt,
} from "./helpers.ts";
import type { Fixture } from "./helpers.ts";
const NOW = Date.UTC(2026, 9, 19, 12);
const items = () =>
  scheduleItems(
    Array.from({ length: 30 }, (_, i) => ({
      key: `001-a/check/q${String(i).padStart(2, "0")}`,
      at: NOW - 20 * DAY_MS,
      correct: true,
      prompt: "Recall",
      answer: "Answer",
      feedback: "Feedback",
    })),
  );
it("keeps due counts and dates intact through absent days without accumulating allowance", () => {
  const all = items();
  const saved = JSON.stringify(all);
  for (const day of [0, 1, 10, 365]) {
    const now = NOW + day * DAY_MS;
    const state = workload(all, [], now);
    expect(state).toMatchObject({ cap: 12, allowance: 5, remaining: 5, eligible: 5, deferred: 25 });
    expect(summarize(all, now).due).toBe(30);
    expect(pickDailyItems(all, now, 12, state)).toHaveLength(5);
  }
  expect(JSON.stringify(all)).toBe(saved);
});
it("ramps from actual prior-day card completions, with exact UTC boundaries and no regrade credit", () => {
  const all = items();
  const day = reviewDay(NOW);
  const reservation: ReviewReservation = {
    id: "first",
    at: day - DAY_MS,
    keys: all.slice(0, 12).map((i) => i.key),
    active: false,
    completions: all.slice(0, 12).map((i) => ({ key: i.key, at: day - 1 })),
  };
  expect(workload(all, [reservation], NOW).allowance).toBe(12);
  reservation.completions = reservation.completions.slice(0, 3);
  expect(workload(all, [reservation, reservation], NOW).allowance).toBe(8);
  expect(workload(all, [reservation], day - DAY_MS - 1).allowance).toBe(5);
  expect(workload(all, [reservation], day + DAY_MS).allowance).toBe(5);
  reservation.completions = [{ key: "x", at: day }];
  expect(workload(all, [reservation], NOW).allowance).toBe(5);
  expect(workload(all, [reservation], day + DAY_MS).allowance).toBe(6);
});
it("reserves failed and unfinished cards across midnight and excludes them even for early reviews", () => {
  const all = items();
  all[0].retiredAt = 1;
  all[1].needsReteach = true;
  const r: ReviewReservation = {
    id: "old",
    at: NOW - 3 * DAY_MS,
    keys: [all[2].key, all[3].key],
    active: true,
    completions: [],
  };
  const state = workload(all, [r], NOW);
  expect(state).toMatchObject({ used: 2, remaining: 3, eligible: 3, deferred: 23 });
  const picked = pickDailyItems(all, NOW, 12, state, true);
  expect(picked).toHaveLength(3);
  expect(picked.some((i) => all.slice(0, 4).some((a) => a.key === i.key))).toBe(false);
});
it("moves recently checked but still-overdue unknown items behind untouched backlog", () => {
  const all = items();
  const selected = pickReviewItems(all, NOW, 5);
  const updated = all.map((i) =>
    selected.includes(i) ? { ...i, lastAt: NOW, lastFeedbackAt: NOW } : i,
  );
  const next = pickReviewItems(updated, NOW + DAY_MS, 5);
  expect(next.some((i) => selected.some((s) => s.key === i.key))).toBe(false);
  expect(pickReviewItems([...updated].reverse(), NOW + DAY_MS, 5)).toEqual(next);
});
let fixture: Fixture;
beforeEach(() => {
  fixture = makeFixture();
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});
afterEach(() => {
  vi.restoreAllMocks();
  fixture.cleanup();
});
function seed(classroom = "rust") {
  seedClassroom(fixture, { classroom });
  const ids = Array.from({ length: 20 }, (_, i) => `q${i + 1}`);
  seedPreparedReviewSource(fixture.root, classroom, "001-ownership", "check-1", ids);
  closeReviewVariants(fixture.root, classroom);
  writeGradedAttempt({
    classroom,
    at: NOW - 20 * DAY_MS,
    answers: ids.map((id) => termAnswer(id, "owner")),
    correct: Object.fromEntries(ids.map((id) => [id, true])),
  });
}
it("shares durable reservations across classroom starts, daily plans, topics, reload and clock changes", () => {
  seed();
  seed("biology");
  const first = startReview("rust", randomUUID(), "pi", 3).session;
  completePreparedReview(first);
  expect(startReview("rust", randomUUID(), "pi", 12).session.id).toBe(first.id);
  expect(classroomWorkload("rust", store.reviewItems("rust"), NOW)).toMatchObject({
    used: 3,
    remaining: 2,
  });
  // Complete actual published cards once; no mutation of original assessment history.
  first.items.forEach((item, i) =>
    writeGradedAttempt({
      lesson: first.lesson,
      quizId: i === 0 ? "review" : `review-${i + 1}`,
      kind: "review",
      at: NOW + i,
      answers: [termAnswer(`r${i + 1}`, "owner", { reviewOf: item.key })],
      correct: { [`r${i + 1}`]: true },
    }),
  );
  expect(resumableReview(reviewSessions("rust")[0])).toBe(false);
  const next = startReview("rust", randomUUID(), "pi", 12, { early: true }).session;
  expect(next.items).toHaveLength(2);
  expect(next.items.some((i) => first.items.some((a) => a.key === i.key))).toBe(false);
  const daily = startDailyReview(randomUUID(), "pi");
  expect(daily.groups.find((g) => g.classroom === "rust")!.plan.id).toBe(next.id);
  expect(daily.groups.some((g) => g.classroom === "biology")).toBe(false);
  expect(() => startReview("biology", randomUUID(), "pi")).toThrow("allowance is reserved");
  const snapshot = JSON.stringify(dailyReviews());
  Date.now = () => NOW + DAY_MS;
  expect(startDailyReview(randomUUID(), "pi").id).toBe(daily.id);
  expect(JSON.stringify(dailyReviews())).toBe(snapshot);
  expect(reviewSessions("rust")).toHaveLength(2);
  expect(classroomWorkload("rust", store.reviewItems("rust"), NOW + DAY_MS)).toMatchObject({
    allowance: 8,
    used: 2,
    remaining: 6,
  });
  const rootLock = path.join(fixture.root, ".daily-reviews.lock");
  fs.writeFileSync(rootLock, "concurrent host");
  expect(() => startReview("biology", randomUUID(), "pi")).toThrow("locked daily review edits");
  expect(() => startDailyReview(randomUUID(), "pi")).toThrow("locked daily review edits");
  fs.unlinkSync(rootLock);
});

// Nine classrooms publish and grade four days on disk; allow for filesystem work, not a latency claim.
it("bounds a many-classroom daily batch and rotates classrooms/topics over successive days", () => {
  for (let c = 0; c < 9; c++) seed(`class-${c}`);
  const served = new Set<string>();
  const batches: Array<{ day: number; classes: string[]; count: number }> = [];
  for (let day = 0; day < 4; day++) {
    vi.mocked(Date.now).mockReturnValue(NOW + day * DAY_MS);
    const batch = startDailyReview(randomUUID(), "pi");
    const count = batch.groups.reduce((n, g) => n + g.plan.items.length, 0);
    expect(count).toBeLessThanOrEqual(rootWorkload(Date.now()).allowance);
    expect(count).toBeLessThanOrEqual(12);
    expect(startDailyReview(randomUUID(), "pi").id).toBe(batch.id);
    for (const group of batch.groups) {
      served.add(group.classroom);
      const saved = savePlannedReview(group.plan);
      completePreparedReview(saved);
      group.plan.items.forEach((item, i) =>
        writeGradedAttempt({
          classroom: group.classroom,
          lesson: group.plan.lesson,
          quizId: i === 0 ? "review" : `review-${i + 1}`,
          kind: "review",
          at: Date.now() + i,
          answers: [termAnswer(`r${i + 1}`, "owner", { reviewOf: item.key })],
          correct: { [`r${i + 1}`]: true },
        }),
      );
    }
    batches.push({ day, classes: batch.groups.map((g) => g.classroom), count });
    expect(rootWorkload(Date.now()).remaining).toBe(0);
    expect(() => startReview("class-8", randomUUID(), "pi", 12, { early: true })).toThrow(
      "allowance is reserved",
    );
  }
  expect(served.size).toBe(9);
  expect(batches[0].count).toBe(5);
  expect(batches[1].count).toBe(10);
  expect(batches[1].classes).toEqual(
    expect.arrayContaining(["class-5", "class-6", "class-7", "class-8"]),
  );
  expect(batches[2].count).toBe(12);
  // Separate topic queues remain fair even within a single classroom.
  const all = items().map((item, i) => ({ ...item, lesson: `lesson-${i % 3}` }));
  const candidates = [{ classroom: "topics", items: all }];
  const state = workload(all, [], NOW);
  const chosen = pickAcrossClassrooms(candidates, NOW, state, []).get("topics")!;
  expect(new Set(chosen.slice(0, 3).map((i) => reviewTopic(i).id)).size).toBe(3);
  const history = [
    {
      id: "previous",
      classroom: "topics",
      at: NOW - DAY_MS,
      keys: [],
      active: false,
      completions: [],
      topics: [reviewTopic(all[0]).id],
    },
  ];
  const next = pickAcrossClassrooms(candidates, NOW, state, history).get("topics")!;
  expect(reviewTopic(next[0]).id).not.toBe(reviewTopic(all[0]).id);
  expect(
    pickAcrossClassrooms([...candidates].reverse(), NOW, state, [...history].reverse()),
  ).toEqual(new Map([["topics", next]]));
}, 20_000);

it("gives never-selected classrooms priority with more classrooms than a daily allowance", () => {
  const candidates = Array.from({ length: 9 }, (_, i) => ({ classroom: `c${i}`, items: items() }));
  const state = workload([], [], NOW);
  const first = pickAcrossClassrooms(candidates, NOW, state, []);
  expect([...first.keys()]).toEqual(["c0", "c1", "c2", "c3", "c4"]);
  const history: ReviewReservation[] = [...first].map(([classroom, picks]) => ({
    id: classroom,
    classroom,
    at: NOW - DAY_MS,
    keys: picks.map((i) => i.key),
    active: false,
    completions: [],
    topics: picks.map((i) => reviewTopic(i).id),
  }));
  const next = pickAcrossClassrooms([...candidates].reverse(), NOW, state, history);
  expect([...next.keys()]).toEqual(["c5", "c6", "c7", "c8", "c0"]);
  expect([...first.values(), ...next.values()].flat().every((i) => Number.isFinite(i.dueAt))).toBe(
    true,
  );
});

it("serializes independent host processes against one root budget and reports lock contention", async () => {
  seed();
  seed("biology");
  const execute = promisify(execFile);
  const source = new URL("../src/review-session.ts", import.meta.url).href;
  const attempt = async (classroom: string) => {
    const code = `import {startReview} from ${JSON.stringify(source)};Date.now=()=>${NOW};try{const r=startReview(${JSON.stringify(classroom)},${JSON.stringify(randomUUID())},"pi",3);console.log(JSON.stringify({id:r.session.id,classroom:${JSON.stringify(classroom)},keys:r.session.items.map(i=>i.key)}));}catch(error){console.log(JSON.stringify({error:error.message}));}`;
    return JSON.parse(
      (
        await execute(process.execPath, ["--input-type=module", "-e", code], {
          cwd: process.cwd(),
          env: { ...process.env, PI_CLASSROOMS_DIR: fixture.root },
        })
      ).stdout,
    );
  };
  const results = await Promise.all([attempt("rust"), attempt("biology")]);
  expect(results.filter((r) => r.keys).length).toBeGreaterThan(0);
  for (const result of results)
    if (result.error) expect(result.error).toContain("locked daily review edits");
  const used = rootWorkload(NOW).used;
  expect(used).toBeLessThanOrEqual(5);
  expect(used).toBe(results.filter((r) => r.keys).reduce((n, r) => n + r.keys.length, 0));
  expect(rootWorkload(NOW).remaining).toBe(5 - used);
});

it("does not count legacy retakes as a card's first completion on a new day", () => {
  const day = reviewDay(NOW);
  const r: ReviewReservation = {
    id: "legacy",
    at: day - 3 * DAY_MS,
    keys: ["a"],
    active: false,
    completions: [
      { key: "a", at: day - 2 * DAY_MS },
      { key: "a", at: day - 1 },
    ],
  };
  expect(workload([], [r], NOW).allowance).toBe(5);
  r.completions.push({ key: "b", at: day - 1 });
  expect(workload([], [r], NOW).allowance).toBe(6);
});

it("reserves canonical aliases while charging every original saved card", () => {
  const day = reviewDay(NOW);
  const reserved: ReviewReservation = {
    id: "legacy",
    at: day,
    active: true,
    keys: ["objective"],
    cards: ["q1", "q2", "q3"],
    completions: [],
  };
  expect(workload([], [reserved], NOW)).toMatchObject({ used: 3, remaining: 2 });
});

it("keeps an older saved question alias eligible without selecting its objective twice", () => {
  seedClassroom(fixture);
  seedPreparedReviewSource(fixture.root);
  const learning = {
    objectiveId: "owner",
    objective: { statement: "Explain ownership.", application: false },
    task: "retrieval" as const,
    support: "independent" as const,
    assistance: "none" as const,
  };
  writeGradedAttempt({
    at: NOW - 20 * DAY_MS,
    answers: [termAnswer("q1", "owner", { learning })],
    correct: { q1: true },
  });
  const first = startReview("rust", randomUUID(), "pi", 3).session;
  const canonical = first.items[0].key,
    alias = "001-ownership/check-1/q1";
  const file = path.join(fixture.root, "rust/.reviews.json");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replaceAll(canonical, alias));
  const old = reviewSessions("rust")[0];
  const bytes = fs.readFileSync(file, "utf8");
  expect(plannedReviewEligible(old)).toBe(true);
  const state = classroomWorkload("rust", store.reviewItems("rust"), NOW);
  expect(state.reservedKeys).toContain(canonical);
  expect(pickDailyItems(store.reviewItems("rust"), NOW, 12, state, true)).toEqual([]);
  expect(fs.readFileSync(file, "utf8")).toBe(bytes);
});
