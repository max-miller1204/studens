/** Shared helpers for the scripts that drive a real Claude Code or Codex session. */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export type Harness = "claude" | "codex" | "pi";

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export const TEST_MODELS = {
  pi: { provider: "openai-codex", model: "gpt-6-luna", effort: "low" },
  claude: { model: "claude-haiku-5-5", effort: "low" },
  codex: { model: "gpt-6-luna", effort: "low" },
} as const;

/** Readiness belongs to the completed tool's run, never an earlier settlement. */
export function toolRunSettled(
  events: readonly { type?: string; toolName?: string }[],
  toolName: string,
): boolean {
  const tool = events.reduce(
    (last, event, index) =>
      event.type === "tool_execution_end" && event.toolName === toolName ? index : last,
    -1,
  );
  return tool >= 0 && events.slice(tool + 1).some((event) => event.type === "agent_settled");
}

/** Claude Code prefixes plugin MCP tools with this. Codex reports the bare name. */
export const CLAUDE_PREFIX = "mcp__plugin_studens_classroom__";

export function parseHarness(value: string | undefined, usage: string): Harness {
  if (value !== "claude" && value !== "codex" && value !== "pi") throw new Error(usage);
  return value;
}

/** A temporary CODEX_HOME with this checkout installed as a plugin. */
export function codexHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "studens-e2e-codex-"));
  const realHome = process.env["CODEX_HOME"] ?? path.join(os.homedir(), ".codex");
  fs.copyFileSync(path.join(realHome, "auth.json"), path.join(home, "auth.json"));
  fs.writeFileSync(
    path.join(home, "config.toml"),
    `model = "${TEST_MODELS.codex.model}"\nmodel_reasoning_effort = "${TEST_MODELS.codex.effort}"\n`,
  );
  // Exercise this checkout even when the public catalog pins an older release.
  // Keep the development catalog and package copy inside the disposable home.
  const marketplace = path.join(home, "test-marketplace");
  fs.mkdirSync(path.join(marketplace, ".agents/plugins"), { recursive: true });
  fs.cpSync(ROOT, path.join(marketplace, "studens"), {
    recursive: true,
    filter: (source) =>
      ![".git", "node_modules", ".playwright-cli", "reports"].includes(path.basename(source)),
  });
  const catalog = JSON.parse(
    fs.readFileSync(path.join(ROOT, ".agents/plugins/marketplace.json"), "utf8"),
  );
  catalog.plugins[0].source = { source: "local", path: "./studens" };
  fs.writeFileSync(
    path.join(marketplace, ".agents/plugins/marketplace.json"),
    JSON.stringify(catalog),
  );
  for (const args of [
    ["plugin", "marketplace", "add", marketplace],
    ["plugin", "add", "studens@studens"],
  ]) {
    const run = spawnSync("codex", args, { env: { ...process.env, CODEX_HOME: home } });
    if (run.status !== 0) throw new Error(`codex ${args.join(" ")} failed:\n${run.stderr}`);
  }
  // Codex filters MCP environment variables. Give this test plugin the same home.
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const manifest = path.join(
    home,
    "plugins/cache/studens/studens",
    version,
    ".codex-plugin/mcp.json",
  );
  const mcp = JSON.parse(fs.readFileSync(manifest, "utf8"));
  mcp.mcpServers.classroom.env = { ...mcp.mcpServers.classroom.env, CODEX_HOME: home };
  fs.writeFileSync(manifest, JSON.stringify(mcp, null, 2));
  return home;
}

/** Pin child sessions, service teachers, and evaluators. Restore the test process on cleanup. */
export function useTestModel(harness: Harness): () => void {
  const home = harness === "codex" ? codexHome() : null;
  let piHome: string | undefined;
  if (harness === "pi") {
    piHome = fs.mkdtempSync(path.join(os.tmpdir(), "studens-e2e-pi-agent-"));
    const original = process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi/agent");
    for (const file of ["auth.json", "models.json", "models-store.json"]) {
      const source = path.join(original, file);
      if (fs.existsSync(source)) {
        fs.copyFileSync(source, path.join(piHome, file));
        fs.chmodSync(path.join(piHome, file), 0o600);
      }
    }
    fs.writeFileSync(
      path.join(piHome, "settings.json"),
      JSON.stringify({
        defaultProvider: TEST_MODELS.pi.provider,
        defaultModel: TEST_MODELS.pi.model,
        defaultThinkingLevel: TEST_MODELS.pi.effort,
        retry: { enabled: false },
        compaction: { enabled: false },
      }),
      { mode: 0o600 },
    );
  }
  const pinned: NodeJS.ProcessEnv = home
    ? { CODEX_HOME: home }
    : piHome
      ? { PI_CODING_AGENT_DIR: piHome }
      : {
          ANTHROPIC_MODEL: TEST_MODELS.claude.model,
          CLAUDE_CODE_EFFORT_LEVEL: TEST_MODELS.claude.effort,
        };
  const previous = Object.fromEntries(Object.keys(pinned).map((key) => [key, process.env[key]]));
  Object.assign(process.env, pinned);
  console.log(
    `[test-model:${harness}] ${TEST_MODELS[harness].model} ${TEST_MODELS[harness].effort}`,
  );
  return () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (home) fs.rmSync(home, { recursive: true, force: true });
    if (piHome) fs.rmSync(piHome, { recursive: true, force: true });
  };
}

