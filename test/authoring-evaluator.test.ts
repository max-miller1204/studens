import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { expect, it, vi } from "vitest";
import { evaluateContent } from "../scripts/authoring-evaluator.ts";
import { runTeacher } from "../src/teacher.ts";

vi.mock("../src/teacher.ts", () => ({ runTeacher: vi.fn() }));
const content = { objective: "Add", mode: "quiz" as const, html: "2+3", rubric: "5", plan: "sum" };

it("saves native model output before a malformed envelope rejects", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "studens-evaluator-raw-"));
  const file = path.join(root, "raw.json");
  const native = { calls: "malformed", message: "incomplete native envelope" };
  vi.mocked(runTeacher).mockImplementationOnce(
    async (_identity, _prompt, _cwd, _save, _signal, _contract, onRaw) => {
      onRaw!(native);
      throw new Error("Teacher returned an invalid plan.");
    },
  );
  try {
    await expect(evaluateContent("codex", root, content, file)).rejects.toThrow("invalid plan");
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(native);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it("keeps the native envelope when normalized judgments fail exact-source validation", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "studens-evaluator-raw-"));
  const file = path.join(root, "raw.json");
  const native = { calls: [], message: "[]", learning_record: null, notes_markdown: "" };
  vi.mocked(runTeacher).mockImplementationOnce(
    async (_identity, _prompt, _cwd, _save, _signal, _contract, onRaw) => {
      onRaw!(native);
      return { ...native, learning_record: "" };
    },
  );
  try {
    await expect(evaluateContent("codex", root, content, file)).rejects.toThrow("every criterion");
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(native);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
