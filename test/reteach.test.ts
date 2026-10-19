import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ClassroomBridge } from "../src/bridge.ts";
import {
  DAY_MS,
  isDue,
  pickReviewItems,
  scheduleItems,
  summarize,
  type ReviewEvent,
} from "../src/review.ts";
import { prepareReteach, reteachOffers } from "../src/reteach.ts";
import { startReview } from "../src/review-session.ts";
import { piResumes } from "../src/teacher-resume.ts";
import { TeacherService } from "../src/teacher-service.ts";
import { readTeacherState, saveTeacherState } from "../src/service-state.ts";
import { healthReport } from "../src/health.ts";
import * as server from "../src/server.ts";
import * as store from "../src/store.ts";
import {
  makeFixture,
  seedClassroom,
  seedPreparedReviewSource,
  termAnswer,
  writeGradedAttempt,
  type Fixture,
} from "./helpers.ts";

let fixture: Fixture;
beforeEach(() => {
  fixture = makeFixture();
  seedClassroom(fixture);
});
afterEach(async () => {
  await server.close();
  fixture.cleanup();
});
function seed() {
  seedPreparedReviewSource(fixture.root);
  return [0, 1, 2].map((i) =>
    writeGradedAttempt({
      at: Date.now() - (6 - i) * DAY_MS,
      answers: [termAnswer("q1", "forever")],
      correct: { q1: false },
    }),
  );
}
const plan = () => ({
  calls: [],
  message:
    "One owner controls cleanup. For example, a moved String is dropped by its new owner. Who owns it after a move?",
  learning_record: "",
  notes_markdown: "",
});

describe("re-teaching replay", () => {
  it("counts cumulative incomplete exposures once per objective attempt and excludes only the paused item", () => {
    const event = (at: number, extra: Partial<ReviewEvent> = {}): ReviewEvent => ({
      key: "001-ownership/@objective/owner",
      at,
      correct: false,
      prompt: "Who?",
      answer: "Old owner",
      feedback: "New owner",
      ...extra,
    });
    const events = [
      event(1),
      event(1, { questionKey: "001-ownership/check/q2" }),
      event(2),
      event(3, { correct: true }),
      event(4, { correct: true, credit: 0.5 }),
      event(5, { key: "001-ownership/check/other" }),
    ];
    const items = scheduleItems(events);
    const paused = items.find((i) => i.key.includes("@objective"))!;
    expect(paused).toMatchObject({ attempts: 4, misses: 3, needsReteach: true, box: 0 });
    expect(isDue(paused, 10 * DAY_MS)).toBe(false);
    expect(pickReviewItems(items, 10 * DAY_MS, 5).map((i) => i.questionId)).toEqual(["other"]);
    expect(summarize(items, 10 * DAY_MS)).toMatchObject({
      total: 2,
      due: 1,
      nextDueAt: null,
      dueSoon: 0,
    });
    const [resolved] = scheduleItems([
      ...events.filter((e) => e.key === paused.key),
      event(6, { correct: true }),
    ]);
    expect(resolved).toMatchObject({ misses: 3, needsReteach: false, box: 0, delayedSuccesses: 0 });
  });
  it("replays latest revisions without new exposures, keeps historical context and excludes pretests", () => {
    const submissions = seed();
    writeGradedAttempt({
      at: Date.now() - DAY_MS,
      kind: "pretest",
      answers: [termAnswer("q1", "no")],
      correct: { q1: false },
    });
    const before = store.reviewItems("rust")[0];
    expect(before).toMatchObject({
      misses: 3,
      attempts: 3,
      needsReteach: true,
      context: "unknown",
    });
    expect(() => startReview("rust", randomUUID(), "pi")).toThrow("paused from review");
    const original = store
      .listGrades("rust", "001-ownership")
      .find((g) => g.submissionId === submissions[0].id)!;
    store.writeGrade({
      ...original,
      questions: [{ questionId: "q1", correct: true, feedback: "Revised" }],
      gradedAt: Date.now(),
    });
    expect(store.reviewItems("rust")[0]).toMatchObject({
      misses: 2,
      attempts: 3,
      needsReteach: false,
      context: "unknown",
    });
    expect(store.listGrades("rust", "001-ownership")).toHaveLength(5);
  });
  it("flags three misses in lesson health without removing the earlier warning", () => {
    seed();
    const report = healthReport(
      "rust",
      [
        {
          lesson: "001-ownership",
          title: "Ownership",
          annotations: [],
          submissions: store.listSubmissions("rust", "001-ownership"),
          grades: store.latestGrades("rust", "001-ownership"),
          reflections: [],
          avoided: [],
        },
      ],
      [],
    );
    expect(report).toContain("Re-teach needed");
    expect(report).toContain("missed 3 of 3");
  });
});

