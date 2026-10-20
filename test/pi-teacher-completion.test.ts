import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { AssistantMessage, ToolCall } from "@earendil-works/pi-ai";
import { runPi } from "../src/pi-teacher.ts";
import { planSchema } from "../src/teacher.ts";
import { readLessonSource } from "../src/lesson-research.ts";
import { makeFixture } from "./helpers.ts";

// Keep the packaged session, tool wrapper, validator, loop, and production runPi
// deadline/observer. Only account discovery, provider output, and source I/O are controlled.
const fixture = vi.hoisted(() => ({
  attach: (_session: AgentSession) => {},
}));
vi.mock("@earendil-works/pi-coding-agent", async (original) => {
  const sdk = await original<typeof import("@earendil-works/pi-coding-agent")>();
  return {
    ...sdk,
    createAgentSession: async (...args: Parameters<typeof sdk.createAgentSession>) => {
      const result = await sdk.createAgentSession(...args);
      fixture.attach(result.session);
      return result;
    },
  };
});
vi.mock("../src/lesson-research.ts", () => ({ readLessonSource: vi.fn() }));

let f: ReturnType<typeof makeFixture>;
let requests: number;
let abortedRequests: boolean[];
let batches: ToolCall[][];
let raw: unknown[];
let onRecorded: (() => void) | undefined;
let identity: { backend: "pi"; sessionId?: string };
const ordinary = {
  calls: [],
  message: "The owner drops the value at the end of its scope.",
  learning_record: null,
  notes_markdown: "",
};
const schema = planSchema({ operations: ["record_retrieval_check"], messageRequired: true });
const plan = (args: unknown = ordinary, id = "plan"): ToolCall => ({
  type: "toolCall",
  id,
  name: "submit_teacher_plan",
  arguments: args as ToolCall["arguments"],
});

beforeEach(() => {
  f = makeFixture();
  const agentDir = path.join(f.root, "agent");
  f.write("agent/auth.json", "{}");
  f.write(
    "agent/settings.json",
    JSON.stringify({
      defaultProvider: "openai-codex",
      defaultModel: "gpt-6-luna",
      defaultThinkingLevel: "low",
    }),
  );
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  vi.spyOn(ModelRuntime.prototype, "hasConfiguredAuth").mockResolvedValue(true);
  vi.spyOn(ModelRuntime.prototype, "getAvailable").mockImplementation(async function (
    this: ModelRuntime,
  ) {
    return [this.getModel("openai-codex", "gpt-6-luna")!];
  });
  vi.mocked(readLessonSource).mockResolvedValue("Controlled public source text");
  requests = 0;
  abortedRequests = [];
  raw = [];
  batches = [[plan()]];
  onRecorded = undefined;
  identity = { backend: "pi" };
  fixture.attach = (session) => {
    session.subscribe((event) => {
      if (
        event.type === "tool_execution_end" &&
        event.toolName === "submit_teacher_plan" &&
        !event.isError
      )
        onRecorded?.();
    });
    session.agent.streamFunction = (model, _context, options) => {
      abortedRequests.push(options?.signal?.aborted === true);
      const content = batches[requests++] ?? [
        { type: "text" as const, text: "Unnecessary continuation" },
      ];
      expect(requests).toBeLessThanOrEqual(batches.length + 1);
      const message: AssistantMessage = {
        role: "assistant",
        content,
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: content.some((part) => part.type === "toolCall") ? "toolUse" : "stop",
        timestamp: Date.now(),
      };
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        stream.push({ type: "start", partial: message });
        stream.push({ type: "done", reason: message.stopReason as "toolUse" | "stop", message });
        stream.end();
      });
      return stream;
    };
  };
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  f.cleanup();
});
const run = (
  outputSchema: Record<string, unknown> = schema,
  signal?: AbortSignal,
  research = false,
) =>
  runPi(
    identity,
    "Controlled dedicated request",
    f.root,
    (id) => {
      identity.sessionId = id;
    },
    outputSchema,
    signal,
    undefined,
    research,
    (value) => raw.push(structuredClone(value)),
  );

