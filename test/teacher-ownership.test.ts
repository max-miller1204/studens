import { detectOpeningBackend, openingBackend } from "../src/teacher-host.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { makeFixture, seedClassroom, termAnswer, type Fixture } from "./helpers.ts";
import { TeacherService } from "../src/teacher-service.ts";
import { readTeacherState, saveTeacherState } from "../src/service-state.ts";
import {
  finishOwnershipTransaction,
  pendingOwnershipTransaction,
  recoverOwnershipTransaction,
  saveOwnershipTransaction,
} from "../src/teacher-ownership.ts";
import { startLessonRequest, lessonRequests } from "../src/next-lesson.ts";
import type { OwnershipTransaction } from "../src/teacher-ownership.ts";
import type { RunTeacher, TeacherPlan } from "../src/teacher.ts";
import * as store from "../src/store.ts";
import * as server from "../src/server.ts";

let f: Fixture;
let services: TeacherService[];
const ready: TeacherPlan = {
  calls: [],
  message: "Ready.",
  learning_record: "",
  notes_markdown: "",
};
const location = { classroom: "rust", lesson: "001-ownership" };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function service(run: RunTeacher) {
  const teacher = new TeacherService(run);
  services.push(teacher);
  return teacher;
}
function owner(classroom = "rust", backend: "pi" | "claude" | "codex" = "claude") {
  saveTeacherState(classroom, {
    version: 1,
    identity: { backend, sessionId: `${backend}-old`, requestedModel: "source-model" },
    requests: [],
    messages: [],
  });
}
beforeEach(() => {
  f = makeFixture();
  seedClassroom(f);
  services = [];
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const s of services) await s.stop();
  await server.close();
  f.cleanup();
});

it("selects a fresh target session, preserves same-adapter selection and archives prior identities", async () => {
  owner();
  const seen: unknown[] = [];
  const teacher = service(
    async (identity, _prompt, _cwd, save, _signal, contract, _raw, active) => {
      seen.push({ ...identity });
      expect(contract).toEqual({ operations: [], messageRequired: true });
      save(identity.sessionId ?? `new-${seen.length}`);
      active?.("target-default");
      return ready;
    },
  );
  teacher.restore();
  await teacher.open("rust", "codex");
  expect(seen[0]).toEqual({ backend: "codex", selectionRevision: 1 });
  expect(readTeacherState("rust")!.previousIdentities).toHaveLength(1);
  await teacher.open("rust", "codex");
  expect(seen[1]).toMatchObject({ sessionId: "new-1", backend: "codex" });
  await teacher.open("rust", "pi");
  await teacher.open("rust", "codex");
  expect(seen[3]).not.toHaveProperty("sessionId");
  expect(seen[3]).not.toHaveProperty("requestedModel");
  expect(readTeacherState("rust")!.identity.sessionId).toBe("new-4");
  expect(teacher.publicState("rust")).not.toHaveProperty("identity.sessionId");
});

it("fails readiness without changing any list owner and releases queued work to the prior teacher", async () => {
  seedClassroom(f, { classroom: "biology" });
  owner();
  owner("biology", "pi");
  const teacher = service(async (_identity, _prompt, cwd, save) => {
    save("candidate");
    if (cwd.endsWith("rust")) throw new Error("Authentication denied");
    return ready;
  });
  teacher.restore();
  await expect(teacher.open(null, "codex")).rejects.toThrow(
    "rust with codex teacher: Authentication denied",
  );
  expect(readTeacherState("rust")!.identity.backend).toBe("claude");
  expect(readTeacherState("biology")!.identity.backend).toBe("pi");
  expect(pendingOwnershipTransaction()).toBeNull();
  expect(fs.readdirSync(path.join(f.root, ".teacher-migrations"))).toHaveLength(1);
});

it("keeps the same saved session on readiness failure and never silently replaces it", async () => {
  owner();
  const teacher = service(async (identity) => {
    expect(identity.sessionId).toBe("claude-old");
    throw new Error("Session damaged");
  });
  teacher.restore();
  await expect(teacher.open("rust", "claude")).rejects.toThrow("Session damaged");
  expect(readTeacherState("rust")!.identity).toMatchObject({
    backend: "claude",
    sessionId: "claude-old",
    requestedModel: "source-model",
  });
});

it("does not assign a new owner when first readiness fails", async () => {
  const teacher = service(async () => {
    throw new Error("Executable missing");
  });
  await expect(teacher.open("rust", "codex")).rejects.toThrow("Executable missing");
  expect(readTeacherState("rust")).toBeNull();
});

