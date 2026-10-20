/** Controlled saved publication: independent gates, nested inert decoys and canonical labels. */
import type { Fixture } from "./helpers.ts";
import { lessonHtml, seedClassroom } from "./helpers.ts";
import * as store from "../src/store.ts";
import { applyGrade } from "../src/quiz-grading.ts";

export const templateLesson = "001-gates";
export const templateAnswers: store.QuizAnswer[] = [
  { questionId: "choice", type: "choice", value: "key-choice-a" },
  {
    questionId: "multi",
    type: "multi",
    parts: [
      { id: "key-multi-a", value: "First resource" },
      { id: "key-multi-b", value: "Second resource" },
    ],
  },
  {
    questionId: "order",
    type: "order",
    parts: [
      { id: "key-order-b", value: "Release" },
      { id: "key-order-a", value: "Allocate" },
    ],
  },
  {
    questionId: "match",
    type: "match",
    pairs: [
      {
        left: "key-left-a",
        right: "key-right-b",
        leftLabel: "Resource",
        rightLabel: "New binding",
      },
      { left: "key-left-b", right: "key-right-a", leftLabel: "Scope", rightLabel: "Lifetime" },
    ],
  },
  {
    questionId: "locate",
    type: "locate",
    parts: [{ id: "key-segment-b", value: "The released passage 日本語" }],
  },
  { questionId: "corrective", type: "numeric", value: "0" },
  { questionId: "locked", type: "numeric", value: "0" },
];
export const templateReadings = [
  "New owner — café λ",
  "First resource; Second resource",
  "1. Release\n2. Allocate",
  "Resource → New binding\nScope → Lifetime",
  "The released passage 日本語",
];
export function seedTemplateExport(f: Fixture): void {
  seedClassroom(f, {
    classroom: "gates",
    lesson: templateLesson,
    title: "Controlled export fixture",
  });
  const question = (id: string, type: string, prompt: string, controls: string) =>
    `<li class="cl-q" data-question-id="${id}" data-type="${type}"><p class="cl-q-prompt">${prompt}</p>${controls}</li>`;
  const numeric = (id: string, prompt: string) =>
    question(id, "numeric", prompt, '<input class="cl-number">');
  const diagnostic = (id: string) =>
    `<form class="cl-quiz" data-quiz-id="${id}" data-kind="pretest"><ol class="cl-questions">${numeric("d", `Predict ${id}`)}</ol></form>`;
  const check = `<form class="cl-quiz" data-quiz-id="check" data-title="Released assessment"><ol class="cl-questions">${[
    question(
      "choice",
      "choice",
      "Who releases the resource?",
      '<label><input type="radio" name="choice" value="key-choice-a">New owner — café λ</label><label><input type="radio" name="choice" value="key-choice-b">Old binding</label>',
    ),
    question(
      "multi",
      "multi",
      "Select both resources",
      '<label><input type="checkbox" value="key-multi-a">First resource</label><label><input type="checkbox" value="key-multi-b">Second resource</label>',
    ),
    question(
      "order",
      "order",
      "Arrange the saved steps",
      '<ol class="cl-order"><li data-item="key-order-a">Allocate</li><li data-item="key-order-b">Release</li></ol>',
    ),
    question(
      "match",
      "match",
      "Connect the public labels",
      '<ol class="cl-match-left"><li data-item="key-left-a">Resource</li><li data-item="key-left-b">Scope</li></ol><ol class="cl-match-right"><li data-item="key-right-a">Lifetime</li><li data-item="key-right-b">New binding</li></ol>',
    ),
    question(
      "locate",
      "locate",
      "Locate the released passage",
      '<div class="cl-q-stimulus"><p data-segment="key-segment-a">The other passage</p><p data-segment="key-segment-b">The released passage 日本語</p></div>',
    ),
    numeric("corrective", "Calculate the new case"),
    numeric("locked", "A still locked neighbor"),
  ].join("")}</ol></form>`;
  f.write(
    `gates/${templateLesson}/lesson.json`,
    JSON.stringify({ title: "Released template answers", assessmentContract: 1 }),
  );
  f.write(
    `gates/${templateLesson}/lesson.html`,
    lessonHtml(
      "Released template answers",
      `<h1>Controlled export fixture</h1><p>Saved publication, no model inference.</p>${diagnostic("before")}${diagnostic("later")}<template data-cl-after-pretest="before"><section><h2>Released teaching</h2><p>A resource moves to its new owner.</p><div>${check}</div><template><label><input value="key-choice-a">INERT_NESTED_CANARY</label><template>NESTED_PRIVATE_CANARY</template></template><div hidden>HIDDEN_RELEASED_CANARY</div></section></template><template data-cl-after-pretest="later"><h2>UNRELEASED_NEIGHBOR_CANARY</h2><p>UNRELEASED_KEY_CANARY</p></template><template>ARBITRARY_TEMPLATE_CANARY</template>`,
    )
      .replace("<main data-cl-content>", '<main class="cl-lesson-shell" data-cl-content>')
      .replace(
        "<head>",
        '<head><meta name="viewport" content="width=device-width, initial-scale=1">',
      ),
  );
  const entry = (expected: unknown, extra = {}) => ({
    expected,
    points: 1,
    full: "Use the original public labels.",
    partial: "No credit without the required relationship.",
    ...extra,
  });
  f.write(
    `gates/${templateLesson}/quiz/key.json`,
    JSON.stringify({
      before: { d: entry({ value: 2 }) },
      later: { d: entry({ value: 9 }) },
      check: {
        choice: entry("key-choice-a"),
        multi: entry(["key-multi-a", "key-multi-b"]),
        order: entry(["key-order-b", "key-order-a"]),
        match: entry({ "key-left-a": "key-right-b", "key-left-b": "key-right-a" }),
        locate: entry(["key-segment-b"], { grading: "exact" }),
        corrective: entry({ value: 29 }),
        locked: entry({ value: 731987654 }),
      },
      private: { expected: "PRIVATE_VARIANT_KEY_CANARY" },
    }),
  );
  f.write(
    "gates/.teacher.json",
    JSON.stringify({
      version: 1,
      identity: {
        backend: "codex",
        classroom: "gates",
        sessionId: "controlled-template-export",
        createdAt: 1,
      },
      requests: [],
      messages: [],
      updatedAt: 1,
    }),
  );
}
export function gradeTemplateQuiz(quizId: "before" | "later" | "check"): store.QuizSubmission {
  const s = store.createSubmission({
    classroom: "gates",
    lesson: templateLesson,
    quizId,
    quizTitle: quizId,
    kind: quizId === "check" ? "check" : "pretest",
    answers:
      quizId === "check" ? templateAnswers : [{ questionId: "d", type: "numeric", value: "2" }],
  });
  applyGrade(s, {
    score: quizId === "check" ? 71 : quizId === "before" ? 100 : 0,
    feedbackMarkdown: "Controlled saved grade.",
    questions: s.deterministicGrades!,
  });
  return s;
}
