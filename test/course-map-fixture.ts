import type { Fixture } from "./helpers.ts";
import { lessonHtml } from "./helpers.ts";
export function seedCourse(f: Fixture) {
  const write = (p: string, v: unknown) =>
    f.write("course/" + p, typeof v === "string" ? v : JSON.stringify(v));
  write("classroom.json", { title: "Practical Rust", emoji: "🦀", createdAt: 1 });
  write(
    "MISSION.md",
    "# Mission: Build a dependable CLI\n\n## Why\n\nShip a small command-line tool my team can maintain.\n\n## Success looks like\n\n- Explain ownership when reviewing a change.\n- Choose safe borrowing when values cross function boundaries.\n\n## Constraints\n\nTwo short sessions each week.\n\n## Out of scope\n\nUnsafe Rust and async runtimes.",
  );
  const quiz = (id: string, kind = "check") =>
    `<form class="cl-quiz" id="${id}" data-quiz-id="${id}" data-kind="${kind}" data-title="${id}"><ol class="cl-questions"><li class="cl-q" data-question-id="q1" data-type="short"><p class="cl-q-prompt">Explain the value.</p><textarea></textarea></li></ol></form>`;
  write(
    "001-values/lesson.html",
    lessonHtml(
      "Values and ownership",
      "<h1>Values and ownership</h1><p>Every value has an owner.</p>" +
        quiz("check-1") +
        quiz("recall-1"),
    ),
  );
  write("001-values/lesson.json", {
    title: "Values and ownership",
    summary: "Follow a value through a move.",
    createdAt: 2,
    instructionalContract: 1,
  });
  write("001-values/quiz/plan.json", {
    version: 1,
    objectives: {
      ownership: {
        statement: "Explain who owns a value after it moves, and when that value is released.",
        application: true,
        interleaveGroup: "PRIVATE_GROUP",
        strategy: "PRIVATE_STRATEGY",
      },
    },
    quizzes: {
      "check-1": {
        purpose: "assessment",
        questions: {
          q1: {
            objective: "ownership",
            task: "application",
            support: "assisted",
            variants: [{ secret: "PRIVATE_VARIANT" }],
          },
        },
      },
      "recall-1": {
        purpose: "prior-retrieval",
        questions: { q1: { objective: "ownership", task: "retrieval", support: "independent" } },
      },
    },
  });
  write("001-values/quiz/key.json", { secret: "PRIVATE_KEY" });
  write(
    "002-borrow/lesson.html",
    lessonHtml(
      "Borrowing",
      "<h1>Borrowing</h1>" +
        quiz("pretest-1", "pretest") +
        '<template data-cl-after-pretest="pretest-1"><section id="teach-borrow">HIDDEN_TEACHING</section>' +
        quiz("check-2") +
        "</template>",
    ),
  );
  write("002-borrow/lesson.json", { title: "Borrowing", createdAt: 3, instructionalContract: 1 });
  write("002-borrow/quiz/plan.json", {
    version: 1,
    objectives: {
      ownership: {
        statement: "HIDDEN_OBJECTIVE: Predict a borrowing conflict before execution.",
        application: true,
      },
    },
    quizzes: {
      "pretest-1": {
        purpose: "prequestion",
        questions: {
          q1: {
            objective: "ownership",
            task: "prediction",
            support: "independent",
            teaching: "teach-borrow",
          },
        },
      },
      "check-2": {
        purpose: "assessment",
        questions: { q1: { objective: "ownership", task: "application", support: "independent" } },
      },
    },
  });
  write(
    "003-predictions/lesson.html",
    lessonHtml("Next questions", "<h1>Next questions</h1>" + quiz("predict-1", "pretest")),
  );
  write("003-predictions/lesson.json", {
    title: "Next questions",
    createdAt: 4,
    instructionalContract: 1,
  });
  write("003-predictions/quiz/plan.json", {
    version: 1,
    objectives: {
      ownership: {
        statement:
          "Predict how ownership and borrowing interact across several function boundaries, explaining each decision in a longer unfamiliar example without relying on names or on the order in which lessons were written. " +
          "A_long_unbroken_identifier_for_mobile_wrapping_".repeat(3),
        application: true,
      },
    },
    quizzes: {
      "predict-1": {
        purpose: "prequestion",
        questions: { q1: { objective: "ownership", task: "prediction", support: "independent" } },
      },
    },
  });
  write(
    "004-legacy/lesson.html",
    lessonHtml("Earlier notes", "<h1>Earlier notes</h1><p>Legacy lesson.</p>"),
  );
  write("005-review/lesson.html", lessonHtml("PRIVATE_REVIEW"));
  write("005-review/lesson.json", { kind: "review", title: "PRIVATE_REVIEW", createdAt: 5 });
  f.write(
    "empty/classroom.json",
    JSON.stringify({ title: "New classroom", emoji: "🌱", createdAt: 1 }),
  );
}

export function addCourseIntentions(f: Fixture): void {
  const missionFile = "course/MISSION.md";
  const mission =
    "# Mission: Build a dependable CLI\n\n## Why\n\nShip a small command-line tool my team can maintain.\n\n## Success looks like\n\n- Explain ownership when reviewing a change.\n- Choose safe borrowing when values cross function boundaries.\n\n## Constraints\n\nTwo short sessions each week.\n\n## Out of scope\n\nUnsafe Rust and async runtimes.\n\n";
  f.write(
    missionFile,
    mission +
      "```studens-course-map\n" +
      JSON.stringify(
        {
          version: 1,
          upcoming: [{ id: "safe-cli", statement: "Design ownership boundaries for a small CLI." }],
          connections: [
            {
              from: "@upcoming/safe-cli",
              to: "001-values/@objective/ownership",
              kind: "builds-on",
            },
            {
              from: "003-predictions/@objective/ownership",
              to: "001-values/@objective/ownership",
              kind: "related",
            },
            {
              from: "002-borrow/@objective/ownership",
              to: "@upcoming/safe-cli",
              kind: "builds-on",
            },
          ],
        },
        null,
        2,
      ) +
      "\n```\n",
  );
}
