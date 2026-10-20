import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { applyGrade } from "../src/quiz-grading.ts";
import { TeacherService } from "../src/teacher-service.ts";
import { readTeacherState, saveTeacherState } from "../src/service-state.ts";
import { prepareResume, resumeTeacherTool } from "../src/teacher-resume.ts";
import * as server from "../src/server.ts";
import * as store from "../src/store.ts";
import {
  makeFixture,
  seedClassroom,
  termAnswer,
  writeGradedAttempt,
  type Fixture,
} from "./helpers.ts";
import type { TeacherPlan } from "../src/teacher.ts";

let fixture: Fixture;
const location = { classroom: "rust", lesson: "001-ownership" };
const plan = (text = "Which binding owns the buffer after a move?"): TeacherPlan => ({
  calls: [],
  message: text,
  learning_record: "",
  notes_markdown: "",
});
function graded(kind: "check" | "review" | "pretest" = "review", correct = false) {
  const submission = store.createSubmission({
    ...location,
    quizId: "check",
    quizTitle: "Review",
    kind,
    answers: [termAnswer("q1", "old binding")],
  });
  applyGrade(submission, {
    score: correct ? 100 : 0,
    feedbackMarkdown: "Check the owner.",
    questions: [{ questionId: "q1", correct, feedback: "The new binding owns it." }],
  });
  return { ...location, submission_id: submission.id };
}
beforeEach(() => {
  fixture = makeFixture();
  seedClassroom(fixture);
});
afterEach(async () => {
  await server.close();
  fixture.cleanup();
});

