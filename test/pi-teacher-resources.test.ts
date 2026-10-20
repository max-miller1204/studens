import * as fs from "node:fs";
import * as path from "node:path";
import { expect, it, vi } from "vitest";
import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  SettingsManager,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { piTeacherResources, piTeacherTools } from "../src/pi-teacher.ts";
import { makeFixture } from "./helpers.ts";

it("isolates configured global/project packages and resources without losing Pi model settings", async () => {
  const f = makeFixture();
  const agentDir = path.join(f.root, "agent");
  const cwd = path.join(f.root, "rust");
  const global = f.write(
    "agent/settings.json",
    JSON.stringify({
      defaultProvider: "openai-codex",
      defaultModel: "global-model",
      defaultThinkingLevel: "high",
      packages: ["npm:studens-global-never-install@0.0.0"],
      extensions: ["./escape.ts"],
      skills: ["./skills"],
      prompts: ["./prompts"],
      themes: ["./themes"],
      defaultTools: ["bash"],
    }),
  );
  const project = f.write(
    "rust/.pi/settings.json",
    JSON.stringify({
      defaultModel: "gpt-6-luna",
      defaultThinkingLevel: "low",
      packages: ["npm:studens-project-never-install@0.0.0"],
      extensions: ["./escape.ts"],
      skills: ["./skills"],
      prompts: ["./prompts"],
      themes: ["./themes"],
    }),
  );
  const auth = f.write("agent/auth.json", "{}");
  const marker = path.join(f.root, "resource-escaped");
  for (const scope of ["agent", "rust/.pi"]) {
    f.write(
      `${scope}/escape.ts`,
      `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'escaped');`,
    );
    f.write(
      `${scope}/skills/sentinel/SKILL.md`,
      "---\nname: sentinel\ndescription: Must not load\n---\nResource sentinel",
    );
    f.write(`${scope}/prompts/sentinel.md`, "Prompt sentinel");
  }
  f.write("rust/AGENTS.md", "Context sentinel must not be inherited");
  const originals = [global, project, auth].map((file) => fs.readFileSync(file));
  const { DefaultPackageManager } = await import(
    new URL(
      "../node_modules/@earendil-works/pi-coding-agent/dist/core/package-manager.js",
      import.meta.url,
    ).href
  );
  const install = vi
    .spyOn(DefaultPackageManager.prototype, "installParsedSource")
    .mockImplementation(async () => {
      throw new Error("Blocked sentinel package install; no installer or network executed");
    });
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  // Exercise package resolution enabled; offline mode must not conceal discovery.
  vi.stubEnv("PI_OFFLINE", "0");
  let session: AgentSession | undefined;
  try {
    const source = SettingsManager.create(cwd, agentDir);
    for (const inherited of [source.getGlobalSettings(), source.getProjectSettings()]) {
      expect(inherited.packages).toHaveLength(1);
      const unsafe = new DefaultResourceLoader({
        cwd,
        agentDir,
        settingsManager: SettingsManager.inMemory(inherited),
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
      });
      await expect(unsafe.reload()).rejects.toThrow("Blocked sentinel package install");
      expect(install).toHaveBeenCalledTimes(1);
      install.mockClear();
    }
    const resources = piTeacherResources(cwd);
    await resources.loader.reload();
    expect(install).not.toHaveBeenCalled();
    expect(resources.settings.getDefaultProvider()).toBe("openai-codex");
    expect(resources.settings.getDefaultModel()).toBe("gpt-6-luna");
    expect(resources.settings.getDefaultThinkingLevel()).toBe("low");
    expect(resources.settings.getCacheWarmingMode()).toBe("off");
    expect(resources.loader.getExtensions().extensions).toEqual([]);
    expect(resources.loader.getSkills().skills).toEqual([]);
    expect(resources.loader.getPrompts().prompts).toEqual([]);
    expect(resources.loader.getThemes().themes).toEqual([]);
    expect(resources.loader.getAgentsFiles().agentsFiles).toEqual([]);
    const runtime = await ModelRuntime.create({
      authPath: auth,
      modelsPath: path.join(agentDir, "models.json"),
    });
    const manager = SessionManager.create(cwd, path.join(f.root, "sessions"));
    fs.mkdirSync(path.dirname(manager.getSessionFile()!), { recursive: true });
    fs.writeFileSync(manager.getSessionFile()!, JSON.stringify(manager.getHeader()) + "\n");
    const originalSession = fs.readFileSync(manager.getSessionFile()!);
    // Explicit authoring, disposal/error cleanup, and ordinary reopen share one session.
    for (const research of [true, false]) {
      const loadout = piTeacherTools({ type: "object", properties: {} }, research);
      ({ session } = await createAgentSession({
        cwd,
        agentDir,
        modelRuntime: runtime,
        model: runtime.getModel("openai-codex", "gpt-6-luna")!,
        thinkingLevel: "low",
        settingsManager: resources.settings,
        resourceLoader: resources.loader,
        sessionManager: SessionManager.open(
          manager.getSessionFile()!,
          path.dirname(manager.getSessionFile()!),
          cwd,
        ),
        tools: loadout.tools,
        customTools: loadout.customTools,
      }));
      expect(session.getActiveToolNames()).toEqual(
        research ? ["submit_teacher_plan", "read_lesson_source"] : ["submit_teacher_plan"],
      );
      expect(session.sessionId).toBe(manager.getSessionId());
      session.dispose();
    }
    const savedSession = fs.readFileSync(manager.getSessionFile()!);
    expect(savedSession.subarray(0, originalSession.length)).toEqual(originalSession);
    const entries = savedSession
      .toString()
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(entries.some((entry) => entry.type === "message")).toBe(false);
    if (!session) throw new Error("SDK scope construction did not run");
    expect(session.model?.provider).toBe("openai-codex");
    expect(session.model?.id).toBe("gpt-6-luna");
    expect(session.thinkingLevel).toBe("low");
    expect(install).not.toHaveBeenCalled();
    expect(fs.existsSync(marker)).toBe(false);
    for (const [i, file] of [global, project, auth].entries())
      expect(fs.readFileSync(file)).toEqual(originals[i]);
  } finally {
    session?.dispose();
    install.mockRestore();
    vi.unstubAllEnvs();
    f.cleanup();
  }
});

