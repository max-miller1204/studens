import * as fs from "node:fs";
import * as path from "node:path";
import { startReview, completePreparedReview } from "../src/review-session.ts";
import { afterEach, expect, it, vi } from "vitest";
import { ClassroomBridge } from "../src/bridge.ts";
import { registerClassroomTools } from "../src/tools.ts";
import { DAY_MS } from "../src/review.ts";
import * as store from "../src/store.ts";
import {
  makeFixture,
  seedClassroom,
  seedPreparedReviewSource,
  termAnswer,
  writeGradedAttempt,
} from "./helpers.ts";

afterEach(() => vi.restoreAllMocks());
it("uses the actual saved panel reply, not days spent waiting for its teacher, as retrieval time", async () => {
  const fixture = makeFixture();
  const bridge = new ClassroomBridge({ sendUserMessage() {} });
  try {
    seedClassroom(fixture);
    seedPreparedReviewSource(fixture.root);
    const t = Date.UTC(2026, 0, 1);
    const learning = {
      objectiveId: "ownership",
      objective: { statement: "Explain ownership", application: false },
      task: "retrieval" as const,
      support: "independent" as const,
      assistance: "none" as const,
    };
    writeGradedAttempt({
      at: t,
      answers: [termAnswer("q1", "owner", { learning })],
      correct: { q1: true },
    });
    writeGradedAttempt({
      at: t + 11 * DAY_MS,
      answers: [termAnswer("q1", "old", { learning })],
      correct: { q1: false },
    });
    const before = store.reviewItems("rust")[0];
    fixture.write(
      "rust/learning-records/0001-check.md",
      "# Ownership\nImmediate correction of the current owner.",
    );
    const replyAt = t + 11 * DAY_MS + 15000;
    vi.spyOn(Date, "now").mockReturnValue(replyAt);
    const answer = "The current owner releases it at scope end. I used no help.";
    bridge.chat("rust", "001-ownership", answer, crypto.randomUUID());
    const definitions = new Map<
      string,
      { execute: (id: string, args: unknown) => Promise<unknown> }
    >();
    registerClassroomTools(
      { registerTool: (tool: any) => definitions.set(tool.name, tool) },
      [],
      (name) => bridge.assertCanWrite(name),
    );
    vi.mocked(Date.now).mockReturnValue(replyAt + 3 * DAY_MS);
    await definitions.get("record_retrieval_check")!.execute("check", {
      classroom: "rust",
      review_key: before.key,
      learning_record: "0001-check.md",
      answer,
      evidence: "Correct explanation of the current owner.",
      assistance: "none",
      task: "retrieval",
    });
    const check = store.listRetrievalChecks("rust")[0];
    expect(check).toMatchObject({ answeredAt: replyAt, at: replyAt + 3 * DAY_MS });
    const after = store.reviewItems("rust")[0];
    expect(after.context).toBe("immediate-independent");
    expect(after.stability).toBe(before.stability);
    expect(after.dueAt).toBe(before.dueAt);
    expect(after).toMatchObject({
      progress: "immediate-success",
      delayedSuccesses: 0,
      delayedTransfers: 0,
      evidenceSpanDays: 0,
    });
    expect(after.lastFeedbackAt).toBe(check.at);
    expect(store.reviewEvents("rust").find((e) => e.source === "chat")!.at).toBe(replyAt);
    expect(store.listGrades("rust", "001-ownership")).toHaveLength(2);
    // The host context cannot be rebound to another answer or lesson.
    const failed: any = await definitions.get("record_retrieval_check")!.execute("other", {
      classroom: "rust",
      review_key: before.key,
      learning_record: "0001-check.md",
      answer: "Invented reply",
      evidence: "No",
      assistance: "none",
    });
    expect(failed.details.error).toBe(true);
    expect(store.listRetrievalChecks("rust")).toHaveLength(1);
  } finally {
    bridge.reset();
    fixture.cleanup();
  }
});