/**
 * The command that runs one non-interactive turn. `tools` are classroom tool names;
 * `extraTools` are Claude Code built-in tools to allow as well.
 */
export function harnessCommand(
  harness: Harness,
  prompt: string,
  tools: string[],
  extraTools: string[] = ["Read"],
): [string, string[]] {
  if (harness === "pi")
    return [
      "pi",
      [
        "--print",
        "--mode",
        "json",
        "--provider",
        TEST_MODELS.pi.provider,
        "--model",
        TEST_MODELS.pi.model,
        "--thinking",
        TEST_MODELS.pi.effort,
        "--no-session",
        "--no-extensions",
        "--no-skills",
        "--no-context-files",
        "--no-prompt-templates",
        "--no-themes",
        "--offline",
        "--extension",
        path.join(ROOT, "index.ts"),
        prompt,
      ],
    ];
  if (harness === "claude") {
    return [
      "claude",
      [
        "--plugin-dir",
        ROOT,
        "--add-dir",
        ROOT,
        "-p",
        prompt,
        "--output-format",
        "stream-json",
        "--verbose",
        "--model",
        TEST_MODELS.claude.model,
        "--effort",
        TEST_MODELS.claude.effort,
        "--allowedTools",
        [...tools.map((tool) => `${CLAUDE_PREFIX}${tool}`), ...extraTools].join(","),
      ],
    ];
  }
  // Reason: `codex exec` cannot prompt for MCP tool approval, and has no per-tool
  // allowlist. The run is confined to temporary directories and a fixed prompt.
  return [
    "codex",
    [
      "exec",
      "--json",
      "--model",
      TEST_MODELS.codex.model,
      "--config",
      `model_reasoning_effort="${TEST_MODELS.codex.effort}"`,
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      prompt,
    ],
  ];
}

/**
 * The classroom tool calls in a harness's JSON event stream, in order. Claude Code
 * emits `"name":"mcp__plugin_studens_classroom__<tool>"` on each tool use; Codex emits
 * `"server":"classroom","tool":"<tool>"` on each MCP call's start and end events.
 */
export function toolCalls(harness: Harness, events: string): string[] {
  const pattern =
    harness === "pi"
      ? /"toolName":"([a-z_]+)"/g
      : harness === "claude"
        ? new RegExp(`"name":"${CLAUDE_PREFIX}([a-z_]+)"`, "g")
        : /"server":"classroom","tool":"([a-z_]+)"[^\n]*?"status":"in_progress"/g;
  return [...events.matchAll(pattern)].map((match) => match[1]!);
}

/**
 * The browser commands an agent ran: `playwright-cli` shell commands, and calls to a
 * browser MCP tool. The authoring evaluation uses this to see whether the agent
 * opened its own pages.
 */
export function browserCommands(harness: Harness, events: string): string[] {
  const browserTool = /browser|chrome|playwright|preview/i;
  const commands: string[] = [];
  for (const line of events.split("\n").filter(Boolean)) {
    const event = JSON.parse(line);
    if (harness === "claude" && event.type === "assistant") {
      for (const block of event.message.content) {
        if (block.type !== "tool_use") continue;
        const command = typeof block.input?.command === "string" ? block.input.command : "";
        if (
          block.name === "Bash" &&
          (command.includes("playwright-cli") || command.includes("scripts/check-lesson.ts"))
        )
          commands.push(command);
        else if (browserTool.test(block.name)) commands.push(block.name);
      }
    }
    if (harness === "codex" && event.type === "item.completed") {
      const item = event.item ?? {};
      if (
        item.type === "command_execution" &&
        (String(item.command).includes("playwright-cli") ||
          String(item.command).includes("scripts/check-lesson.ts"))
      ) {
        commands.push(String(item.command));
      } else if (item.type === "mcp_tool_call" && browserTool.test(`${item.server} ${item.tool}`)) {
        commands.push(`${item.server}.${item.tool}`);
      }
    }
  }
  return commands;
}