it.each([false, true])(
  "finishes active grading once before switching; active failure=%s",
  async (fail) => {
    owner();
    f.write("rust/001-ownership/quiz/key.json", '{"q1":"dropped"}');
    const entered = deferred(),
      release = deferred(),
      preparing = deferred(),
      finishReady = deferred();
    const seen: string[] = [];
    const teacher = service(async (identity, prompt, _cwd, save) => {
      if (prompt.startsWith("Readiness check only.")) {
        seen.push(`ready:${identity.backend}`);
        preparing.resolve();
        await finishReady.promise;
        save("fresh");
        return ready;
      }
      seen.push(`learner:${identity.backend}`);
      if (seen.length === 1) {
        entered.resolve();
        await release.promise;
        if (fail) throw new Error("Grade deadline");
        const submission = store.listSubmissions("rust", location.lesson)[0];
        return {
          ...ready,
          calls: [
            {
              name: "grade_quiz_answers",
              arguments_json: JSON.stringify({
                submission_id: submission.id,
                feedback_markdown: "Check ownership.",
                questions: [{ question_id: "q1", correct: false, feedback: "Dropped." }],
              }),
            },
          ],
        };
      }
      return ready;
    });
    teacher.restore();
    await teacher.idle();
    const submission = store.createSubmission({
      ...location,
      quizId: "check-1",
      quizTitle: "Ownership",
      kind: "check",
      answers: [termAnswer("q1", "forever")],
    });
    teacher.submission(submission);
    await entered.promise;
    const opening = teacher.open("rust", "codex");
    await Promise.resolve();
    await Promise.resolve();
    teacher.chat("rust", location.lesson, "Queued during switching", randomUUID());
    expect((teacher.publicState("rust") as any).switching).toBe("codex");
    release.resolve();
    await preparing.promise;
    teacher.chat("rust", location.lesson, "Queued during readiness", randomUUID());
    expect(seen).toEqual(["learner:claude", "ready:codex"]);
    finishReady.resolve();
    await opening;
    await teacher.idle();
    expect(seen).toEqual(["learner:claude", "ready:codex", "learner:codex", "learner:codex"]);
    expect(store.listGrades("rust", location.lesson)).toHaveLength(fail ? 0 : 1);
    const request = readTeacherState("rust")!.requests[0];
    expect(request.status).toBe(fail ? "failed" : "done");
    expect(request.originatingIdentity?.backend).toBe("claude");
    if (fail) {
      expect(request.error).toContain("Grade deadline");
      // Explicit retry runs with the committed adapter; opening did not retry it.
      teacher.retry("rust", request.id);
      await teacher.idle();
      expect(seen.at(-1)).toBe("learner:codex");
    }
  },
);

it("serializes concurrent named and list opens and keeps the last successful owner", async () => {
  seedClassroom(f, { classroom: "biology" });
  owner();
  owner("biology", "pi");
  const entered = deferred(),
    release = deferred();
  let n = 0;
  const seen: string[] = [];
  const teacher = service(async (identity, _p, cwd) => {
    seen.push(`${path.basename(cwd)}:${identity.backend}`);
    if (++n === 1) {
      entered.resolve();
      await release.promise;
    }
    return ready;
  });
  teacher.restore();
  const first = teacher.open(null, "codex");
  await entered.promise;
  const second = teacher.open("rust", "claude");
  const third = teacher.open("rust", "pi");
  expect(seen).toHaveLength(1);
  release.resolve();
  await Promise.all([first, second, third]);
  expect(seen.slice(0, 2).every((x) => x.endsWith(":codex"))).toBe(true);
  expect(seen.slice(2)).toEqual(["rust:claude", "rust:pi"]);
  expect(readTeacherState("rust")!.identity.backend).toBe("pi");
  expect(readTeacherState("biology")!.identity.backend).toBe("codex");
});

it.each(["prepared", "committed"] as const)(
  "recovers a %s batch before queue restoration without inference",
  async (decision) => {
    seedClassroom(f, { classroom: "biology" });
    owner();
    owner("biology", "pi");
    const request = startLessonRequest("rust", randomUUID(), "Ownership", "claude", "service");
    const historical = startLessonRequest("biology", randomUUID(), "Cells", "pi", "service");
    const { updateLessonRequest } = await import("../src/next-lesson.ts");
    updateLessonRequest(historical, { status: "done" });
    updateLessonRequest(request, { status: "failed", error: "Retained failure" });
    const transaction: OwnershipTransaction = {
      version: 1,
      decision,
      changes: ["rust", "biology"].map((classroom) => ({
        classroom,
        prior: readTeacherState(classroom)!.identity,
        candidate: { backend: "codex", sessionId: `new-${classroom}` },
      })),
    };
    saveOwnershipTransaction(transaction);
    if (decision === "committed") {
      // Simulate a crash after the first identity write, before its lesson-owner write.
      const state = readTeacherState("rust")!;
      state.identity = transaction.changes[0].candidate;
      saveTeacherState("rust", state);
    }
    recoverOwnershipTransaction();
    const run = vi.fn<RunTeacher>(async () => ready);
    const teacher = service(run);
    teacher.restore();
    await teacher.idle();
    expect(run).not.toHaveBeenCalled();
    expect(readTeacherState("rust")!.identity.backend).toBe(
      decision === "committed" ? "codex" : "claude",
    );
    expect(readTeacherState("biology")!.identity.backend).toBe(
      decision === "committed" ? "codex" : "pi",
    );
    expect(lessonRequests("rust")[0].owner).toBe(decision === "committed" ? "codex" : "claude");
    expect(lessonRequests("rust")[0].error).toBe("Retained failure");
    expect(lessonRequests("biology")[0].owner).toBe("pi");
  },
);