describe("durable re-teach requests", () => {
  it("keeps Pi failed work durable until explicit retry and rejects writes during the request", () => {
    seed();
    const request = prepareReteach("rust", "001-ownership", store.reviewItems("rust")[0].key);
    const grades = store.listGrades("rust", "001-ownership");
    let runs = 0;
    const bridge = new ClassroomBridge({
      sendUserMessage() {
        runs++;
      },
    });
    bridge.chat("rust", "001-ownership", request.text, request.id);
    expect(() => bridge.assertCanWrite("record_retrieval_check")).toThrow("only a panel message");
    bridge.reset();
    const recovered = new ClassroomBridge({
      sendUserMessage() {
        runs++;
      },
    });
    recovered.chat("rust", "001-ownership", request.text, request.id);
    expect(runs).toBe(1);
    expect(piResumes("rust")[0].status).toBe("failed");
    recovered.retry("rust", `chat:${request.id}`);
    recovered.onAgentEnd([
      { role: "assistant", content: [{ type: "text", text: plan().message }] },
    ]);
    recovered.chat("rust", "001-ownership", request.text, request.id);
    expect(runs).toBe(2);
    expect(piResumes("rust")[0].status).toBe("done");
    expect(store.listPanelMessages("rust", "001-ownership").map((m) => m.role)).toEqual([
      "learner",
      "teacher",
    ]);
    expect(store.listGrades("rust", "001-ownership")).toEqual(grades);
    expect(store.reviewItems("rust")[0].needsReteach).toBe(true);
    recovered.reset();
  });
  it("rejects service evidence before writes, reloads failure, retries once and never resets assessment", async () => {
    seed();
    const item = store.reviewItems("rust")[0];
    const request = prepareReteach("rust", item.lesson, item.key);
    const grades = store.listGrades("rust", item.lesson);
    const first = new TeacherService(async () => ({
      ...plan(),
      learning_record: "Invented retention",
    }));
    first.attach("rust", "codex");
    first.chat("rust", item.lesson, request.text, request.id);
    await first.idle();
    await first.stop();
    expect(readTeacherState("rust")!.requests[0].status).toBe("failed");
    let runs = 0;
    const recovered = new TeacherService(async () => {
      runs++;
      return plan();
    });
    recovered.attach("rust");
    recovered.chat("rust", item.lesson, request.text, request.id);
    await recovered.idle();
    expect(runs).toBe(0);
    recovered.retry("rust", `chat:${request.id}`);
    await recovered.idle();
    recovered.chat("rust", item.lesson, request.text, request.id);
    await recovered.idle();
    expect(runs).toBe(1);
    expect(
      readTeacherState("rust")!.requests.filter((r) => r.id === `chat:${request.id}`),
    ).toHaveLength(1);
    expect(store.listGrades("rust", item.lesson)).toEqual(grades);
    expect(store.listLearningRecords("rust")).toEqual([]);
    expect(store.listRetrievalChecks("rust")).toEqual([]);
    expect(reteachOffers("rust", item.lesson)).toHaveLength(1);
    await recovered.stop();
  });
  it("recovers a saved re-teach message with no request only after an explicit resend", async () => {
    seed();
    const item = store.reviewItems("rust")[0];
    const request = prepareReteach("rust", item.lesson, item.key);
    store.addPanelMessage("rust", {
      id: `chat:${request.id}`,
      lesson: item.lesson,
      role: "learner",
      text: request.text,
    });
    let runs = 0;
    const bridge = new ClassroomBridge({
      sendUserMessage() {
        runs++;
      },
    });
    bridge.restoreResumes();
    expect(runs).toBe(0);
    bridge.chat("rust", item.lesson, request.text, request.id);
    bridge.onAgentEnd([{ role: "assistant", content: [{ type: "text", text: plan().message }] }]);
    expect(runs).toBe(1);
    expect(store.listPanelMessages("rust", item.lesson)).toHaveLength(2);
    bridge.reset();
    const initial = new TeacherService(async () => plan());
    initial.attach("rust", "codex");
    const saved = readTeacherState("rust")!;
    saved.messages.push({
      id: `chat:${request.id}`,
      lesson: item.lesson,
      role: "learner",
      text: request.text,
      at: Date.now(),
    });
    saveTeacherState("rust", saved);
    await initial.stop();
    let turns = 0;
    const recovered = new TeacherService(async (_identity, prompt) => {
      if (!prompt.includes("Background private review refill")) turns++;
      return plan();
    });
    recovered.attach("rust");
    await recovered.idle();
    expect(turns).toBe(0);
    recovered.chat("rust", item.lesson, request.text, request.id);
    await recovered.idle();
    expect(turns).toBe(1);
    expect(
      readTeacherState("rust")!.messages.filter(
        (m) => m.id === `chat:${request.id}` && m.role === "learner",
      ),
    ).toHaveLength(1);
    await recovered.stop();
  });

  it("validates item ownership, reports unavailable teacher, and keeps saved work private", async () => {
    seed();
    const item = store.reviewItems("rust")[0];
    const base = await server.start(0);
    server.setHooks({ onAsk() {}, onFollowUp() {}, onQuizSubmit() {}, onReflect() {} });
    const post = async (key: string, lesson = item.lesson) =>
      fetch(`${base}/api/teacher/reteach`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ classroom: "rust", lesson, key }),
      });
    expect((await post(item.key)).status).toBe(409);
    let calls = 0;
    server.setHooks({
      onAsk() {},
      onFollowUp() {},
      onQuizSubmit() {},
      onReflect() {},
      onTeacherChat() {
        calls++;
      },
    });
    expect((await post("001-ownership/check/unrelated")).status).toBe(409);
    expect(calls).toBe(0);
    expect((await post(item.key)).status).toBe(201);
    expect(calls).toBe(1);
    for (const file of [
      ".teacher.json",
      ".pi-teacher-resumes.json",
      "quiz/grades/x.json",
      "quiz/key.json",
    ])
      expect((await fetch(`${base}/c/rust/${item.lesson}/${file}`)).status).toBe(404);
    const state = await (
      await fetch(`${base}/api/state?classroom=rust&lesson=${item.lesson}`)
    ).json();
    expect(state.reteach).toHaveLength(1);
    expect(JSON.stringify(state)).not.toContain("The new owner releases the value.");
  });
});