it("completes one ordinary return without a second provider request", async () => {
  await expect(run()).resolves.toEqual(ordinary);
  expect(requests).toBe(1);
  expect(raw).toEqual([ordinary]);
});

it("completes generic typed data without changing its schema or values", async () => {
  const typed = { answer: { text: "A typed fixture answer", references: [2] } };
  batches = [[plan(typed)]];
  await expect(
    run({
      type: "object",
      additionalProperties: false,
      required: ["answer"],
      properties: {
        answer: {
          type: "object",
          additionalProperties: false,
          required: ["text", "references"],
          properties: {
            text: { type: "string" },
            references: { type: "array", items: { type: "integer" } },
          },
        },
      },
    }),
  ).resolves.toEqual(typed);
  expect(requests).toBe(1);
  expect(raw).toEqual([typed]);
});

it("continues research before the final return, then removes research on the next request", async () => {
  batches = [
    [
      {
        type: "toolCall",
        id: "source",
        name: "read_lesson_source",
        arguments: { url: "https://example.com" },
      },
    ],
    [plan()],
  ];
  await expect(run(schema, undefined, true)).resolves.toEqual(ordinary);
  expect(readLessonSource).toHaveBeenCalledOnce();
  expect(requests).toBe(2);
  const file = path.join(f.root, ".pi-teach-service/pi-sessions", identity.sessionId!);
  const prefix = fs.readFileSync(file);
  const id = identity.sessionId;
  batches.push([plan(ordinary, "next-request")]);
  await expect(run()).resolves.toEqual(ordinary);
  expect(requests).toBe(3);
  expect(identity.sessionId).toBe(id);
  expect(fs.readFileSync(file).subarray(0, prefix.length)).toEqual(prefix);
  const scopes = fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.customType === "studens_teacher_scope");
  expect(scopes.map((entry) => entry.data.tools)).toEqual([
    ["submit_teacher_plan", "read_lesson_source"],
    ["submit_teacher_plan"],
  ]);
});

it("rejects two plans already in the same assistant batch", async () => {
  batches = [[plan(), plan(ordinary, "duplicate")]];
  await expect(run()).rejects.toThrow("more than one teacher plan");
  expect(abortedRequests.slice(1).every(Boolean)).toBe(true);
  expect(raw).toEqual([ordinary, ordinary]);
});

it("saves invalid raw arguments before native validation and never continues", async () => {
  batches = [[plan({ private_invalid: "retained" })]];
  await expect(run()).rejects.toThrow("Validation failed");
  expect(abortedRequests.slice(1).every(Boolean)).toBe(true);
  expect(raw).toEqual([{ private_invalid: "retained" }]);
});

it("cannot hide a research error behind a later valid plan in the batch", async () => {
  vi.mocked(readLessonSource).mockRejectedValue(new Error("Specific source failure"));
  batches = [
    [
      {
        type: "toolCall",
        id: "source",
        name: "read_lesson_source",
        arguments: { url: "https://example.com" },
      },
      plan(),
    ],
  ];
  await expect(run(schema, undefined, true)).rejects.toThrow("Specific source failure");
  expect(abortedRequests.slice(1).every(Boolean)).toBe(true);
  expect(raw).toEqual([]);
});

it.each(["cancel", "timeout"])(
  "rejects %s even after a successful return was recorded",
  async (kind) => {
    const owner = new AbortController();
    if (kind === "timeout") vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    onRecorded = () => {
      if (kind === "cancel") owner.abort(new Error("Specific external cancellation"));
      else vi.advanceTimersByTime(180_000);
    };
    await expect(run(schema, owner.signal)).rejects.toThrow(
      kind === "cancel" ? "Specific external cancellation" : "timed out after 180 seconds",
    );
    expect(raw).toEqual([ordinary]);
    expect(requests).toBe(1);
  },
);