/** Help on either side of open does not launch; inspect chained invocations separately. */
export function isPlaywrightLaunch(command: string): boolean {
  return [...command.matchAll(/\bplaywright-cli([^;&|\n]*)/g)].some((match) => {
    const invocation = match[1];
    if (/(?:^|\s)(?:--help|-h)(?=\s|["']|$)/.test(invocation)) return false;
    return /^(?:\s+-[^\s]+)*\s+open(?:\s|["']|$)/.test(invocation);
  });
}

/** Recognize successful packaged checks from their execution receipts. */
export interface PackagedPageCheck {
  classroom: string;
  lesson: string;
  htmlHash: string;
  preflight: {
    version: 1;
    htmlFile: string;
    inputHashes: Record<string, string | null>;
  };
}

export function packagedPageChecks(harness: Harness, events: string): PackagedPageCheck[] {
  const commands = new Map<string, string>();
  const checks: PackagedPageCheck[] = [];
  // A receipt proves its own result: check-lesson prints one only after the checks
  // finish, with error counts and the checked HTML hash. Read every complete JSON
  // object in the output. Other output, such as a failed command chained after the
  // check, does not hide a receipt.
  function receipts(output: string): unknown[] {
    const values: unknown[] = [];
    let start = -1,
      depth = 0,
      quoted = false,
      escaped = false;
    for (let i = 0; i < output.length; i++) {
      const char = output[i];
      if (start < 0) {
        if (char !== "{") continue;
        start = i;
      }
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === "{") depth++;
      else if (char === "}" && --depth === 0) {
        try {
          values.push(JSON.parse(output.slice(start, i + 1)));
        } catch {
          i = start;
        }
        start = -1;
      }
    }
    // An unclosed brace before a receipt must not hide it.
    return start >= 0 ? [...values, ...receipts(output.slice(start + 1))] : values;
  }
  function collect(command: string, output: string): void {
    if (
      !/\bnode\s+(?:\\?["'])?(?:[^\s"'\\]*\/)?scripts\/check-lesson\.ts(?:\\?["'])?\s/.test(command)
    )
      return;
    const parsed = receipts(output);
    for (const value of parsed) {
      const receipt = value as Record<string, any>;
      if (
        typeof receipt?.classroom === "string" &&
        typeof receipt.lesson === "string" &&
        typeof receipt.htmlHash === "string" &&
        /^[a-f0-9]{64}$/.test(receipt.htmlHash) &&
        receipt.preflight?.version === 1 &&
        typeof receipt.preflight.htmlFile === "string" &&
        receipt.preflight.inputHashes?.["lesson.html"] === receipt.htmlHash &&
        ["lesson.json", "quiz/key.json", "quiz/plan.json"].every(
          (name) =>
            receipt.preflight.inputHashes[name] === null ||
            (typeof receipt.preflight.inputHashes[name] === "string" &&
              /^[a-f0-9]{64}$/.test(receipt.preflight.inputHashes[name])),
        ) &&
        receipt.learnerStateChanged === false &&
        [receipt.initial, receipt.released].every(
          (phase) => phase?.quizzes > 0 && phase.contractErrors === 0 && phase.pageErrors === 0,
        )
      )
        checks.push({
          classroom: receipt.classroom,
          lesson: receipt.lesson,
          htmlHash: receipt.htmlHash,
          preflight: receipt.preflight,
        });
    }
  }
  for (const line of events.split("\n").filter(Boolean)) {
    const event = JSON.parse(line);
    if (harness === "codex" && event.type === "item.completed") {
      const item = event.item;
      if (item?.type === "command_execution") collect(item.command, item.aggregated_output);
    }
    if (harness === "claude" && event.type === "assistant") {
      for (const block of event.message.content) {
        if (block.type === "tool_use" && block.name === "Bash")
          commands.set(block.id, block.input.command);
      }
    }
    if (harness === "claude" && event.type === "user") {
      for (const block of event.message.content) {
        if (block.type !== "tool_result") continue;
        const output =
          typeof block.content === "string"
            ? block.content
            : block.content
                .filter((part: { type: string }) => part.type === "text")
                .map((part: { text: string }) => part.text)
                .join("\n");
        collect(commands.get(block.tool_use_id) ?? "", output);
      }
    }
  }
  return checks;
}

export async function until<T>(what: string, timeoutMs: number, probe: () => T | null): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = probe();
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** Read a JSON file that another process may still be writing. Null until it parses. */
export function readJsonWhenReady<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}
