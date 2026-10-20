import * as fs from "node:fs";
import * as path from "node:path";
import {
  seedClassroom,
  seedPreparedReviewSource,
  writeGradedAttempt,
  termAnswer,
} from "./helpers.ts";
import * as store from "../src/store.ts";
import { DAY_MS } from "../src/review.ts";
import type { Fixture } from "./helpers.ts";
export const NOW = Date.UTC(2026, 9, 20, 12);
export function seedMemory(f: Fixture) {
  seedClassroom(f, { title: "Practical Rust" });
  const ids = [
    "retained",
    "transfer",
    "partial",
    "assisted",
    "paused",
    "legacy",
    "upcoming",
    "retired",
  ];
  seedPreparedReviewSource(f.root, "rust", "001-ownership", "check-1", ids);
  const statements: Record<string, string> = {
    retained: "Explain when an owner releases a value.",
    transfer: "Choose an ownership strategy for an unfamiliar program.",
    partial: "Trace a moved value across function boundaries.",
    assisted: "Distinguish borrowing from moving with a worked example.",
    paused: "Repair a borrow that outlives its owner.",
    upcoming: "Explain why a returned reference needs a valid lifetime.",
    retired: "Recognize a valid owner.",
  };
  for (const id of ids) {
    const days =
      id === "retained" || id === "transfer"
        ? [0, 2, 9]
        : id === "paused"
          ? [5, 6, 7]
          : id === "upcoming"
            ? [19.25]
            : [0];
    for (const day of days) {
      const learning =
        id === "legacy"
          ? undefined
          : {
              objectiveId: id,
              objective: {
                statement: statements[id],
                application: id === "transfer",
                retentionDays: 16,
              },
              task: "retrieval" as const,
              support: "independent" as const,
              assistance: id === "assisted" ? ("hint" as const) : ("none" as const),
            };
      const submission = writeGradedAttempt({
        at: NOW - 20 * DAY_MS + day * DAY_MS,
        answers: [
          termAnswer(id, "Saved learner answer", {
            learning,
            prompt: id === "legacy" ? "Explain the old ownership example." : statements[id],
          }),
        ],
        correct: { [id]: id !== "partial" && id !== "paused" },
      });
      if (id === "partial") {
        const grade = store
          .listGrades("rust", "001-ownership")
          .find((g) => g.submissionId === submission.id)!;
        store.writeGrade({
          ...grade,
          gradedAt: grade.gradedAt + 1,
          questions: [
            {
              questionId: id,
              correct: false,
              pointsEarned: 1,
              pointsPossible: 2,
              feedback: "The moved value is identified; explain who releases it.",
            },
          ],
        });
      }
    }
  }
  const plan = JSON.parse(requirePlan(f));
  plan.objectives = Object.fromEntries(
    Object.entries(statements).map(([id, statement]) => [
      id,
      { statement, application: id === "transfer", retentionDays: 16 },
    ]),
  );
  plan.objectives.legacy = {
    statement: "Explain a historical ownership example.",
    application: false,
  };
  for (const id of ids) plan.quizzes["check-1"].questions[id].objective = id;
  for (const id of ids)
    if (id === "transfer")
      for (const v of Object.values(plan.quizzes["check-1"].questions[id].variants) as Array<{
        task: string;
      }>)
        v.task = "transfer";
  f.write("rust/001-ownership/quiz/plan.json", JSON.stringify(plan));
  const retired = store.reviewItems("rust").find((i) => i.questionId === "retired")!;
  store.setReviewRetired("rust", retired.key, true, 0);
  seedClassroom(f, { classroom: "empty", title: "New classroom" });
  return store.reviewItems("rust");
}

function requirePlan(f: Fixture): string {
  return fs.readFileSync(path.join(f.root, "rust/001-ownership/quiz/plan.json"), "utf8");
}
