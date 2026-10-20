import * as paths from "../src/paths.ts";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { resolveClassroom } from "../src/commands.ts";
import {
  askPrompt,
  dedicatedTeacherPrompt,
  followUpPrompt,
  gradePrompt,
  PRETEST_FOLLOW_UP,
  QUIZ_FOLLOW_UP,
  reflectPrompt,
  reviewStatusText,
  teachingPrompt,
} from "../src/prompts.ts";
import { DAY_MS } from "../src/review.ts";
import type { Annotation, FollowUp, QuizGrade, QuizSubmission, Reflection } from "../src/store.ts";
import { makeFixture, seedClassroom, type Fixture } from "./helpers.ts";

let fixture: Fixture;

beforeEach(() => {
  fixture = makeFixture();
});

afterEach(() => {
  fixture.cleanup();
});

describe("teachingPrompt", () => {
  it("keeps unavailable authoring and wait instructions out of service requests", () => {
    const prompt = dedicatedTeacherPrompt("r1", "Grade this check.", {}, []);
    expect(prompt).not.toContain("wait_for_learner");
    expect(prompt).not.toContain("scaffold_lesson");
    expect(prompt).not.toContain("Call `lesson_health`");

    const reflection: Reflection = {
      id: "r1",
      classroom: "rust",
      lesson: "001-ownership",
      reflectId: "explain",
      prompt: "Explain.",
      text: "My idea.",
      savedAt: 1,
    };
    expect(reflectPrompt(reflection, "service")).not.toContain("wait_for_learner");
  });
});

describe("followUpPrompt", () => {
  const card: Annotation = {
    id: "a1",
    classroom: "rust",
    lesson: "001-ownership",
    status: "answered",
    question: "Why only one owner?",
    selection: "one owner",
    anchor: { exact: "one owner", prefix: "", suffix: "", occurrence: 0 },
    answerMarkdown: "Because two owners could double-free.",
    answerHtml: "<p>Because two owners could double-free.</p>",
    createdAt: 1,
    answeredAt: 2,
    followUps: [],
  };

  const followUp = (id: string, question: string, answer: string | null): FollowUp => ({
    id,
    status: answer ? "answered" : "pending",
    question,
    answerMarkdown: answer,
    answerHtml: answer ? `<p>${answer}</p>` : null,
    askedAt: 3,
    answeredAt: answer ? 4 : null,
  });

  it("includes earlier follow-ups but stops at the one being asked", () => {
    const earlier = followUp("f1", "What about borrows?", "Many readers, one writer.");
    const asking = followUp("f2", "And across threads?", null);
    const later = followUp("f3", "Asked after this one", null);

    const prompt = followUpPrompt(
      { ...card, followUps: [earlier, asking, later] },
      asking,
      "service",
    );

    expect(prompt).toContain("What about borrows?");
    expect(prompt).toContain("Many readers, one writer.");
    expect(prompt).toContain("And across threads?");
    expect(prompt).not.toContain("Asked after this one");
  });
});

describe("quiz highlights and the teacher panel", () => {
  const card: Annotation = {
    id: "a1",
    classroom: "rust",
    lesson: "001-ownership",
    status: "pending",
    question: "What does drop mean here?",
    selection: "dropped",
    anchor: { exact: "dropped", prefix: "", suffix: "", occurrence: 0 },
    answerMarkdown: null,
    answerHtml: null,
    createdAt: 1,
    answeredAt: null,
  };

  it("tells the teacher not to solve a quiz question before it is graded", () => {
    const prompt = askPrompt(
      { ...card, quiz: { quizId: "check-1", questionId: "q2", graded: false } },
      "service",
    );
    expect(prompt).toContain("question `q2` of quiz `check-1`");
    expect(prompt).toContain("Do not give the answer");
  });

  it("lets the teacher explain a graded quiz question", () => {
    const prompt = askPrompt(
      { ...card, quiz: { quizId: "check-1", questionId: "q2", graded: true } },
      "service",
    );
    expect(prompt).toContain("has been graded");
    expect(prompt).not.toContain("Do not give the answer");
  });
});

