import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { applyAnswer, applyTurnAnswer } from "../src/answers.ts";
import { applyGrade } from "../src/quiz-grading.ts";
import * as store from "../src/store.ts";
import { makeFixture, seedClassroom, type Fixture } from "./helpers.ts";

let fixture: Fixture;

const anchor = { exact: "one owner", prefix: "has ", suffix: ".", occurrence: 0 };

function ask(question = "Why only one?"): store.Annotation {
  return store.createAnnotation({
    classroom: "rust",
    lesson: "001-ownership",
    question,
    selection: "one owner",
    anchor,
  });
}

/** An asked-and-answered card, ready for a follow-up. */
function answeredCard(question = "Why only one?", answer = "Because aliasing."): store.Annotation {
  const annotation = ask(question);
  applyAnswer(annotation.id, answer);
  return store.findAnnotation(annotation.id)!;
}

beforeEach(() => {
  fixture = makeFixture();
  seedClassroom(fixture);
});

afterEach(() => {
  fixture.cleanup();
});

describe("applyAnswer routing", () => {
  it("answers the pending follow-up rather than overwriting the original answer", () => {
    const card = answeredCard("Why only one?", "Because aliasing.");
    store.addFollowUp(card.id, "What about borrows?");

    applyAnswer(card.id, "Many readers, one writer.");

    const stored = store.findAnnotation(card.id)!;
    expect(stored.answerMarkdown).toBe("Because aliasing.");
    expect(stored.followUps![0].answerMarkdown).toBe("Many readers, one writer.");
  });

  it("can be pointed at one specific turn", () => {
    const card = answeredCard();
    const first = store.addFollowUp(card.id, "First")!.followUp;
    const second = store.addFollowUp(card.id, "Second")!.followUp;

    applyTurnAnswer(card.id, second.id, "Answer to the second.");

    const stored = store.findAnnotation(card.id)!;
    expect(stored.followUps![0].status).toBe("pending");
    expect(stored.followUps![0].id).toBe(first.id);
    expect(stored.followUps![1].answerMarkdown).toBe("Answer to the second.");
  });

  it("returns null for a card that no longer exists", () => {
    expect(applyAnswer("nope", "orphaned")).toBeNull();
  });
});

describe("applyGrade", () => {
  it("renders every piece of feedback to HTML", () => {
    const submission = store.createSubmission({
      classroom: "rust",
      lesson: "001-ownership",
      quizId: "check-1",
      quizTitle: "Check",
      kind: "check",
      answers: [{ questionId: "q1", value: "a" }],
    });

    const grade = applyGrade(submission, {
      score: 100,
      feedbackMarkdown: "Solid **work**.",
      questions: [{ questionId: "q1", correct: true, feedback: "Exactly `right`." }],
    });

    expect(grade.score).toBe(100);
    expect(grade.feedbackHtml).toContain("<strong>work</strong>");
    expect(grade.questions[0].feedbackHtml).toContain("<code>right</code>");
    expect(store.listGrades("rust", "001-ownership")).toHaveLength(1);
  });
});
