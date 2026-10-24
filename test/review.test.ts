import { describe, expect, it } from "vitest";
import {
  DAY_MS,
  pickReviewItems,
  relativeDay,
  scheduleItems,
  reviewTiming,
  summarize,
  type ReviewEvent,
} from "../src/review.ts";
import type { PerformanceEvidence } from "../src/evidence.ts";

const T0 = Date.UTC(2026, 0, 1);
const evidence = (extra: Partial<PerformanceEvidence> = {}): PerformanceEvidence => ({
  objectiveId: "cost",
  objective: { statement: "Apply cost", application: false },
  task: "retrieval",
  support: "independent",
  assistance: "none",
  ...extra,
});
const event = (day: number, extra: Partial<ReviewEvent> = {}): ReviewEvent => ({
  key: "001-cost/check/q1",
  at: T0 + day * DAY_MS,
  correct: true,
  prompt: `Prompt at ${day}`,
  answer: "answer",
  feedback: "feedback",
  evidence: evidence(),
  ...extra,
});

describe("scheduleItems", () => {
  it("keeps historical evidence unknown and never invents independence", () => {
    const events = [0, 3, 7, 21].map((day) => event(day, { evidence: undefined }));
    const [item] = scheduleItems(events);
    expect(item).toMatchObject({
      box: 2,
      attempts: 4,
      progress: "context-unknown",
      delayedSuccesses: 0,
    });
    expect(item.dueAt).toBeGreaterThan(T0 + 21 * DAY_MS);
  });
  it("spaces correct legacy retrieval without inventing objective context", () => {
    const history = [event(0, { evidence: undefined }), event(2, { evidence: undefined })];
    const item = scheduleItems(history)[0];
    expect(item).toMatchObject({
      box: 1,
      context: "unknown",
      objective: undefined,
      progress: "context-unknown",
    });
    expect(item.dueAt).toBeGreaterThan(T0 + 3 * DAY_MS);
    const aggregated = scheduleItems([
      history[0],
      { ...history[1], attemptId: "same" },
      { ...history[1], attemptId: "same" },
    ])[0];
    expect(aggregated).toMatchObject({ attempts: 2, box: 1, dueAt: item.dueAt });
    const early = scheduleItems([
      history[0],
      { ...history[1], early: true, earlyDueAt: T0 + DAY_MS },
    ])[0];
    expect(early.dueAt).toBe(T0 + DAY_MS);
    const waiting = scheduleItems([
      { ...history[0], feedbackAt: T0 + 2 * DAY_MS },
      { ...history[1], at: T0 + 2.5 * DAY_MS },
    ])[0];
    expect(waiting).toMatchObject({ box: 0, dueAt: T0 + 3 * DAY_MS });
  });
  it("does not promote or postpone immediate independent corrections", () => {
    const [item] = scheduleItems([event(0), event(0.001, { source: "chat" }), event(0.002)]);
    expect(item).toMatchObject({ box: 0, progress: "immediate-success", delayedSuccesses: 0 });
    expect(item.dueAt).toBe(T0 + DAY_MS);
  });
  it("requires actual elapsed time since practice and first feedback", () => {
    const [item] = scheduleItems([event(0, { feedbackAt: T0 + 2 * DAY_MS }), event(2.5)]);
    expect(item.box).toBe(0);
    expect(item.dueAt).toBe(T0 + 3 * DAY_MS);
  });
  it("extends from actual elapsed time only on due independent success", () => {
    const first = scheduleItems([event(0)])[0];
    const next = scheduleItems([event(0), event(1)])[0];
    expect(next.stability).toBeGreaterThan(first.stability);
    expect(next.dueAt).toBeGreaterThan(T0 + 2 * DAY_MS);
    expect(next.scheduleReason).toContain("1.0 days");
    const overdue = scheduleItems([event(0), event(20)])[0];
    expect(overdue.stability).toBeGreaterThan(next.stability);
    expect(overdue.dueAt - overdue.lastFeedbackAt).toBeGreaterThan(
      next.dueAt - next.lastFeedbackAt,
    );
    expect(overdue.prompt).toBe("Prompt at 0");
  });
  it.each([-1, 0, 1])("honors the exact due boundary at offset %i ms", (offset) => {
    const history = [event(0), event(1)];
    const before = scheduleItems(history)[0];
    const after = scheduleItems([...history, event(5, { at: before.dueAt + offset })])[0];
    if (offset < 0) {
      expect(after.dueAt).toBe(before.dueAt);
      expect(after.stability).toBe(before.stability);
    } else {
      expect(after.dueAt).toBeGreaterThan(before.dueAt);
      expect(after.stability).toBeGreaterThan(before.stability);
    }
  });
  it("requires delayed transfer for an application objective", () => {
    const e = evidence({ objective: { statement: "Apply cost", application: true } });
    const events = [0, 1, 8].map((day) => event(day, { evidence: e }));
    expect(scheduleItems(events)[0].progress).toBe("transfer-needed");
    expect(
      scheduleItems([...events, event(9, { evidence: { ...e, task: "transfer" } })])[0].progress,
    ).toBe("retained-evidence");
  });
  it.each(["none", "hint", "solution", "unknown"] as const)(
    "progresses from correctness and timing with %s assistance without inventing independence",
    (assistance) => {
      const history = [0, 1, 8].map((day) => event(day, { evidence: evidence({ assistance }) }));
      const item = scheduleItems(history)[0];
      const unaided = scheduleItems([0, 1, 8].map((day) => event(day)))[0];
      expect(item).toMatchObject({
        dueAt: unaided.dueAt,
        stability: unaided.stability,
        difficulty: unaided.difficulty,
        delayedSuccesses: 2,
        progress: "retained-evidence",
        gapOpen: false,
      });
      expect(item.context).toBe(
        assistance === "unknown"
          ? "unknown"
          : assistance === "none"
            ? "delayed-retrieval"
            : "assisted",
      );
      expect(history.at(-1)!.evidence!.assistance).toBe(assistance);
    },
  );
  it("schedules authored supported work but does not relabel it as independent retention", () => {
    const item = scheduleItems([
      event(0),
      event(7, { evidence: evidence({ support: "assisted" }) }),
    ])[0];
    expect(item.box).toBe(1);
    expect(item.delayedSuccesses).toBe(0);
    expect(item.context).toBe("assisted");
  });
  it("resets retained evidence after incomplete retrieval and records partial credit", () => {
    const [item] = scheduleItems([
      event(0),
      event(1),
      event(8),
      event(30, { correct: false, credit: 0.5 }),
    ]);
    expect(item).toMatchObject({
      progress: "needs-practice",
      delayedSuccesses: 0,
      delayedTransfers: 0,
      box: 0,
      lastCredit: 0.5,
    });
    const before = scheduleItems([event(0), event(1), event(8)])[0];
    const miss = scheduleItems([
      event(0),
      event(1),
      event(8),
      event(30, { correct: false, credit: 0 }),
    ])[0];
    expect(item.stability).toBeLessThan(before.stability);
    expect(item.stability).toBeGreaterThan(miss.stability);
    expect(item.difficulty).toBeLessThan(miss.difficulty);
    expect(item.dueAt).toBeGreaterThan(miss.dueAt);
    expect(item.stability / before.stability).toBeGreaterThan(0.84);
  });
  it("caps the base interval for an explicit retention duration without a deadline", () => {
    const e = evidence({
      objective: { statement: "Recall", application: false, retentionDays: 8 },
    });
    const [item] = scheduleItems([event(0, { evidence: e }), event(1, { evidence: e })]);
    expect(item.dueAt).toBe(T0 + 3 * DAY_MS);
    expect(item.scheduleReason).toContain("retention-duration cap 8 days");
  });
  it("keeps schedule and credit invariant under confidence and replays deterministically", () => {
    const events = [event(0), event(1), event(8)];
    const ratings = events.map((e) => ({ ...e, confidence: "guess" }));
    expect(scheduleItems(ratings)).toEqual(scheduleItems(events));
    expect(scheduleItems([...events].reverse())).toEqual(scheduleItems(events));
  });
  it("does not backfill retention from old attempts when new context becomes available", () => {
    const [item] = scheduleItems([event(0, { evidence: undefined }), event(7), event(8)]);
    expect(item.delayedSuccesses).toBe(1);
    expect(item.progress).toBe("delayed-success");
  });
});

