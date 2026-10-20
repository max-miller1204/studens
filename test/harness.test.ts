import { describe, expect, it, vi } from "vitest";
import {
  harnessCommand,
  directedLessonMode,
  isPlaywrightLaunch,
  packagedPageChecks,
  useTestModel,
} from "../scripts/harness.ts";

describe("test model selection", () => {
  it("overrides inherited Claude settings for child teachers and restores them", () => {
    vi.stubEnv("ANTHROPIC_MODEL", "claude-opus-5-5");
    vi.stubEnv("CLAUDE_CODE_EFFORT_LEVEL", "high");
    const restore = useTestModel("claude");
    try {
      expect(process.env.ANTHROPIC_MODEL).toBe("claude-haiku-5-5");
      expect(process.env.CLAUDE_CODE_EFFORT_LEVEL).toBe("low");
    } finally {
      restore();
    }
    expect(process.env.ANTHROPIC_MODEL).toBe("claude-opus-5-5");
    expect(process.env.CLAUDE_CODE_EFFORT_LEVEL).toBe("high");
    vi.unstubAllEnvs();
  });

  it("pins the initiating commands without a fallback model", () => {
    const [, claude] = harnessCommand("claude", "test", []);
    expect(claude.slice(claude.indexOf("--model"), claude.indexOf("--effort") + 2)).toEqual([
      "--model",
      "claude-haiku-5-5",
      "--effort",
      "low",
    ]);
    expect(claude).not.toContain("--fallback-model");
    const [, codex] = harnessCommand("codex", "test", []);
    expect(codex.slice(codex.indexOf("--model"), codex.indexOf("--config") + 2)).toEqual([
      "--model",
      "gpt-6-luna",
      "--config",
      'model_reasoning_effort="low"',
    ]);
  });
});

const command = 'node "/plugin/scripts/check-lesson.ts" os 002-forks';
const receipt = {
  classroom: "os",
  lesson: "002-forks",
  htmlHash: "a".repeat(64),
  preflight: {
    version: 1,
    htmlFile: "lesson.html",
    inputHashes: {
      "lesson.html": "a".repeat(64),
      "lesson.json": null,
      "quiz/key.json": null,
      "quiz/plan.json": null,
    },
  },
  learnerStateChanged: false,
  initial: { quizzes: 1, contractErrors: 0, pageErrors: 0 },
  released: { quizzes: 2, contractErrors: 0, pageErrors: 0 },
};
function codex(output: unknown = receipt, executed = command, exit_code = 0): string {
  return JSON.stringify({
    type: "item.completed",
    item: {
      type: "command_execution",
      command: executed,
      exit_code,
      aggregated_output: typeof output === "string" ? output : JSON.stringify(output),
    },
  });
}

