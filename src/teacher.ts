/** Dedicated teachers return a plan. Only the classroom service applies it. */
import { spawn } from "node:child_process";
import { JsonObjectStream } from "./json-object-stream.ts";
import { claudeModels } from "./teacher-models.ts";
import type { ModelCatalog, ModelChoice } from "./teacher-models.ts";
import { TeacherDeadline } from "./teacher-deadline.ts";

export type Backend = "codex" | "claude" | "pi";
export interface TeacherIdentity {
  backend: Backend;
  sessionId?: string;
  requestedModel?: string | null;
  selectionRevision?: number;
  activeModel?: string;
  activeRequestedModel?: string | null;
  activeModelAt?: number;
}
export interface TeacherPlan {
  calls: Array<{ name: string; arguments_json: string }>;
  message: string;
  learning_record: string;
  notes_markdown: string;
}
export const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    calls: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: {
            type: "string",
            enum: [
              "answer_lesson_question",
              "grade_lesson_quiz",
              "grade_quiz_answers",
              "record_retrieval_check",
              "publish_review",
            ],
          },
          arguments_json: { type: "string" },
        },
        required: ["name", "arguments_json"],
      },
    },
    message: { type: "string" },
    learning_record: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          properties: { markdown: { type: "string", minLength: 1, pattern: "\\S" } },
          required: ["markdown"],
        },
      ],
    },
    notes_markdown: { type: "string" },
  },
  required: ["calls", "message", "learning_record", "notes_markdown"],
};
export type TeacherOperation = TeacherPlan["calls"][number]["name"];
export interface PlanContract {
  operations: TeacherOperation[];
  required?: boolean;
  messageRequired?: boolean;
  notesAllowed?: boolean;
}

/** Limit structured output to operations permitted by the current request. */
export function planSchema(contract: PlanContract) {
  const calls = PLAN_SCHEMA.properties.calls;
  return {
    ...PLAN_SCHEMA,
    properties: {
      ...PLAN_SCHEMA.properties,
      notes_markdown: contract.notesAllowed
        ? PLAN_SCHEMA.properties.notes_markdown
        : { type: "string", enum: [""] },
      message: contract.messageRequired
        ? { type: "string", minLength: 1, pattern: "\\S" }
        : PLAN_SCHEMA.properties.message,
      calls: {
        ...calls,
        minItems: contract.required ? 1 : 0,
        ...(contract.required
          ? { maxItems: 1 }
          : contract.operations.length
            ? {}
            : { maxItems: 0 }),
        items: {
          ...calls.items,
          properties: {
            ...calls.items.properties,
            name: contract.operations.length
              ? { type: "string", enum: contract.operations }
              : { type: "string" },
          },
        },
      },
    },
  };
}
export type RunTeacher = (
  identity: TeacherIdentity,
  prompt: string,
  cwd: string,
  saveIdentity: (sessionId: string) => void,
  signal: AbortSignal | undefined,
  contract: PlanContract,
  saveModelOutput?: (value: unknown) => void,
  saveActiveModel?: (model: string) => void,
) => Promise<TeacherPlan>;

export function parsePlan(value: unknown): TeacherPlan {
  if (!value || typeof value !== "object") throw new Error("Teacher returned no plan.");
  const p = value as TeacherPlan;
  if (
    !Array.isArray(p.calls) ||
    typeof p.message !== "string" ||
    typeof p.learning_record !== "string" ||
    typeof p.notes_markdown !== "string" ||
    p.calls.some((c) => !c || typeof c.name !== "string" || typeof c.arguments_json !== "string")
  ) {
    throw new Error("Teacher returned an invalid plan.");
  }
  return p;
}

/** Decode explicit absence without treating descriptive text as an absent record. */
export function parseModelPlan(value: unknown): TeacherPlan {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Teacher returned no plan.");
  const record = (value as Record<string, unknown>).learning_record;
  if (
    record !== null &&
    (!record ||
      typeof record !== "object" ||
      Array.isArray(record) ||
      Object.keys(record).length !== 1 ||
      !("markdown" in record) ||
      typeof record.markdown !== "string" ||
      !record.markdown.trim())
  )
    throw new Error("Teacher learning_record must be null or an object with nonblank markdown.");
  return parsePlan({ ...value, learning_record: record === null ? "" : record.markdown });
}

export const runTeacher: RunTeacher = async (
  identity,
  prompt,
  cwd,
  saveIdentity,
  signal,
  contract,
  saveModelOutput,
  saveActiveModel,
) => {
  const raw = await runStructured(
    identity,
    prompt,
    cwd,
    saveIdentity,
    planSchema(contract),
    signal,
    saveActiveModel,
  );
  saveModelOutput?.(raw);
  return parseModelPlan(raw);
};

