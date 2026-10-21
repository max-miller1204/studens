/** Parallel arithmetic controls: valid structure cannot establish a correct key. */
import type { AuthoredContent } from "../src/authoring-evaluation.ts";

export function correctnessFixture(
  defect: "none" | "visible-key" | "variant-key",
): AuthoredContent {
  const question = (id: string, prompt: string) =>
    `<li class="cl-q" data-question-id="${id}" data-type="numeric"><p class="cl-q-prompt">${prompt}</p><input class="cl-number" type="number"></li>`;
  const entry = (expected: number) => ({
    points: 1,
    expected: { value: expected, tolerance: 0 },
    full: `The sum is ${expected}.`,
    partial: "0 otherwise",
  });
  return {
    objective: "Compute sums of two integers.",
    mode: "quiz",
    html: `<form class="cl-quiz" data-quiz-id="check"><ol class="cl-questions">${question("q1", "What is 2 + 3?")}</ol></form>`,
    rubric: JSON.stringify({
      check: {
        q1: {
          ...entry(defect === "visible-key" ? 6 : 5),
          variants: [
            {
              id: "v1",
              html: question("v1", "What is 4 + 3?"),
              rubric: entry(defect === "variant-key" ? 8 : 7),
            },
            { id: "v2", html: question("v2", "What is 6 + 2?"), rubric: entry(8) },
          ],
        },
      },
    }),
    plan: JSON.stringify({
      version: 1,
      objectives: { sum: { statement: "Compute sums of two integers.", application: false } },
      quizzes: {
        check: {
          purpose: "assessment",
          questions: {
            q1: {
              objective: "sum",
              task: "retrieval",
              support: "independent",
              variants: {
                v1: { objective: "original", task: "retrieval", support: "independent" },
                v2: { objective: "original", task: "retrieval", support: "independent" },
              },
            },
          },
        },
      },
    }),
  };
}