describe("resolveClassroom", () => {
  it("matches an existing classroom by directory name, slug, or title", () => {
    seedClassroom(fixture, { classroom: "rust-ownership", title: "Rust Ownership" });

    expect(resolveClassroom("rust-ownership")).toBe("rust-ownership");
    expect(resolveClassroom("Rust Ownership")).toBe("rust-ownership");
    expect(resolveClassroom("rust ownership")).toBe("rust-ownership");
  });

  it("returns null for a topic with no classroom yet", () => {
    seedClassroom(fixture, { classroom: "rust" });
    expect(resolveClassroom("yoga")).toBeNull();
  });

  it("continues the only classroom when /teach is given no topic", () => {
    seedClassroom(fixture, { classroom: "rust" });
    expect(resolveClassroom("")).toBe("rust");
  });

  it("stays out of it when there are several classrooms and no topic", () => {
    seedClassroom(fixture, { classroom: "rust" });
    seedClassroom(fixture, { classroom: "yoga" });
    expect(resolveClassroom("")).toBeNull();
  });
});

describe("gradePrompt", () => {
  const base: QuizSubmission = {
    id: "s1",
    classroom: "rust",
    lesson: "001-ownership",
    quizId: "check-1",
    quizTitle: "Ownership",
    kind: "check",
    attempt: 1,
    answers: [
      {
        questionId: "q1",
        type: "cloze",
        prompt: "Fill in the blank.",
        passage: "A value has one [[b1]].",
        parts: [{ id: "b1", value: "owner" }],
        confidence: "sure",
      },
    ],
    submittedAt: 4,
  };

  it("shows typed answers and ignores saved confidence metadata", () => {
    const prompt = gradePrompt(base, "service");
    expect(prompt).toContain("[q1] (cloze) Fill in the blank.");
    expect(prompt).toContain("A value has one [b1: «owner»].");
    expect(prompt).not.toContain("Their confidence");
    expect(prompt).not.toContain("misconception");
  });

  it("tells the teacher a pretest is diagnostic, with no retrieval check", () => {
    const prompt = gradePrompt({ ...base, kind: "pretest" }, "service");
    expect(prompt).toContain("**pretest**");
    expect(prompt).toContain(PRETEST_FOLLOW_UP);
    expect(prompt).not.toContain(QUIZ_FOLLOW_UP);
  });

  it("names the attempt and the previous score on a retake", () => {
    const previous = { score: 40 } as QuizGrade;
    const prompt = gradePrompt({ ...base, attempt: 2 }, "service", previous);
    expect(prompt).toContain("Attempt 2 at this quiz. The previous attempt scored 40%.");
  });

  it("still reads submissions written before question types existed", () => {
    const prompt = gradePrompt(
      {
        ...base,
        kind: undefined,
        answers: [
          { questionId: "q1", value: "a", label: "First", prompt: "Pick all." },
          { questionId: "q1", value: "c", label: "Third", prompt: "Pick all." },
        ],
      },
      "service",
    );
    expect(prompt).toContain("1. [q1] Pick all.");
    expect(prompt).toContain("Their answer: First; Third");
    expect(prompt).not.toContain("2. [q1]");
  });
});

describe("reviewStatusText", () => {
  const now = Date.UTC(2026, 0, 10);

  it("asks for a review before new material when questions are due", () => {
    const text = reviewStatusText(
      {
        total: 5,
        due: 2,
        dueSoon: 1,
        retained: 1,
        transferNeeded: 0,
        unknown: 0,
        nextDueAt: now + DAY_MS,
      },
      now,
    );
    expect(text).toContain("2 are due for review now");
    expect(text).toContain("scaffold_review");
  });
});

it("fails loudly when the required teaching method is missing", () => {
  const spy = vi.spyOn(paths, "docsDir").mockReturnValue(fixture.root);
  try {
    expect(() => teachingPrompt("rust", null)).toThrow(/TEACHING.md/);
  } finally {
    spy.mockRestore();
  }
});