describe("pickReviewItems", () => {
  const grouped = (key: string, strategy: string, interleaveGroup = "regression") =>
    event(0, {
      key,
      evidence: evidence({
        objective: { statement: strategy, application: true, interleaveGroup, strategy },
      }),
    });
  it("mixes related strategies within one lesson and across lessons", () => {
    const items = scheduleItems([
      grouped("a/q/1", "cost"),
      grouped("a/q/2", "cost"),
      grouped("a/q/3", "residual"),
      grouped("b/q/1", "prediction"),
    ]);
    expect(pickReviewItems(items, T0 + DAY_MS, 10).map((i) => i.key)).toEqual([
      "a/q/1",
      "a/q/3",
      "b/q/1",
      "a/q/2",
    ]);
  });
  it("keeps unrelated subjects in due order rather than calling lesson alternation interleaving", () => {
    const items = scheduleItems([
      event(0, { key: "a/q/1", evidence: undefined }),
      event(0, { key: "a/q/2", evidence: undefined }),
      event(1, { key: "b/q/1", evidence: undefined }),
    ]);
    expect(pickReviewItems(items, T0 + 3 * DAY_MS, 10).map((i) => i.key)).toEqual([
      "a/q/1",
      "a/q/2",
      "b/q/1",
    ]);
    expect(pickReviewItems(items, T0, 10)).toEqual([]);
    expect(pickReviewItems(items, T0 + 3 * DAY_MS, 1)).toHaveLength(1);
  });
});
it("summarizes retained evidence, transfer needs, and unknown context", () => {
  const items = scheduleItems([
    event(0, { key: "a/q/1", evidence: undefined }),
    ...[0, 1, 8].map((day) => event(day)),
  ]);
  expect(summarize(items, T0 + 9 * DAY_MS)).toMatchObject({
    total: 2,
    due: 1,
    retained: 1,
    unknown: 1,
    transferNeeded: 0,
  });
});
it("describes days in words", () => {
  expect(relativeDay(T0, T0)).toBe("today");
  expect(relativeDay(T0 + DAY_MS, T0)).toBe("tomorrow");
  expect(relativeDay(T0 + 5 * DAY_MS, T0)).toBe("in 5 days");
  expect(relativeDay(T0 - 3 * DAY_MS, T0)).toBe("3 days ago");
});