it("preserves the original due cap of an early selection saved under an older scheduler", () => {
  const fixture = makeFixture();
  try {
    seedClassroom(fixture);
    seedPreparedReviewSource(fixture.root);
    const t = Date.UTC(2026, 0, 1);
    const learning = {
      objectiveId: "ownership",
      objective: { statement: "Explain ownership.", application: false },
      task: "retrieval" as const,
      support: "independent" as const,
      assistance: "none" as const,
    };
    for (const day of [0, 1])
      writeGradedAttempt({
        at: t + day * DAY_MS + (day ? 10 : 0),
        answers: [termAnswer("q1", "owner", { learning })],
        correct: { q1: true },
      });
    vi.spyOn(Date, "now").mockReturnValue(t + 2 * DAY_MS);
    const session = startReview("rust", crypto.randomUUID(), "pi", 3, { early: true }).session;
    completePreparedReview(session);
    const file = path.join(fixture.root, "rust/.reviews.json");
    const old = JSON.parse(fs.readFileSync(file, "utf8"));
    const originalDue = t + 4 * DAY_MS + 11;
    expect(store.reviewItems("rust")[0].dueAt).toBeGreaterThan(originalDue);
    old.requests[0].items[0].dueAt = originalDue;
    fs.writeFileSync(file, JSON.stringify(old));
    const snapshot = fs.readFileSync(file, "utf8");
    const grades = JSON.stringify(store.listGrades("rust", "001-ownership"));
    writeGradedAttempt({
      lesson: session.lesson,
      quizId: "review",
      kind: "review",
      at: t + 6 * DAY_MS,
      answers: [termAnswer("r1", "owner", { reviewOf: session.items[0].key, learning })],
      correct: { r1: true },
    });
    expect(store.reviewItems("rust")[0].dueAt).toBe(originalDue);
    expect(store.reviewEvents("rust").at(-1)).toMatchObject({
      early: true,
      earlyDueAt: originalDue,
    });
    expect(fs.readFileSync(file, "utf8")).toBe(snapshot);
    expect(JSON.stringify(store.listGrades("rust", "001-ownership"))).toBe(grades);
  } finally {
    fixture.cleanup();
  }
});

it("resolves historical gaps from correct linked checks while keeping assistance history", () => {
  const fixture = makeFixture();
  try {
    seedClassroom(fixture);
    seedPreparedReviewSource(fixture.root);
    const t = Date.UTC(2026, 0, 1);
    for (const day of [0, 1, 2])
      writeGradedAttempt({
        at: t + day * DAY_MS,
        answers: [termAnswer("q1", "old")],
        correct: { q1: false },
      });
    const item = store.reviewItems("rust")[0];
    expect(item.needsReteach).toBe(true);
    fixture.write(
      "rust/learning-records/0001-assisted.md",
      "# Ownership\nAn assisted correction after re-teaching.",
    );
    const check = store.recordRetrievalCheck("rust", {
      key: item.key,
      learningRecord: "0001-assisted.md",
      answer: "The new owner. I used the example.",
      evidence: "Assisted correct answer.",
      assistance: "solution",
    });
    const assisted = store.reviewItems("rust")[0];
    expect(assisted).toMatchObject({
      lastCorrect: true,
      needsReteach: false,
      gapOpen: false,
      context: "unknown",
      delayedSuccesses: 0,
    });
    expect(assisted.dueAt).toBeGreaterThanOrEqual(item.dueAt);
    expect(check.assistance).toBe("solution");
    expect(check.learning).toBeUndefined();
    fixture.write(
      "rust/learning-records/0002-independent.md",
      "# Ownership\nA fresh independent correction, with unknown objective history.",
    );
    store.recordRetrievalCheck("rust", {
      key: item.key,
      learningRecord: "0002-independent.md",
      answer: "Current owner, without help.",
      evidence: "Fresh independent check.",
      assistance: "none",
    });
    expect(store.reviewItems("rust")[0]).toMatchObject({
      needsReteach: false,
      context: "unknown",
      delayedSuccesses: 0,
    });
    expect(store.listGrades("rust", "001-ownership")).toHaveLength(3);
  } finally {
    fixture.cleanup();
  }
});