describe("packaged authoring check receipts", () => {
  it("accepts the observed Node type-stripping flag with the same bound receipt", () => {
    expect(
      packagedPageChecks(
        "codex",
        codex(
          receipt,
          "timeout 170 node --experimental-strip-types scripts/check-lesson.ts os 002-forks",
        ),
      ),
    ).toHaveLength(1);
    expect(
      packagedPageChecks(
        "codex",
        codex(receipt, "cat scripts/check-lesson.ts --experimental-strip-types"),
      ),
    ).toEqual([]);
  });
  it.each([
    "node --loader other.mjs /plugin/scripts/check-lesson.ts os 002-forks",
    "node --import other.mjs /plugin/scripts/check-lesson.ts os 002-forks",
    "node --eval 'node /plugin/scripts/check-lesson.ts os 002-forks'",
    "node -e 'node /plugin/scripts/check-lesson.ts os 002-forks'",
    "echo 'node /plugin/scripts/check-lesson.ts os 002-forks'",
    "echo 'pretend; node /plugin/scripts/check-lesson.ts os 002-forks'",
    'echo "pretend && node /plugin/scripts/check-lesson.ts os 002-forks"',
    "printf 'synthetic receipt' # pretend; node /plugin/scripts/check-lesson.ts os 002-forks",
    "cat <<'RECEIPT'\npretend; node /plugin/scripts/check-lesson.ts os 002-forks\nRECEIPT",
    "check() { node /plugin/scripts/check-lesson.ts os 002-forks; }; printf 'synthetic receipt'",
    "if false; then node /plugin/scripts/check-lesson.ts os 002-forks; fi",
    "false && node /plugin/scripts/check-lesson.ts os 002-forks; printf 'synthetic receipt'",
    "true || node /plugin/scripts/check-lesson.ts os 002-forks",
    "(node /plugin/scripts/check-lesson.ts os 002-forks)",
    "node /plugin/scripts/check-lesson.ts os 002-forks; printf 'synthetic receipt'",
    "cd /plugin '&&' node scripts/check-lesson.ts os 002-forks",
    "node '/plugin/scripts/check-lesson.ts''os' 002-forks",
    "node 'pretend; node /plugin/scripts/check-lesson.ts' os 002-forks",
    "/bin/bash -l 'node /plugin/scripts/check-lesson.ts os 002-forks'",
    "cat /plugin/scripts/check-lesson.ts",
  ])("rejects unrelated commands or semantic-changing flags: %s", (command) => {
    expect(packagedPageChecks("codex", codex(receipt, command))).toEqual([]);
  });
  it("recognizes the actual Codex shell wrapper", () => {
    expect(packagedPageChecks("codex", codex(receipt, `/bin/bash -lc '${command}'`))).toHaveLength(
      1,
    );
  });
  it("accepts a successful Codex execution", () => {
    expect(packagedPageChecks("codex", codex())).toEqual([
      {
        classroom: "os",
        lesson: "002-forks",
        htmlHash: receipt.htmlHash,
        preflight: receipt.preflight,
      },
    ]);
  });
  it.each([{ classroom: "other" }, { lesson: "003-pipes" }])(
    "rejects a complete receipt for a different invocation identity: %j",
    (changed) => {
      expect(packagedPageChecks("codex", codex({ ...receipt, ...changed }))).toEqual([]);
    },
  );
  it("recognizes shell-escaped program quotes", () => {
    expect(
      packagedPageChecks(
        "codex",
        codex(receipt, 'node \\"/plugin/scripts/check-lesson.ts\\" os 002-forks'),
      ),
    ).toHaveLength(1);
  });
  it("reads separate receipts from one command without changing JSON strings", () => {
    const second = {
      ...receipt,
      lesson: "003-pipes",
      initial: { ...receipt.initial, controls: ["a } { b"] },
    };
    const event = JSON.parse(codex());
    event.item.command = `${command}; node /plugin/scripts/check-lesson.ts os 003-pipes`;
    event.item.aggregated_output = JSON.stringify(receipt) + "\n" + JSON.stringify(second) + "\n";
    expect(packagedPageChecks("codex", JSON.stringify(event)).map((check) => check.lesson)).toEqual(
      ["002-forks", "003-pipes"],
    );
    event.item.aggregated_output = "=== { unclosed\n" + event.item.aggregated_output + "done";
    expect(packagedPageChecks("codex", JSON.stringify(event)).map((check) => check.lesson)).toEqual(
      ["002-forks", "003-pipes"],
    );
  });
  it("ignores a receipt cut off by tail", () => {
    const output = JSON.stringify(receipt, null, 2).split("\n").slice(3).join("\n");
    expect(packagedPageChecks("codex", codex(output))).toEqual([]);
  });
  it("matches Claude results to the script execution", () => {
    const events = [
      {
        type: "assistant",
        message: { content: [{ type: "tool_use", id: "check", name: "Bash", input: { command } }] },
      },
      {
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "other", content: JSON.stringify(receipt) },
            {
              type: "tool_result",
              tool_use_id: "check",
              content: [{ type: "text", text: JSON.stringify(receipt) }],
            },
          ],
        },
      },
    ]
      .map((event) => JSON.stringify(event))
      .join("\n");
    expect(packagedPageChecks("claude", events)).toHaveLength(1);
  });
  it("recognizes a relative path from the plugin directory", () => {
    expect(
      packagedPageChecks(
        "codex",
        codex(receipt, "cd /plugin && node scripts/check-lesson.ts os 002-forks"),
      ),
    ).toHaveLength(1);
  });
  it("does not count reading the checker as execution", () => {
    expect(
      packagedPageChecks("codex", codex(receipt, "cat /plugin/scripts/check-lesson.ts")),
    ).toEqual([]);
  });
  it("keeps a receipt when a command chained after the check fails", () => {
    const output = JSON.stringify(receipt, null, 2) + "\n(eval):1: == not found\n";
    expect(
      packagedPageChecks("codex", codex(output, `${command} | tail -30; echo ===`, 1)),
    ).toEqual([
      {
        classroom: "os",
        lesson: "002-forks",
        htmlHash: receipt.htmlHash,
        preflight: receipt.preflight,
      },
    ]);
  });
  it("keeps a receipt before an explicit later failure", () => {
    expect(packagedPageChecks("codex", codex(receipt, `${command}; false`, 1))).toHaveLength(1);
  });
  it("rejects a failed check that prints no receipt", () => {
    expect(packagedPageChecks("codex", codex("Error: Contract error", command, 1))).toEqual([]);
  });
  it.each([
    { ...receipt, learnerStateChanged: true },
    { ...receipt, htmlHash: undefined },
    { ...receipt, htmlHash: "not-a-hash" },
    { ...receipt, initial: { ...receipt.initial, contractErrors: 1 } },
    { ...receipt, released: { ...receipt.released, pageErrors: 1 } },
    { ...receipt, released: undefined },
    { ...receipt, preflight: undefined },
    { ...receipt, preflight: { ...receipt.preflight, version: 2 } },
    {
      ...receipt,
      preflight: {
        ...receipt.preflight,
        inputHashes: { ...receipt.preflight.inputHashes, "quiz/key.json": undefined },
      },
    },
    {
      ...receipt,
      preflight: {
        ...receipt.preflight,
        inputHashes: { ...receipt.preflight.inputHashes, "lesson.html": "b".repeat(64) },
      },
    },
  ])("rejects incomplete or unsafe checks", (invalid) => {
    expect(packagedPageChecks("codex", codex(invalid))).toEqual([]);
  });
});