it("retains a research refusal and cannot accept a plan or implicitly retry in that request", async () => {
  const scoped = piTeacherTools({ type: "object", properties: {} }, true);
  const source = scoped.customTools.find((tool) => tool.name === "read_lesson_source")!;
  const plan = scoped.customTools.find((tool) => tool.name === "submit_teacher_plan")!;
  const call = (tool: typeof source, args: unknown) =>
    tool.execute("owned-probe", args, undefined, undefined, {} as any);
  await expect(call(source, { url: "http://127.0.0.1/private" })).rejects.toThrow(
    "private network",
  );
  await expect(call(plan, {})).rejects.toThrow("Pi lesson research failed");
  await expect(call(source, { url: "https://example.com" })).rejects.toThrow(
    "Pi lesson research failed",
  );
  expect(() => scoped.result()).toThrow("Retry explicitly");
  const ordinary = piTeacherTools({ type: "object", properties: {} });
  expect(ordinary.tools).toEqual(["submit_teacher_plan"]);
});

it("refuses plan output after the owning request or current SDK tool is interrupted", async () => {
  const owner = new AbortController();
  const scoped = piTeacherTools({ type: "object", properties: {} }, true, owner.signal);
  const plan = scoped.customTools.find((tool) => tool.name === "submit_teacher_plan")!;
  await plan.execute("plan", {}, undefined, undefined, {} as any);
  owner.abort();
  expect(() => scoped.result()).toThrow("interrupted");
  const tool = new AbortController();
  tool.abort();
  const next = piTeacherTools({ type: "object", properties: {} }, true);
  const reader = next.customTools.find((entry) => entry.name === "read_lesson_source")!;
  await expect(
    reader.execute(
      "source",
      { url: "http://127.0.0.1/private" },
      tool.signal,
      undefined,
      {} as any,
    ),
  ).rejects.toThrow("interrupted");
  expect(() => next.result()).toThrow("interrupted");
});
