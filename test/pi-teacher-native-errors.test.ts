import * as fs from "node:fs";
import * as path from "node:path";
import { expect, it, vi } from "vitest";
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { observePiTeacherRequest, piTeacherResources, piTeacherTools } from "../src/pi-teacher.ts";
import { makeFixture } from "./helpers.ts";

// Actual SDK agent loop, argument validator and session persistence. Only provider
// auth preflight and the assistant stream are controlled; no account/network use.
it.each(["invalid", "unknown"])(
  "rejects native %s errors before a later valid plan; explicit retry keeps the conversation",
  async (kind) => {
    const f = makeFixture();
    const cwd = path.join(f.root, "rust");
    const agentDir = path.join(f.root, "agent");
    fs.mkdirSync(cwd);
    f.write(
      "agent/settings.json",
      JSON.stringify({
        defaultProvider: "openai-codex",
        defaultModel: "gpt-6-luna",
        defaultThinkingLevel: "low",
      }),
    );
    const auth = f.write("agent/auth.json", "{}");
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    let session: AgentSession | undefined;
    let unsubscribe: (() => void) | undefined;
    try {
      const { settings, loader } = piTeacherResources(cwd);
      await loader.reload();
      const runtime = await ModelRuntime.create({
        authPath: auth,
        modelsPath: path.join(agentDir, "models.json"),
      });
      vi.spyOn(runtime, "hasConfiguredAuth").mockResolvedValue(true);
      const schema = {
        type: "object",
        additionalProperties: false,
        properties: { value: { type: "string" } },
        required: ["value"],
      };
      const manager = SessionManager.create(cwd, path.join(f.root, "sessions"));
      const file = manager.getSessionFile()!;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(manager.getHeader()) + "\n");
      const open = async (loadout: ReturnType<typeof piTeacherTools>) => {
        const result = await createAgentSession({
          cwd,
          agentDir,
          modelRuntime: runtime,
          model: runtime.getModel("openai-codex", "gpt-6-luna"),
          thinkingLevel: "low",
          settingsManager: settings,
          resourceLoader: loader,
          sessionManager: SessionManager.open(file, path.dirname(file), cwd),
          tools: loadout.tools,
          customTools: loadout.customTools,
        });
        return result.session;
      };
      const stream = (target: AgentSession, bad: boolean) => {
        let count = 0;
        target.agent.streamFunction = (model, _context, options) => {
          const first = count++ === 0;
          expect(count).toBeLessThanOrEqual(2);
          if (bad && !first) expect(options?.signal?.aborted).toBe(true);
          const message: AssistantMessage = {
            role: "assistant",
            content: first
              ? [
                  ...(bad
                    ? [
                        {
                          type: "toolCall" as const,
                          id: "bad",
                          name: kind === "unknown" ? "unregistered_tool" : "submit_teacher_plan",
                          arguments: { secret: "private-answer-sentinel" },
                        },
                      ]
                    : []),
                  {
                    type: "toolCall",
                    id: "valid",
                    name: "submit_teacher_plan",
                    arguments: { value: "valid" },
                  },
                ]
              : [{ type: "text", text: "Fixture finished" }],
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
            stopReason: first ? "toolUse" : "stop",
            timestamp: Date.now(),
          };
          const events = createAssistantMessageEventStream();
          queueMicrotask(() => {
            events.push({ type: "start", partial: message });
            events.push({
              type: "done",
              reason: message.stopReason as "toolUse" | "stop",
              message,
            });
            events.end();
          });
          return events;
        };
      };
      const scope = new AbortController();
      const first = piTeacherTools(schema, false, scope.signal);
      session = await open(first);
      const id = session.sessionId;
      const saved: unknown[] = [];
      unsubscribe = observePiTeacherRequest(
        session,
        first,
        () => scope.abort(),
        (raw) => saved.push(raw),
      );
      stream(session, true);
      await session.prompt("Controlled native validation fixture");
      const expected =
        kind === "invalid"
          ? /Validation failed.*submit_teacher_plan/s
          : /unregistered_tool not found/;
      expect(() => first.result()).toThrow(expected);
      expect(saved).toEqual(kind === "invalid" ? [{ secret: "private-answer-sentinel" }] : []);
      try {
        first.result();
      } catch (error) {
        expect(String(error)).not.toContain("private-answer-sentinel");
        expect(String(error)).not.toContain("Received arguments:");
      }
      expect(session.messages.some((m) => m.role === "toolResult" && m.isError)).toBe(true);
      expect(
        session.messages.some((m) => m.role === "toolResult" && m.toolCallId === "valid"),
      ).toBe(false);
      const failedBytes = fs.readFileSync(file, "utf8");
      expect(failedBytes).toContain("private-answer-sentinel");
      expect(failedBytes).toContain(kind === "invalid" ? "Validation failed" : "not found");
      unsubscribe();
      unsubscribe = undefined;
      session.dispose();
      session = undefined;

      // A new loadout is created only for an explicit request retry. The failed raw
      // message and native error remain in the exact same SDK session on disk.
      const retry = piTeacherTools(schema);
      session = await open(retry);
      expect(session.sessionId).toBe(id);
      unsubscribe = observePiTeacherRequest(
        session,
        retry,
        () => {},
        (raw) => saved.push(raw),
      );
      stream(session, false);
      await session.prompt("Explicit retry of the failed request");
      expect(retry.result()).toEqual({ value: "valid" });
      expect(fs.readFileSync(file, "utf8").startsWith(failedBytes)).toBe(true);
      expect(saved.at(-1)).toEqual({ value: "valid" });
    } finally {
      unsubscribe?.();
      session?.dispose();
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      f.cleanup();
    }
  },
);

it("keeps the original native error after cancellation and refuses later direct output", async () => {
  const scope = new AbortController();
  const loadout = piTeacherTools({ type: "object" }, false, scope.signal);
  const cause = new Error("Specific native validation cause");
  loadout.fail(cause);
  scope.abort(new Error("Secondary cancellation"));
  loadout.fail(new Error("Later failure"));
  expect(() => loadout.result()).toThrow(cause);
  await expect(
    loadout.customTools[0].execute(
      "later",
      {},
      undefined as any,
      undefined as any,
      undefined as any,
    ),
  ).rejects.toThrow();
  expect(() => loadout.result()).toThrow(cause);
});