it("counts simultaneous objective probes as one conservative exposure", () => {
  const key = "001-cost/@objective/cost";
  const probes = (day: number) =>
    ["q1", "q2", "q3"].map((q) => event(day, { key, questionKey: `001-cost/check/${q}` }));
  const initial = probes(0);
  const [item] = scheduleItems([...initial, ...probes(1), ...probes(8)]);
  expect(item).toMatchObject({
    attempts: 3,
    delayedSuccesses: 2,
    box: 2,
    progress: "retained-evidence",
  });
  const mixed = probes(20);
  mixed[1] = { ...mixed[1], correct: false, credit: 0.5 };
  const events = [...initial, ...probes(1), ...probes(8), ...mixed];
  expect(scheduleItems(events)[0]).toMatchObject({
    attempts: 4,
    box: 0,
    progress: "needs-practice",
    lastCredit: 0.5,
  });
  expect(scheduleItems(events)).toEqual(scheduleItems([...events].reverse()));
  mixed[1] = { ...mixed[1], correct: true, credit: 1, evidence: evidence({ assistance: "hint" }) };
  expect(scheduleItems([...initial, ...mixed])[0]).toMatchObject({
    box: 1,
    delayedSuccesses: 1,
  });
});

it("bounds memory and replays long histories without clock, randomness or input mutations", () => {
  const events: ReviewEvent[] = [];
  let at = T0;
  for (let i = 0; i < 250; i++) {
    events.push(event(0, { at }));
    const item = scheduleItems(events)[0];
    expect(item.stability).toBeGreaterThanOrEqual(0.25);
    expect(item.stability).toBeLessThanOrEqual(3650);
    expect(item.difficulty).toBeGreaterThanOrEqual(1);
    expect(item.difficulty).toBeLessThanOrEqual(10);
    expect(Number.isFinite(item.dueAt)).toBe(true);
    at = item.dueAt + 3 * DAY_MS;
  }
  const frozen = JSON.stringify(events);
  expect(scheduleItems(JSON.parse(frozen).reverse())).toEqual(scheduleItems(events));
  expect(JSON.stringify(events)).toBe(frozen);
  const baseline = scheduleItems(events);
  for (const confidence of [undefined, "guess", "unsure", "sure", 0, 1, 100])
    for (const rating of [undefined, "again", "hard", "good", "easy", 4])
      expect(scheduleItems(events.map((e) => ({ ...e, confidence, rating })))).toEqual(baseline);
});
it("rejects non-finite timestamps and out-of-range credit explicitly", () => {
  for (const extra of [{ at: NaN }, { feedbackAt: Infinity }, { credit: -0.1 }, { credit: 1.1 }])
    expect(() => scheduleItems([event(0, extra)])).toThrow("Invalid review event");
});
it("keeps explicit early answers from growing memory regardless of help context", () => {
  const base = [event(0), event(1)];
  const before = scheduleItems(base)[0];
  for (const evidenceValue of [
    undefined,
    evidence(),
    evidence({ assistance: "unknown" }),
    evidence({ assistance: "hint" }),
    evidence({ support: "assisted" }),
  ]) {
    const after = scheduleItems([...base, event(40, { early: true, evidence: evidenceValue })])[0];
    expect(after.stability).toBe(before.stability);
    expect(after.difficulty).toBe(before.difficulty);
    expect(after.dueAt).toBe(before.dueAt);
  }
});
it("separates selected exposure delay from a current corrective reply", () => {
  const [item] = scheduleItems([
    event(0),
    event(11, { correct: false, credit: 0, feedbackAt: T0 + 11 * DAY_MS + 1000 }),
  ]);
  expect(item.elapsedDays).toBe(11);
  const [timing] = reviewTiming([item], item.lastFeedbackAt + 15000);
  expect(timing).toMatchObject({
    phase: "panel-corrective-reply",
    elapsedMs: 15000,
    delay: "immediate",
  });
  const corrected = scheduleItems([
    event(0),
    event(11, { correct: false }),
    event(11 + 15 / 86400, { source: "chat" }),
  ])[0];
  expect(corrected).toMatchObject({
    progress: "immediate-success",
    delayedSuccesses: 0,
    delayedTransfers: 0,
    evidenceSpanDays: 0,
  });
});
it("resolves a paused objective on full credit without a help report", () => {
  const history = [0, 1, 2].map((day) => event(day, { correct: false, credit: 0 }));
  expect(
    scheduleItems([...history, event(5, { evidence: evidence({ assistance: "hint" }) })])[0]
      .needsReteach,
  ).toBe(false);
  expect(scheduleItems([...history, event(5, { evidence: undefined })])[0].needsReteach).toBe(
    false,
  );
});