/** Run a read-only model turn with a schema supplied by the caller. */
export async function runStructured(
  identity: TeacherIdentity,
  prompt: string,
  cwd: string,
  saveIdentity: (sessionId: string) => void,
  schema: Record<string, unknown>,
  signal?: AbortSignal,
  saveActiveModel?: (model: string) => void,
): Promise<unknown> {
  if (identity.backend === "pi") {
    const { runPi } = await import("./pi-teacher.ts");
    return runPi(identity, prompt, cwd, saveIdentity, schema, signal, saveActiveModel);
  }
  return identity.backend === "codex"
    ? runCodex(identity, prompt, cwd, saveIdentity, schema, signal, saveActiveModel)
    : runClaude(identity, prompt, cwd, saveIdentity, schema, signal, saveActiveModel);
}

async function runClaude(
  identity: TeacherIdentity,
  prompt: string,
  cwd: string,
  save: (id: string) => void,
  schema: Record<string, unknown>,
  signal?: AbortSignal,
  saveActiveModel?: (model: string) => void,
): Promise<unknown> {
  const catalog = await claudeModels(cwd);
  const model = identity.requestedModel ?? catalog.configuredModel;
  const expectedModel = catalog.models.find((m) => m.id === model)?.resolvedModel ?? model;
  const args = [
    "-p",
    "--model",
    model,
    "--output-format",
    "stream-json",
    "--verbose",
    "--json-schema",
    JSON.stringify(schema),
    "--tools",
    "",
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--permission-mode",
    "dontAsk",
  ];
  if (identity.sessionId) args.push("--resume", identity.sessionId);
  const child = spawn("claude", args, { cwd, stdio: ["pipe", "pipe", "pipe"], signal });
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-8000);
  });
  child.stdin.on("error", (err) => {
    child.kill();
  });
  child.stdin.end(prompt);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Claude teacher timed out after 180 seconds."));
    }, 180_000);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        if (code !== 0) throw new Error(`Claude teacher exited with ${code}: ${stderr}`);
        const events = stdout
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        const result = [...events].reverse().find((event) => event.type === "result");
        if (!result) throw new Error("Claude returned no result.");
        if (result.session_id) save(result.session_id);
        if (result.is_error)
          throw new Error(
            `Claude teacher failed: ${result.result ?? JSON.stringify(result.errors)}`,
          );
        const models = [
          ...new Set<string>(
            events
              .filter((event) => event.type === "assistant" && event.message?.model)
              .map((event) => event.message.model),
          ),
        ];
        if (!models.length) throw new Error("Claude did not report the answering model.");
        if (models.some((actual) => actual !== expectedModel))
          throw new Error(
            `Claude selected model ${model} resolved to ${models.join(", ")}, expected ${expectedModel}. Choose a model and retry explicitly.`,
          );
        saveActiveModel?.(models.join(", "));
        resolve(result.structured_output);
      } catch (err) {
        reject(err);
      }
    });
  });
}

