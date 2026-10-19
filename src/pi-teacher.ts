/** A dedicated Pi conversation. The service alone applies the returned plan. */
import * as fs from "node:fs";
import * as path from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { privateStatePath, safeStaticFile } from "./paths.ts";
import type { ModelCatalog } from "./teacher-models.ts";
import type { TeacherIdentity } from "./teacher.ts";

async function configuration(cwd: string) {
  const source = SettingsManager.create(cwd, getAgentDir());
  const errors = source.drainErrors();
  if (errors.length)
    throw new Error(`Pi configuration: ${errors.map(({ error }) => error.message).join("; ")}`);
  const settings = SettingsManager.inMemory({
    ...source.getGlobalSettings(),
    ...source.getProjectSettings(),
    retry: { enabled: false, provider: { maxRetries: 0 } },
    compaction: { enabled: false },
  });
  const runtime = await ModelRuntime.create({
    authPath: path.join(getAgentDir(), "auth.json"),
    modelsPath: path.join(getAgentDir(), "models.json"),
  });
  const provider = settings.getDefaultProvider(),
    id = settings.getDefaultModel();
  if (!provider || !id)
    throw new Error(
      "Pi has no configured provider/model. Select one in Pi, then retry explicitly.",
    );
  return { runtime, settings, configuredModel: `${provider}/${id}` };
}
export async function piModels(cwd: string): Promise<ModelCatalog> {
  const { runtime, configuredModel } = await configuration(cwd);
  return {
    configuredModel,
    models: (await runtime.getAvailable()).map((model) => ({
      id: `${model.provider}/${model.id}`,
      label: `${model.name} (${model.provider}/${model.id})`,
    })),
  };
}

export async function runPi(
  identity: TeacherIdentity,
  prompt: string,
  cwd: string,
  save: (id: string) => void,
  schema: Record<string, unknown>,
  signal?: AbortSignal,
  active?: (model: string) => void,
): Promise<unknown> {
  const { runtime, settings, configuredModel } = await configuration(cwd);
  const selected = identity.requestedModel ?? configuredModel;
  const split = selected.indexOf("/");
  if (split < 1 || split === selected.length - 1)
    throw new Error(
      `Pi model ${selected} must be an exact provider/model ID. Choose a model and retry explicitly.`,
    );
  const model = runtime.getModel(selected.slice(0, split), selected.slice(split + 1));
  if (
    !model ||
    !(await runtime.getAvailable()).some((m) => m.provider === model.provider && m.id === model.id)
  )
    throw new Error(
      `Pi model ${selected} is unavailable in the configured account/provider catalog. Choose a model and retry explicitly.`,
    );
  const dir = privateStatePath(".pi-teach-service/pi-sessions");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  let manager: SessionManager;
  if (identity.sessionId) {
    if (
      !/^[a-zA-Z0-9_.-]+\.jsonl$/.test(identity.sessionId) ||
      !safeStaticFile(dir, identity.sessionId)
    )
      throw new Error(
        `Pi teacher session ${identity.sessionId} is missing or unsafe. Restore its saved session before retrying; do not replace the conversation.`,
      );
    manager = SessionManager.open(path.join(dir, identity.sessionId), dir, cwd);
  } else {
    manager = SessionManager.create(cwd, dir);
    // Pi normally delays disk creation until an assistant message. Reserve its header
    // before saving the identity so an interrupted first turn can reopen the same session.
    fs.writeFileSync(manager.getSessionFile()!, JSON.stringify(manager.getHeader()) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    manager = SessionManager.open(manager.getSessionFile()!, dir, cwd);
    save(path.basename(manager.getSessionFile()!));
  }
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: getAgentDir(),
    settingsManager: settings,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await loader.reload();
  let output: unknown;
  let count = 0;
  const { session, modelFallbackMessage } = await createAgentSession({
    cwd,
    agentDir: getAgentDir(),
    model,
    modelRuntime: runtime,
    thinkingLevel: settings.getDefaultThinkingLevel(),
    settingsManager: settings,
    sessionManager: manager,
    resourceLoader: loader,
    tools: ["submit_teacher_plan"],
    customTools: [
      {
        name: "submit_teacher_plan",
        label: "Submit Teacher Plan",
        description:
          "Return exactly one complete plan for the current request. This only records output; the service validates and applies it after the turn ends.",
        parameters: schema as any,
        async execute(_id, args) {
          if (++count !== 1)
            throw new Error("Pi returned more than one teacher plan. Retry explicitly.");
          output = args;
          return {
            content: [{ type: "text", text: "Plan recorded. End this turn." }],
            details: {},
          };
        },
      },
    ],
  });
  const abort = () => {
    void session.abort();
  };
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    abort();
  }, 180_000);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) throw new Error("Pi teacher request was interrupted. Retry explicitly.");
    if (
      modelFallbackMessage ||
      session.model?.provider !== model.provider ||
      session.model?.id !== model.id
    )
      throw new Error(
        `Pi did not select ${selected}: ${modelFallbackMessage ?? "unexpected model"}. Choose a model and retry explicitly.`,
      );
    await session.prompt(
      `${prompt}\n\nReturn your complete structured result by calling submit_teacher_plan exactly once. Do not answer the learner outside that plan. End your turn after the tool accepts it.`,
    );
    if (timedOut) throw new Error("Pi teacher timed out after 180 seconds. Retry explicitly.");
    if (signal?.aborted) throw new Error("Pi teacher request was interrupted. Retry explicitly.");
    const last = [...session.messages].reverse().find((m) => m.role === "assistant");
    if (last?.role === "assistant" && ["error", "aborted"].includes(last.stopReason))
      throw new Error(
        `Pi teacher failed: ${last.errorMessage ?? last.stopReason}. Retry explicitly.`,
      );
    if (count !== 1 || output === undefined)
      throw new Error("Pi teacher returned no structured plan. Retry explicitly.");
    // SDK selection only: this Pi provider does not independently report the
    // provider-resolved response model. Do not present it as that attestation.
    active?.(selected);
    return output;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    session.dispose();
  }
}