describe("browser launch detection", () => {
  it.each([
    "playwright-cli --help open",
    "playwright-cli open --help",
    "/bin/bash -lc 'playwright-cli open --help'",
    "playwright-cli -s=lesson open -h && playwright-cli snapshot",
    "playwright-cli -h open",
    "playwright-cli -s=lesson --help open",
    "playwright-cli --help",
    "playwright-cli snapshot",
    "playwright-cli open --help",
    "playwright-cli -s=lesson open -h",
    "/bin/bash -lc 'playwright-cli -s=lesson open --help'",
    "playwright-cli open http://127.0.0.1:3000 --help",
  ])("does not treat help or inspection as a launch: %s", (command) => {
    expect(isPlaywrightLaunch(command)).toBe(false);
  });
  it.each([
    "playwright-cli open",
    "playwright-cli open --help && playwright-cli -s=lesson open http://127.0.0.1:3000 --config=/plugin/assets/playwright-headless.json",
    "playwright-cli -s=lesson open about:blank; playwright-cli open --help",
    "playwright-cli -s=lesson --raw open http://127.0.0.1:3000",
    "playwright-cli --help open && playwright-cli -s=lesson open http://127.0.0.1:3000 --config=/plugin/assets/playwright-headless.json",
  ])("recognizes actual launches: %s", (command) => {
    expect(isPlaywrightLaunch(command)).toBe(true);
  });
});

describe("directed lesson mode selection", () => {
  it.each([
    [{}, null],
    [{ STUDENS_VERIFY_CODE_LESSON: "1" }, "code"],
    [{ STUDENS_VERIFY_FADED: "1" }, "faded"],
    [{ STUDENS_VERIFY_STEPPER: "1" }, "stepper"],
  ])("preserves each independent mode and ordinary default", (env, expected) => {
    expect(directedLessonMode(env)).toBe(expected);
  });
  it.each([
    { STUDENS_VERIFY_CODE_LESSON: "1", STUDENS_VERIFY_FADED: "1" },
    { STUDENS_VERIFY_CODE_LESSON: "1", STUDENS_VERIFY_STEPPER: "1" },
    { STUDENS_VERIFY_FADED: "1", STUDENS_VERIFY_STEPPER: "1" },
    { STUDENS_VERIFY_CODE_LESSON: "1", STUDENS_VERIFY_FADED: "1", STUDENS_VERIFY_STEPPER: "1" },
  ])("rejects every conflicting selection", (env) => {
    expect(() => directedLessonMode(env)).toThrow("Select one directed authoring mode per run");
  });
});
