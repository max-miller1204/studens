import { expect, it } from "vitest";
import { toolRunSettled } from "../scripts/harness.ts";
const settled = { type: "agent_settled" };
const answer = { type: "tool_execution_end", toolName: "answer_lesson_question" };
it("requires settlement after the current answer tool even when an older run settles in its slice", () => {
  expect(toolRunSettled([settled, answer], answer.toolName)).toBe(false);
  expect(toolRunSettled([settled, answer, settled], answer.toolName)).toBe(true);
});
it("requires the named tool and waits for its most recent completion", () => {
  expect(toolRunSettled([settled], answer.toolName)).toBe(false);
  expect(toolRunSettled([answer, settled], "grade_lesson_quiz")).toBe(false);
  expect(toolRunSettled([answer, settled, answer], answer.toolName)).toBe(false);
  expect(toolRunSettled([answer, settled, answer, settled], answer.toolName)).toBe(true);
});