describe("explicit teacher handoff", () => {
  it("validates assessment identity, kind, and latest attempt before writing", () => {
    const input = graded();
    expect(() => prepareResume({ ...input, classroom: "other" })).toThrow();
    seedClassroom(fixture, { lesson: "002-other" });
    expect(() => prepareResume({ ...input, lesson: "002-other" })).toThrow("does not belong");
    expect(() => prepareResume({ ...input, lesson: "../001-ownership" })).toThrow();
    graded();
    expect(() => prepareResume(input)).toThrow("latest graded");
    const good = graded("check", true);
    expect(() => prepareResume(good)).toThrow("no missed");
    expect(() => prepareResume(graded("pretest"))).toThrow("Only a graded");
  });

  it("resolves a missed item only with a linked check after the latest feedback", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-13T12:00:00Z"));
      graded();
      fixture.write("rust/learning-records/0001-old.md", "# Prior understanding");
      vi.advanceTimersByTime(10);
      store.recordRetrievalCheck("rust", {
        key: "001-ownership/check/q1",
        learningRecord: "0001-old.md",
        answer: "The new binding",
        evidence: "Answered the prior check",
      });
      vi.advanceTimersByTime(10);
      const input = graded();
      fixture.write(
        "rust/learning-records/0002-free-form.md",
        "# The learner understands ownership",
      );
      expect(prepareResume(input).unresolvedKeys).toEqual(["001-ownership/check/q1"]);
      vi.advanceTimersByTime(10);
      store.recordRetrievalCheck("rust", {
        key: "001-ownership/check/q1",
        learningRecord: "0002-free-form.md",
        answer: "The new binding owns it",
        evidence: "Answered after the latest feedback",
      });
      expect(prepareResume(input).unresolvedKeys).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("requires a running server and returns an exact panel link", async () => {
    const input = graded();
    let calls = 0;
    const tool = resumeTeacherTool(() => calls++);
    await expect(tool.execute(input)).rejects.toThrow("Start the classroom server");
    expect(calls).toBe(0);
    const base = await server.start();
    const result = await tool.execute(input);
    expect(result.details.url).toBe(`${base}/c/rust/001-ownership#cl-teacher`);
    expect(calls).toBe(1);
  });

  it("recovers a service reply saved before its request was queued", async () => {
    const input = graded();
    const initial = new TeacherService(async () => plan());
    initial.attach("rust", "codex");
    initial.resume(input);
    await initial.idle();
    const saved = readTeacherState("rust")!;
    saved.messages.push({
      id: "chat:saved-reply",
      lesson: input.lesson,
      role: "learner",
      text: "The new binding owns it",
      at: Date.now() + 60_000,
    });
    saveTeacherState("rust", saved);
    let runs = 0;
    const recovered = new TeacherService(async (_identity, prompt) => {
      runs++;
      expect(prompt).toContain("The new binding owns it");
      return plan("Right. The new binding owns it.");
    });
    recovered.attach("rust");
    recovered.resume(input);
    recovered.resume(input);
    await recovered.idle();
    expect(runs).toBe(1);
    expect((recovered.publicState("rust", input.lesson) as any).messages.at(-1).role).toBe(
      "teacher",
    );
    expect(
      readTeacherState("rust")!.requests.filter((r) => r.id === "chat:saved-reply"),
    ).toHaveLength(1);
    expect(readTeacherState("rust")!.messages.map((m) => m.role)).toEqual([
      "teacher",
      "learner",
      "teacher",
    ]);
  });

  it.each(["codex", "claude"] as const)(
    "keeps %s identity, persists one resume, and preserves assessment bytes",
    async (backend) => {
      const input = graded();
      const assessmentDir = path.join(fixture.root, "rust/001-ownership/quiz");
      const files = fs.readdirSync(path.join(assessmentDir, "grades"));
      const original = files.map((file) =>
        fs.readFileSync(path.join(assessmentDir, "grades", file), "utf8"),
      );
      saveTeacherState("rust", {
        version: 1,
        identity: { backend, sessionId: "existing-teacher" },
        requests: [],
        messages: [],
      });
      let runs = 0;
      const teacher = new TeacherService(async (identity, prompt) => {
        runs++;
        expect(identity).toEqual({ backend, sessionId: "existing-teacher", requestedModel: null });
        expect(prompt).toContain(input.submission_id);
        return plan();
      });
      teacher.attach("rust");
      teacher.resume(input);
      teacher.resume(input);
      await teacher.idle();
      teacher.resume(input);
      expect(runs).toBe(1);
      expect(readTeacherState("rust")?.requests[0].kind).toBe("resume");
      expect(readTeacherState("rust")?.messages.map((m) => m.role)).toEqual(["teacher"]);
      const restarted = new TeacherService(async () => {
        throw new Error("duplicate");
      });
      restarted.attach("rust");
      restarted.resume(input);
      await restarted.idle();
      expect(
        files.map((file) => fs.readFileSync(path.join(assessmentDir, "grades", file), "utf8")),
      ).toEqual(original);
      expect(store.listRetrievalChecks("rust")).toEqual([]);
    },
  );

  it("reuses service pending work and conversation", async () => {
    const input = graded();
    let release!: (p: TeacherPlan) => void;
    const teacher = new TeacherService(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    teacher.attach("rust", "codex");
    teacher.chat("rust", "001-ownership", "Please explain", "existing");
    teacher.resume(input);
    expect(readTeacherState("rust")?.requests).toHaveLength(1);
    await Promise.resolve();
    release(plan());
    await teacher.idle();
    teacher.resume(input);
    expect(readTeacherState("rust")?.requests).toHaveLength(1);
  });

  it("restores a stopped service resume as failed until explicit retry", async () => {
    const input = graded();
    const request = prepareResume(input);
    saveTeacherState("rust", {
      version: 1,
      identity: { backend: "codex", sessionId: "existing" },
      messages: [],
      requests: [
        { ...request, kind: "resume", target: input.submission_id, at: 1, status: "running" },
      ],
    });
    let runs = 0;
    const teacher = new TeacherService(async () => {
      runs++;
      return plan();
    });
    teacher.attach("rust");
    teacher.resume(input);
    await teacher.idle();
    expect(runs).toBe(0);
    expect(readTeacherState("rust")?.requests[0].status).toBe("failed");
    teacher.retry("rust", request.id);
    await teacher.idle();
    expect(runs).toBe(1);
    expect(readTeacherState("rust")?.requests[0].status).toBe("done");
  });

  it("rejects resume evidence and grading plans, then retries without duplicating the request", async () => {
    const input = graded();
    let runs = 0;
    const teacher = new TeacherService(async () => {
      runs++;
      return runs === 1 ? { ...plan(), learning_record: "Fabricated evidence" } : plan();
    });
    teacher.attach("rust", "codex");
    teacher.resume(input);
    await teacher.idle();
    expect(readTeacherState("rust")?.requests[0].status).toBe("failed");
    expect(store.listLearningRecords("rust")).toEqual([]);
    teacher.resume(input);
    expect(runs).toBe(1);
    teacher.retry("rust", `resume:${input.submission_id}`);
    await teacher.idle();
    expect(readTeacherState("rust")?.requests).toHaveLength(1);
    expect(readTeacherState("rust")?.requests[0].status).toBe("done");
    expect(runs).toBe(2);
  });
});

it("resumes one corrective objective and resolves it through an old question alias", () => {
  const learning = {
    objectiveId: "ownership",
    objective: { statement: "Explain ownership.", application: true },
    task: "retrieval" as const,
    support: "independent" as const,
    assistance: "none" as const,
  };
  const submission = writeGradedAttempt({
    at: Date.now() - 1000,
    answers: ["q1", "q2"].map((id) => termAnswer(id, "old owner", { learning })),
    correct: { q1: false, q2: false },
  });
  const input = { ...location, submission_id: submission.id };
  expect(prepareResume(input).unresolvedKeys).toEqual(["001-ownership/@objective/ownership"]);
  fixture.write("rust/learning-records/0001-owner.md", "# Corrective retrieval");
  store.recordRetrievalCheck("rust", {
    key: "001-ownership/check-1/q2",
    learningRecord: "0001-owner.md",
    answer: "New owner",
    evidence: "Correct independent reply",
    assistance: "none",
  });
  expect(prepareResume(input).unresolvedKeys).toEqual([]);
});
