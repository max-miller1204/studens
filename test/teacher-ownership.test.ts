import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { makeFixture, seedClassroom, type Fixture } from "./helpers.ts";
import { readTeacherState, saveTeacherState } from "../src/service-state.ts";
import {
  finishOwnershipTransaction,
  pendingOwnershipTransaction,
  recoverOwnershipTransaction,
  saveOwnershipTransaction,
} from "../src/teacher-ownership.ts";
import { startLessonRequest, lessonRequests } from "../src/next-lesson.ts";
import type { OwnershipTransaction } from "../src/teacher-ownership.ts";
let f: Fixture;
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
});
afterEach(() => {
  f.cleanup();
});

it.each(["prepared", "committed"] as const)(
  "recovers a %s batch and preserves failed and historical requests",
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