async function runCodex(
  identity: TeacherIdentity,
  prompt: string,
  cwd: string,
  save: (id: string) => void,
  schema: Record<string, unknown>,
  signal?: AbortSignal,
  saveActiveModel?: (model: string) => void,
  catalogOnly = false,
): Promise<unknown> {
  const child = spawn("codex", ["app-server", "--stdio"], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    signal,
  });
  let seq = 0,
    stderr = "",
    finalText = "";
  let threadId: string | undefined, turnId: string | undefined, failure: Error | undefined;
  const pending = new Map<
    number,
    { method: string; resolve: (v: any) => void; reject: (err: Error) => void }
  >();
  let completedResolve: () => void, completedReject: (err: Error) => void;
  const completed = new Promise<void>((resolve, reject) => {
    completedResolve = resolve;
    completedReject = reject;
  });
  // Attach immediately. A process failure can precede turn/start.
  void completed.catch(() => {});
  function fail(err: Error) {
    failure ??= err;
    for (const waiter of pending.values()) waiter.reject(err);
    pending.clear();
    completedReject(err);
  }
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-8000);
  });
  child.on("error", fail);
  child.stdin.on("error", fail);
  child.on("close", (code) => fail(new Error(`Codex teacher exited with ${code}: ${stderr}`)));
  const deadline = new TeacherDeadline((err) => {
    fail(err);
    child.kill("SIGKILL");
  });
  const objects = new JsonObjectStream();
  child.stdout.setEncoding("utf8");
  function receive(value: unknown) {
    if (!value || typeof value !== "object" || !("id" in value || "method" in value))
      throw new Error("Invalid Codex RPC message.");
    const m = value as any;
    if (m.id !== undefined && !m.method) {
      const waiter = pending.get(m.id);
      pending.delete(m.id);
      if (waiter?.method === "thread/start" || waiter?.method === "thread/resume")
        threadId = m.result?.thread?.id;
      if (waiter?.method === "turn/start") turnId = m.result?.turn?.id;
      if (m.error) waiter?.reject(new Error(m.error.message));
      else waiter?.resolve(m.result);
    } else if (m.id !== undefined) {
      child.stdin.write(
        JSON.stringify({
          id: m.id,
          error: { code: -32601, message: "Dedicated teacher cannot use interactive tools." },
        }) + "\n",
      );
    } else if (m.params?.threadId === threadId && threadId !== undefined) {
      if (m.method === "model/rerouted" && turnId !== undefined && m.params.turnId === turnId) {
        fail(
          new Error(
            `Codex model ${m.params.fromModel} was rerouted to ${m.params.toModel}: ${m.params.reason}. Choose a model and retry explicitly.`,
          ),
        );
        child.kill();
        return;
      }
      if (m.method === "turn/started" && m.params.turn.id === turnId) {
        deadline.enter(`running turn ${turnId} in thread ${threadId}`);
      } else if (m.params.turnId === turnId && turnId !== undefined) {
        if (
          /^item\/(agentMessage\/delta|reasoning\/(textDelta|summaryTextDelta))$/.test(m.method) &&
          typeof m.params.delta === "string" &&
          m.params.delta.length > 0
        )
          deadline.progress(m.method);
        if (m.method === "item/completed" && m.params.item.type === "reasoning")
          deadline.progress("completed reasoning item");
        if (m.method === "item/completed" && m.params.item.type === "agentMessage") {
          deadline.progress("received agent message");
          if (m.params.item.phase !== "commentary") finalText = m.params.item.text;
        }
      }
      if (m.method !== "turn/completed" || m.params.turn.id !== turnId) return;
      if (m.params.turn.status !== "completed")
        completedReject(
          new Error(`Codex turn ${m.params.turn.status}: ${JSON.stringify(m.params.turn.error)}`),
        );
      else completedResolve();
    }
  }
  child.stdout.on("data", (chunk: string) => {
    if (failure) return;
    try {
      objects.push(chunk, receive);
    } catch (err) {
      fail(new Error(`Invalid Codex stdout: ${(err as Error).message}`, { cause: err }));
    }
  });
  child.stdout.on("end", () => {
    try {
      objects.finish();
    } catch (err) {
      fail(err as Error);
    }
  });
  function request(method: string, params: unknown): Promise<any> {
    if (failure) return Promise.reject(failure);
    deadline.enter(`waiting for ${method}`);
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { method, resolve, reject });
      child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }
  try {
    await request("initialize", { clientInfo: { name: "studens_teacher", version: "0.11.0" } });
    child.stdin.write('{"method":"initialized","params":{}}\n');
    const settings = await request("config/read", { includeLayers: false, cwd });
    let model = identity.requestedModel ?? settings.config?.model;
    if (catalogOnly || !model) {
      const models: ModelChoice[] = [];
      let cursor: string | null = null;
      const cursors = new Set<string>();
      let defaultModel: string | undefined;
      do {
        const page = await request("model/list", { includeHidden: true, cursor });
        if (!Array.isArray(page.data)) throw new Error("Codex returned no model catalog.");
        for (const entry of page.data) {
          if (typeof entry.model !== "string" || typeof entry.displayName !== "string")
            throw new Error("Codex returned an invalid model catalog entry.");
          models.push({ id: entry.model, label: entry.displayName });
          if (entry.isDefault) defaultModel = entry.model;
        }
        cursor = page.nextCursor;
        if (cursor && cursors.has(cursor))
          throw new Error("Codex model catalog repeated a pagination cursor.");
        if (cursor) cursors.add(cursor);
      } while (cursor);
      const configuredModel = settings.config?.model ?? defaultModel;
      if (!configuredModel) throw new Error("Codex did not report a configured default model.");
      if (!models.some((entry) => entry.id === configuredModel))
        models.push({ id: configuredModel, label: `${configuredModel} (configured)` });
      if (catalogOnly) return { models, configuredModel };
      model ??= configuredModel;
    }
    const config = {
      model,
      cwd,
      approvalPolicy: "never",
      sandbox: "read-only",
      config: { mcp_servers: {}, features: { shell_tool: false } },
    };
    const result = identity.sessionId
      ? await request("thread/resume", { ...config, threadId: identity.sessionId })
      : await request("thread/start", config);
    save(result.thread.id);
    if (typeof result.model !== "string" || result.model !== model)
      throw new Error(
        `Codex selected model ${model} resolved to ${result.model ?? "unknown"}. Choose a model and retry explicitly.`,
      );
    await request("turn/start", {
      threadId: result.thread.id,
      model,
      input: [{ type: "text", text: prompt }],
      outputSchema: schema,
    });
    deadline.enter(`running turn ${turnId} in thread ${threadId}`);
    await completed;
    if (failure) throw failure;
    let value: unknown;
    try {
      value = JSON.parse(finalText);
    } catch (err) {
      throw new Error(`Invalid Codex teacher plan JSON: ${(err as Error).message}`, { cause: err });
    }
    saveActiveModel?.(result.model);
    return value;
  } finally {
    deadline.stop();
    child.stdin.end();
    child.kill();
  }
}

/** Discover choices through the same installed/authenticated transport as inference. */
export async function teacherModels(backend: Backend, cwd: string): Promise<ModelCatalog> {
  if (backend === "pi") {
    const { piModels } = await import("./pi-teacher.ts");
    return piModels(cwd);
  }
  return backend === "claude"
    ? claudeModels(cwd)
    : ((await runCodex(
        { backend },
        "",
        cwd,
        () => {},
        {},
        undefined,
        undefined,
        true,
      )) as ModelCatalog);
}
