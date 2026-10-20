import * as fs from "node:fs";
import * as path from "node:path";
import { expect, it, vi } from "vitest";
import {
  type AgentSession,
  createAgentSession,
  DefaultResourceLoader,
  SettingsManager,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { piTeacherResources } from "../src/pi-teacher.ts";
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
    ({ session } = await createAgentSession({
      cwd,
      agentDir,
      modelRuntime: runtime,
      model: runtime.getModel("openai-codex", "gpt-6-luna")!,
      thinkingLevel: "low",
      settingsManager: resources.settings,
      resourceLoader: resources.loader,
      tools: ["submit_teacher_plan"],
      customTools: [
        {
          name: "submit_teacher_plan",
          label: "Submit plan",
          description: "Record structured output",
          parameters: { type: "object", properties: {} } as any,
          async execute() {
            throw new Error("No model/tool inference in this loading contract");
          },
        },
      ],
    }));
    expect(session.getActiveToolNames()).toEqual(["submit_teacher_plan"]);
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