it("never uses confidence or self-ratings to break simultaneous probe ties", () => {
  const a = event(1, {
    questionKey: "001-cost/check/q1",
    evidence: evidence({ assistance: "unknown" }),
  });
  const b = event(1, {
    questionKey: "001-cost/check/q1",
    evidence: evidence({ assistance: "hint" }),
  });
  const expected = scheduleItems([event(0), a, b]);
  for (const confidence of ["guess", "sure", 0, 100])
    for (const selfRating of ["again", "easy", 1, 4]) {
      const mixed = [
        event(0),
        { ...a, confidence, selfRating },
        { ...b, confidence: selfRating, selfRating: confidence },
      ];
      expect(scheduleItems(mixed)).toEqual(expected);
      expect(scheduleItems([...mixed].reverse())).toEqual(expected);
    }
});
it("keeps distinct immutable attempts separate even with equal timestamps", () => {
  const a = event(1, { attemptId: "a", questionKey: "001-cost/check/q1" });
  const b = event(1, {
    attemptId: "b",
    questionKey: "001-cost/check/q1",
    correct: false,
    credit: 0.5,
  });
  const c = { ...a, questionKey: "001-cost/check/q2", credit: 0.5, correct: false };
  const item = scheduleItems([b, a, c])[0];
  expect(item.attempts).toBe(2);
  expect(item.lastCredit).toBe(0.5);
  expect(scheduleItems([c, a, b])).toEqual(scheduleItems([b, a, c]));
});
