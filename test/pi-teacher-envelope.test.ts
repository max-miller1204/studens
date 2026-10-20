import * as fs from "node:fs";
import * as path from "node:path";
import { expect, it, vi } from "vitest";
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { AssistantMessage, Tool, TranscriptContext, ToolCall } from "@earendil-works/pi-ai";
import {
  observePiTeacherRequest,
  piTeacherRequestPrompt,
  piTeacherResources,
  piTeacherTools,
} from "../src/pi-teacher.ts";
import { passageAnswerPlan } from "../src/passage-answer.ts";
import { parseModelPlan, planSchema } from "../src/teacher.ts";
import { simpleLessonOutput } from "./lesson-output-fixture.ts";
import { makeFixture } from "./helpers.ts";

it("sends the current canonical envelope and tool scope after lesson/refill history, including a dispute in the actual SDK", async () => {
  const f = makeFixture();
  const cwd = path.join(f.root, "rust"),
    agentDir = path.join(f.root, "agent");
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
  let session: AgentSession | undefined, unsubscribe: (() => void) | undefined;
  try {
    const { settings, loader } = piTeacherResources(cwd);
    await loader.reload();
    const runtime = await ModelRuntime.create({
      authPath: auth,
      modelsPath: path.join(agentDir, "models.json"),
    });
    vi.spyOn(runtime, "hasConfiguredAuth").mockResolvedValue(true);
    const manager = SessionManager.create(cwd, path.join(f.root, "sessions"));
    const file = manager.getSessionFile()!;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(manager.getHeader()) + "\n");
    let id: string | undefined;
    for (const phase of ["lesson", "ask", "follow-up", "refill", "chat", "dispute"] as const) {
      const schema: { properties: Record<string, unknown>; required: string[] } = planSchema(
        phase === "lesson"
          ? { operations: ["publish_lesson"], required: true, research: true }
          : phase === "ask" || phase === "follow-up"
            ? { operations: ["answer_lesson_question"], required: true, response: "passage-answer" }
            : phase === "refill"
              ? { operations: ["save_review_variants"], required: true }
              : phase === "dispute"
                ? { operations: ["resolve_grade_dispute"], required: true, messageRequired: true }
                : {
                    operations: ["record_retrieval_check"],
                    messageRequired: true,
                    notesAllowed: true,
                  },
      );
      const output: ToolCall["arguments"] =
        phase === "lesson"
          ? simpleLessonOutput
          : phase === "ask" || phase === "follow-up"
            ? {
                annotation_id: "exact-annotation",
                answer_markdown: 'Quoted "λ"\n\n```rust\nlet x = "🦀";\n```\nC:\\temp',
              }
            : phase === "refill"
              ? {
                  calls: [{ name: "save_review_variants", arguments_json: "{}" }],
                  message: "",
                  learning_record: null,
                  notes_markdown: "",
                }
              : phase === "dispute"
                ? {
                    calls: [{ name: "resolve_grade_dispute", arguments_json: "{}" }],
                    message: "Controlled dispute explanation.",
                    learning_record: null,
                    notes_markdown: "",
                  }
                : {
                    calls: [],
                    message: "A controlled prose-only reply.",
                    learning_record: null,
                    notes_markdown: "",
                  };
      const scope = new AbortController(),
        loadout = piTeacherTools(schema, phase === "lesson", scope.signal);
      const priorBytes = fs.readFileSync(file);
      ({ session } = await createAgentSession({
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
      }));
      if (id) expect(session.sessionId).toBe(id);
      id = session.sessionId;
      unsubscribe = observePiTeacherRequest(session, loadout, () => scope.abort());
      const payloads: TranscriptContext[] = [];
      let generated = 0;
      // Only the provider stream and account preflight are controlled. Tool
      // declaration serialization, AJV validation and history are the real SDK.
      session.agent.streamFunction = (model, context) => {
        payloads.push(structuredClone(context));
        const first = generated++ === 0;
        expect(generated).toBeLessThanOrEqual(2);
        const message: AssistantMessage = {
          role: "assistant",
          content: first
            ? [
                {
                  type: "toolCall",
                  id: phase + "-plan",
                  name: "submit_teacher_plan",
                  arguments: output,
                },
              ]
            : [{ type: "text", text: "Controlled fixture ended" }],
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
        const stream = createAssistantMessageEventStream();
        queueMicrotask(() => {
          stream.push({ type: "start", partial: message });
          stream.push({ type: "done", reason: message.stopReason as "toolUse" | "stop", message });
          stream.end();
        });
        return stream;
      };
      await session.prompt(
        piTeacherRequestPrompt("Controlled " + phase + " request", schema, phase === "lesson"),
      );
      expect(loadout.result()).toEqual(output);
      const active = new Map<string, Tool>();
      for (const message of payloads[0].messages) {
        if (message.role !== "system") continue;
        for (const tool of message.toolsRemoved ?? []) active.delete(tool.name);
        for (const tool of message.toolsAdded ?? []) active.set(tool.name, tool);
      }
      expect([...active.keys()].sort()).toEqual([...loadout.tools].sort());
      expect(active.get("submit_teacher_plan")!.parameters).toEqual(schema);
      const user = payloads[0].messages.filter((m) => m.role === "user").at(-1)!;
      const text =
        typeof user.content === "string"
          ? user.content
          : user.content
              .filter((c) => c.type === "text")
              .map((c) => c.text)
              .join("\n");
      if (phase === "lesson") expect(text).not.toContain(JSON.stringify(schema));
      else expect(text).toContain(JSON.stringify(schema));
      expect(fs.readFileSync(file).subarray(0, priorBytes.length)).toEqual(priorBytes);
      if (phase === "ask" || phase === "follow-up") {
        expect(schema.required).toEqual(["annotation_id", "answer_markdown"]);
        expect(passageAnswerPlan(loadout.result()).calls).toHaveLength(1);
        expect([...active.keys()]).toEqual(["submit_teacher_plan"]);
        expect(text).not.toContain("For public web research use read_lesson_source");
      }
      if (phase === "chat") {
        expect(schema.required).toEqual(["calls", "message", "learning_record", "notes_markdown"]);
        expect(schema.properties.calls).toEqual(expect.objectContaining({ minItems: 0 }));
        expect(parseModelPlan(output)).toEqual({ ...output, learning_record: "" });
        // The request clarification never supplies omitted fields for a model.
        expect(() => parseModelPlan({ calls: [] })).toThrow();
        const earlier = payloads[0].messages.filter((m) => m.role === "assistant");
        expect(
          earlier.some((m) =>
            m.content.some((c) => c.type === "toolCall" && "lesson_html" in c.arguments),
          ),
        ).toBe(true);
        expect(
          earlier.some((m) =>
            m.content.some((c) => c.type === "toolCall" && "calls" in c.arguments),
          ),
        ).toBe(true);
      }
      if (phase === "dispute") {
        expect(schema.required).toEqual(["calls", "message", "learning_record", "notes_markdown"]);
        expect(schema.properties.calls).toMatchObject({
          minItems: 1,
          maxItems: 1,
          items: { properties: { name: { enum: ["resolve_grade_dispute"] } } },
        });
        // The shared envelope advertises learning_record; dispute application rejects evidence writes.
        expect(output).toMatchObject({ learning_record: null });
        expect(schema.properties.notes_markdown).toEqual({ type: "string", enum: [""] });
        expect([...active.keys()]).toEqual(["submit_teacher_plan"]);
        expect(text).toContain(JSON.stringify(schema));
        expect(text).not.toContain("For public web research use read_lesson_source");
      }
      unsubscribe();
      unsubscribe = undefined;
      session.dispose();
      session = undefined;
    }
  } finally {
    unsubscribe?.();
    session?.dispose();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    f.cleanup();
  }
});