it("keeps committed transactions for recovery when an ownership write fails", () => {
  owner();
  const transaction: OwnershipTransaction = {
    version: 1,
    decision: "committed",
    changes: [
      {
        classroom: "rust",
        prior: readTeacherState("rust")!.identity,
        candidate: { backend: "codex" },
      },
    ],
  };
  saveOwnershipTransaction(transaction);
  const blocked = path.join(f.root, "rust/.teacher.json.tmp");
  fs.mkdirSync(blocked);
  expect(() => finishOwnershipTransaction(transaction)).toThrow();
  expect(pendingOwnershipTransaction()?.decision).toBe("committed");
  fs.rmdirSync(blocked);
  recoverOwnershipTransaction();
  expect(readTeacherState("rust")!.identity.backend).toBe("codex");
});

it("requires explicit selection for unknown hosts and rejects configured host overrides", () => {
  expect(() => detectOpeningBackend("codex", "claude")).toThrow(
    "conflicts with opening host codex",
  );
  expect(detectOpeningBackend("unknown", "claude")).toBeUndefined();
  expect(() => openingBackend(undefined, undefined)).toThrow("initiating host is unknown");
  expect(openingBackend(undefined, "pi")).toBe("pi");
  expect(() => openingBackend("codex", "claude")).toThrow("conflicts with opening host codex");
});

it("recovers an applied grade plan across migration without another learner inference or grade", async () => {
  owner();
  f.write("rust/001-ownership/quiz/key.json", '{"q1":"dropped"}');
  const submission = store.createSubmission({
    ...location,
    quizId: "check-1",
    quizTitle: "Ownership",
    kind: "check",
    answers: [termAnswer("q1", "forever")],
  });
  let learnerTurns = 0;
  const first = service(async (_identity, _prompt, _cwd, _save, _signal, _contract, raw) => {
    learnerTurns++;
    raw?.({ source: "retained-claude-output" });
    return {
      ...ready,
      calls: [
        {
          name: "grade_quiz_answers",
          arguments_json: JSON.stringify({
            submission_id: submission.id,
            feedback_markdown: "Check ownership.",
            questions: [{ question_id: "q1", correct: false, feedback: "Dropped." }],
          }),
        },
      ],
    };
  });
  first.restore();
  await first.idle();
  await first.stop();
  const state = readTeacherState("rust")!;
  const request = state.requests[0];
  const originalOutput = request.modelOutput;
  const originalPlan = request.plan;
  // The grade exists, but the process lost its saved call receipt.
  request.status = "planned";
  request.applied = 0;
  saveTeacherState("rust", state);
  const recovered = service(async (_identity, prompt) => {
    expect(prompt).toMatch(/^Readiness check only\./);
    return ready;
  });
  await recovered.open("rust", "codex");
  await recovered.idle();
  expect(store.listGrades("rust", location.lesson)).toHaveLength(1);
  expect(readTeacherState("rust")!.requests[0]).toMatchObject({
    id: request.id,
    plan: originalPlan,
    status: "done",
    originatingIdentity: { backend: "claude" },
  });
  expect(readTeacherState("rust")!.requests[0].modelOutput).toEqual(originalOutput);
  expect(learnerTurns).toBe(1);
});

it("fails before the commit decision without changing owners when the journal cannot save", async () => {
  owner();
  const teacher = service(async () => ready);
  teacher.restore();
  const blocked = path.join(f.root, ".teacher-ownership.json.tmp");
  fs.mkdirSync(blocked);
  await expect(teacher.open("rust", "codex")).rejects.toThrow();
  expect(readTeacherState("rust")!.identity.backend).toBe("claude");
  expect((teacher.publicState("rust") as any).switching).toBeNull();
  fs.rmdirSync(blocked);
});
