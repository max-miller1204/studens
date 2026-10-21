import { refillOutputPlan } from "../src/refill-output.ts";
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
  piRefillTool,
  refreshRefill,
} from "../src/review-refill.ts";
import { lessonPools } from "../src/review-pool.ts";
import { startReview, completePreparedReview } from "../src/review-session.ts";
import { ClassroomBridge } from "../src/bridge.ts";
import { TeacherService } from "../src/teacher-service.ts";
import { readTeacherState, saveTeacherState } from "../src/service-state.ts";
import * as store from "../src/store.ts";
import {
  makeFixture,
  seedClassroom,
  seedPreparedReviewSource,
  seedTransferObjective,
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

it.each(["miss", "low"] as const)(
  "refills an objective's original question pool after a %s",
  (reason) => {
    if (reason === "low") {
      seedTransferObjective(true);
      completePreparedReview(startReview("rust", randomUUID(), "service").session);
    } else {
      writeGradedAttempt({
        at: 2,
        answers: [
          termAnswer("q1", "the original owner", {
            learning: {
              objectiveId: "owner",
              objective: { statement: "Explain ownership.", application: false },
              task: "retrieval",
              support: "independent",
              assistance: "none",
            },
          }),
        ],
        correct: { q1: false },
      });
    }
    const request = discoverRefills("rust", "service").find(
      (r) => r.key.includes("/@objective/") && r.reason === reason,
    );
    expect(request).toBeDefined();
    expect(() => refreshRefill(request!)).not.toThrow();
    const input = request!.input;
    const sourceKey = `${input.quizId}/${input.questionId}`;
    const before = lessonPools("rust", input.lesson).get(sourceKey)!.length;
    const keyPath = path.join(fixture.root, "rust", input.lesson, "quiz/key.json");
    const originalKey = fs.readFileSync(keyPath, "utf8");
    const originalGrades = store.listGrades("rust", input.lesson);
    updateRefill(request!, "running");
    saveRefillPlan(request!, variants(request!));
    applyRefill(request!);
    updateRefill(request!, "planned");
    applyRefill(request!);
    expect(lessonPools("rust", input.lesson).get(sourceKey)).toHaveLength(
      before + (reason === "miss" ? 1 : 2),
    );
    expect(fs.readFileSync(keyPath, "utf8")).toBe(originalKey);
    expect(store.listGrades("rust", input.lesson)).toEqual(originalGrades);
  },
);

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
  // Crash after the batch rename but before the durable request is marked done.
  updateRefill(request, "planned");
  saveRefillPlan(request, variants(request));
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

it("runs queued learner work before refills and requires explicit retry after a model error", async () => {
  const order: string[] = [];
  let fail = true;
  const teacher = new TeacherService(async (_id, prompt) => {
    if (prompt.includes("Background private review refill")) {
      order.push("refill");
      if (fail) throw new Error("Fixture refill unavailable.");
      return refillPlan(refillRequests("rust")[0]);
    }
    order.push("learner");
    return { calls: [], message: "Your answer is saved.", learning_record: "", notes_markdown: "" };
  });
  teacher.attach("rust", "codex");
  teacher.chat("rust", "001-ownership", "Continue", randomUUID());
  await teacher.idle();
  expect(order).toEqual(["learner", "refill"]);
  expect(refillRequests("rust")[0]).toMatchObject({
    status: "failed",
    error: expect.stringContaining("Fixture refill unavailable"),
  });
  teacher.maintenance("rust");
  await teacher.idle();
  expect(order).toHaveLength(2);
  fail = false;
  teacher.retry("rust", refillRequests("rust")[0].id);
  await teacher.idle();
  expect(refillRequests("rust")[0].status).toBe("done");
  expect(store.listGrades("rust", "001-ownership")).toHaveLength(1);
  expect(readTeacherState("rust")!.messages.filter((m) => m.role === "teacher")).toHaveLength(1);
  await teacher.stop();
});

it("recovers a saved service refill plan without another model turn or grade", async () => {
  const request = discoverRefills("rust", "service")[0];
  updateRefill(request, "running");
  saveTeacherState("rust", {
    version: 1,
    identity: { backend: "codex" },
    requests: [
      {
        id: request.id,
        classroom: "rust",
        lesson: request.lesson,
        kind: "refill",
        target: request.id,
        prompt: request.prompt,
        at: request.at,
        status: "planned",
        plan: refillPlan(request),
        planVersion: 2,
      },
    ],
    messages: [],
  });
  let runs = 0;
  const teacher = new TeacherService(async () => {
    runs++;
    throw new Error("Unexpected model");
  });
  teacher.restore();
  await teacher.idle();
  expect(runs).toBe(0);
  expect(refillRequests("rust")[0].status).toBe("done");
  expect(lessonPools("rust", "001-ownership").get("check-1/q1")).toHaveLength(3);
  expect(store.listGrades("rust", "001-ownership")).toHaveLength(1);
  await teacher.stop();
  const state = readTeacherState("rust")!;
  state.requests[0].status = "planned";
  saveTeacherState("rust", state);
  updateRefill(refillRequests("rust")[0], "planned");
  const replayed = new TeacherService(async () => {
    runs++;
    throw new Error("Unexpected model replay");
  });
  replayed.restore();
  await replayed.idle();
  expect(runs).toBe(0);
  expect(refillRequests("rust")[0].status).toBe("done");
  expect(lessonPools("rust", "001-ownership").get("check-1/q1")).toHaveLength(3);
  expect(store.listGrades("rust", "001-ownership")).toHaveLength(1);
  await replayed.stop();
});

it("keeps Pi background work behind live turns, isolates its writes, and replays a saved plan", async () => {
  const sent: string[] = [];
  const bridge = new ClassroomBridge({ sendUserMessage: (text) => sent.push(text) });
  bridge.noteForeignTurn();
  bridge.maintenance("rust");
  await new Promise((r) => setTimeout(r, 10));
  expect(sent).toHaveLength(0);
  bridge.onAgentEnd([]);
  await new Promise((r) => setTimeout(r, 10));
  expect(sent).toHaveLength(1);
  expect(() => bridge.assertCanWrite("grade_lesson_quiz")).toThrow("only save private");
  const request = refillRequests("rust")[0];
  const args = JSON.parse(refillPlan(request).calls[0].arguments_json);
  expect((await piRefillTool().execute(args)).details.error).toBeUndefined();
  bridge.onAgentEnd([]);
  expect(refillRequests("rust")[0].status).toBe("done");
  expect(store.listPanelMessages("rust", "001-ownership")).toHaveLength(0);
  expect(store.listGrades("rust", "001-ownership")).toHaveLength(1);
  bridge.reset();
});

it("keeps a malformed background pool from blocking saved grades and leaves retry explicit", async () => {
  fixture.write("rust/001-ownership/quiz/key.json", "broken after grading");
  const teacher = new TeacherService(async () => refillPlan(refillRequests("rust")[0]));
  teacher.attach("rust", "codex");
  await teacher.idle();
  const request = refillRequests("rust")[0];
  expect(request).toMatchObject({
    status: "failed",
    error: expect.stringContaining("Cannot prepare private review refill"),
  });
  expect(store.listGrades("rust", "001-ownership")).toHaveLength(1);
  expect(() => teacher.retry("rust", request.id)).toThrow();
  expect(readTeacherState("rust")!.requests[0].status).toBe("failed");
  seedPreparedReviewSource(fixture.root);
  teacher.retry("rust", request.id);
  await teacher.idle();
  expect(refillRequests("rust")[0].status).toBe("done");
  expect(store.listGrades("rust", "001-ownership")).toHaveLength(1);
  await teacher.stop();
});

it("keeps queued Pi work with its live owning process", async () => {
  const request = discoverRefills("rust", "pi")[0];
  request.ownerPid = process.ppid;
  fixture.write("rust/.review-refills.json", JSON.stringify({ version: 1, requests: [request] }));
  const sent: string[] = [];
  const bridge = new ClassroomBridge({ sendUserMessage: (text) => sent.push(text) });
  bridge.restoreRefills();
  await new Promise((r) => setTimeout(r, 10));
  expect(sent).toHaveLength(0);
  expect(refillRequests("rust")[0].status).toBe("queued");
  const teacher = new TeacherService(async () => refillPlan(request));
  expect(() => teacher.attach("rust", "codex")).toThrow("live Pi session");
  await teacher.stop();
  bridge.reset();
});

it("does not restart Pi refills after a persistent teacher takes ownership", async () => {
  const request = discoverRefills("rust", "pi")[0];
  request.ownerPid = 999999999;
  fixture.write("rust/.review-refills.json", JSON.stringify({ version: 1, requests: [request] }));
  saveTeacherState("rust", {
    version: 1,
    identity: { backend: "codex" },
    requests: [],
    messages: [],
  });
  const sent: string[] = [];
  const bridge = new ClassroomBridge({ sendUserMessage: (text) => sent.push(text) });
  bridge.restoreRefills();
  await new Promise((r) => setTimeout(r, 10));
  expect(sent).toHaveLength(0);
  expect(refillRequests("rust")[0].status).toBe("queued");
  bridge.reset();
});

it("refreshes queued refills after earlier pool writes and keeps explicit retry errors", async () => {
  const session = startReview("rust", randomUUID(), "service").session;
  completePreparedReview(session);
  const requests = discoverRefills("rust", "service");
  expect(requests).toHaveLength(2);
  const order: string[] = [];
  const teacher = new TeacherService(async (_identity, prompt) => {
    const current = refillRequests("rust").find((request) => request.status === "running")!;
    if (order.length) {
      const firstVariant = JSON.parse(refillPlan(requests[0]).calls[0].arguments_json).variants[0]
        .id;
      expect(prompt).toContain(`"id":"${firstVariant}"`);
    }
    order.push(current.id);
    return refillPlan(current);
  });
  teacher.attach("rust", "codex");
  await teacher.idle();
  expect(order).toHaveLength(2);
  expect(refillRequests("rust").every((request) => request.status === "done")).toBe(true);
  await teacher.stop();
  const request = refillRequests("rust")[0];
  delete request.plan;
  request.status = "failed";
  request.error = "A prior generated variant reused an existing id.";
  fixture.write("rust/.review-refills.json", JSON.stringify({ version: 1, requests: [request] }));
  const retried = refreshRefill(request);
  updateRefill(retried, "queued");
  expect(refreshRefill(refillRequests("rust")[0]).prompt).toContain(request.error);
});

it("binds fresh refill count to durable intent and retains wrong-count data across restart", async () => {
  const request = discoverRefills("rust", "service")[0];
  let turns = 0;
  const raw = {
    classroom: request.classroom,
    request_id: request.id,
    variants: [{ id: "a" }, { id: "b" }],
  };
  const before = fs.readFileSync(
    path.join(fixture.root, "rust/001-ownership/quiz/key.json"),
    "utf8",
  );
  const service = new TeacherService(
    async (_id, _prompt, _cwd, _save, _signal, contract, saveOutput) => {
      turns++;
      expect(contract.response).toBe("review-variants");
      expect(contract.refillTarget).toEqual({ classroom: "rust", requestId: request.id, count: 1 });
      saveOutput?.(raw);
      return refillOutputPlan(raw, contract.refillTarget);
    },
  );
  service.attach("rust", "codex");
  await service.idle();
  await service.stop();
  const resumed = new TeacherService(async () => {
    turns++;
    throw new Error("No automatic retry");
  });
  try {
    resumed.restore();
    await resumed.idle();
    expect(turns).toBe(1);
    const saved = readTeacherState("rust")!.requests.find((r) => r.id === request.id)!;
    expect(saved.status).toBe("failed");
    expect(saved.modelOutput).toEqual(raw);
    expect(saved.applied ?? 0).toBe(0);
    expect(saved.planValidated).not.toBe(true);
    expect(refillRequests("rust")[0].plan).toBeUndefined();
    expect(lessonPools("rust", "001-ownership").get("check-1/q1")).toHaveLength(2);
    expect(
      fs.readFileSync(path.join(fixture.root, "rust/001-ownership/quiz/key.json"), "utf8"),
    ).toBe(before);
    expect(store.listGrades("rust", "001-ownership")).toHaveLength(1);
  } finally {
    await resumed.stop();
  }
});
