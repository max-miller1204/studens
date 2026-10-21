import { refillOutputPlan, refillOutputSchema } from "../src/refill-output.ts";
/** Installed CLI transport contracts; these fixtures do not establish account access. */
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { makeFixture, type Fixture } from "./helpers.ts";
import { runStructured, teacherModels, runTeacher } from "../src/teacher.ts";
import { modelSelection } from "../src/teacher-models.ts";
import { simpleLessonOutput } from "./lesson-output-fixture.ts";
import { passageAnswerPlan, passageAnswerSchema } from "../src/passage-answer.ts";
import { lessonModelPlan } from "../src/lesson-output.ts";
import { disputeOutputPlan, disputeOutputSchema } from "../src/dispute-output.ts";
let f: Fixture;
let priorPath: string | undefined;
let priorModel: string | undefined;
beforeEach(() => {
  f = makeFixture();
  priorPath = process.env.PATH;
  priorModel = process.env.ANTHROPIC_MODEL;
  delete process.env.ANTHROPIC_MODEL;
  const script =
    `#!${process.execPath}\n` +
    String.raw`
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline');
const root=process.cwd(),backend=path.basename(process.argv[1]);
const log=m=>fs.appendFileSync(path.join(root,'rpc.jsonl'),JSON.stringify({backend,...m})+'\n');
const send=m=>process.stdout.write(JSON.stringify(m)+'\n');
const behavior=fs.existsSync(path.join(root,'behavior.json'))?JSON.parse(fs.readFileSync(path.join(root,'behavior.json'),'utf8')):{};
log({args:process.argv.slice(2)});
if(backend==='claude'&&!process.argv.includes('--input-format')) {
 let prompt='';process.stdin.on('data',c=>prompt+=c);process.stdin.on('end',()=>{
  const model=process.argv[process.argv.indexOf('--model')+1];
  if(model==='unavailable') {send({type:'result',is_error:true,result:'Model unavailable for this account.'});return;}
  const actual=behavior.reroute?'other-model':model==='quick'?'actual-quick':model;
  send({type:'assistant',message:{model:actual}});
  send({type:'result',session_id:'same-session',structured_output:behavior.output??{ok:true}});
 });
} else readline.createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);log(m);
 if(backend==='claude') {
  const response=m.request.subtype==='initialize'?{models:[{value:'default',resolvedModel:'configured-model',displayName:'Default'},{value:'quick',resolvedModel:'actual-quick',displayName:'Quick'}]}:{effective:{model:'configured-model'}};
  send({type:'control_response',response:{subtype:'success',request_id:m.request_id,response}});return;
 }
 if(!m.id)return;
 if(m.method==='initialize')send({id:m.id,result:{}});
 else if(m.method==='config/read')send({id:m.id,result:{config:{model:'configured-custom',mcp_servers:behavior.mcpServers??{}}}});
 else if(m.method==='mcpServerStatus/list')send({id:m.id,result:{data:behavior.exposeMcp?[{name:'unexpected-server'}]:behavior.invalidInventory?{}:[],nextCursor:behavior.repeatInventory?'again':null}});
 else if(m.method==='model/list')send({id:m.id,result:{data:[{id:'catalog-'+(m.params.cursor||'first'),model:'catalog-'+(m.params.cursor||'first'),displayName:'Catalog',isDefault:false}],nextCursor:m.params.cursor?null:'second'}});
 else if(m.method==='thread/start'||m.method==='thread/resume')send({id:m.id,result:{model:m.params.model,thread:{id:m.params.threadId||'same-thread'}}});
 else if(m.method==='turn/start') {
  if(m.params.model==='unavailable'){send({id:m.id,error:{message:'Model unavailable for this account.'}});return;}
  send({id:m.id,result:{turn:{id:'turn'}}});
  if(behavior.forbiddenTool)send({method:'item/started',params:{threadId:m.params.threadId,turnId:'turn',item:{type:behavior.forbiddenTool}}});
  if(behavior.foreignReroute)send({method:'model/rerouted',params:{threadId:m.params.threadId,turnId:'stale-turn',fromModel:m.params.model,toModel:'other-model',reason:'unavailable'}});
  if(behavior.reroute)send({method:'model/rerouted',params:{threadId:m.params.threadId,turnId:'turn',fromModel:m.params.model,toModel:'other-model',reason:'unavailable'}});
  send({method:'item/completed',params:{threadId:m.params.threadId,turnId:'turn',item:{type:'agentMessage',text:JSON.stringify(behavior.output??{ok:true})}}});
  send({method:'turn/completed',params:{threadId:m.params.threadId,turn:{id:'turn',status:'completed'}}});
 }
});
`;
  for (const backend of ["claude", "codex"]) {
    const file = f.write(`bin/${backend}`, script);
    fs.chmodSync(file, 0o700);
  }
  process.env.PATH = path.join(f.root, "bin") + ":" + priorPath;
});
afterEach(() => {
  process.env.PATH = priorPath;
  if (priorModel === undefined) delete process.env.ANTHROPIC_MODEL;
  else process.env.ANTHROPIC_MODEL = priorModel;
  f.cleanup();
});
function messages(): any[] {
  return fs
    .readFileSync(path.join(f.root, "rpc.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}
it.each(["codex", "claude"] as const)(
  "binds typed dispute output on %s and retains a rejected prefixed id",
  async (backend) => {
    const target = {
      id: "ed3084de-41f7-4725-b652-dc99f88150ac",
      questionId: "exact",
      machine: true,
    };
    const contract = {
      operations: ["resolve_grade_dispute"],
      required: true,
      response: "dispute-resolution" as const,
      disputeTarget: target,
    };
    const output = {
      dispute_id: target.id,
      decision: "declined",
      question: null,
      message: "The original answer does not match the fixed key.",
    };
    f.write("behavior.json", JSON.stringify({ output }));
    let sessionId: string | undefined;
    const save = (id: string) => {
      sessionId = id;
    };
    const identity = () => ({
      backend,
      sessionId,
      requestedModel: backend === "claude" ? "quick" : "custom-id",
    });
    expect(
      await runTeacher(identity(), "Resolve saved dispute", f.root, save, undefined, contract),
    ).toEqual(disputeOutputPlan(output, target));
    const wrong = { ...output, dispute_id: `dispute:${target.id}` };
    f.write("behavior.json", JSON.stringify({ output: wrong }));
    let raw: unknown;
    await expect(
      runTeacher(
        identity(),
        "Explicit next dispute",
        f.root,
        save,
        undefined,
        contract,
        (value) => {
          raw = value;
        },
      ),
    ).rejects.toThrow(/exact saved dispute id/);
    expect(raw).toEqual(wrong);
    if (backend === "codex")
      expect(
        messages()
          .filter((m) => m.method === "turn/start")
          .map((m) => m.params.outputSchema),
      ).toEqual([disputeOutputSchema(target), disputeOutputSchema(target)]);
    else
      for (const m of messages().filter((m) => m.args?.includes("--json-schema")))
        expect(JSON.parse(m.args[m.args.indexOf("--json-schema") + 1])).toEqual(
          disputeOutputSchema(target),
        );
  },
);
const schema = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false,
};
it("discovers all Codex pages, configured custom IDs and CLI Claude aliases without turns", async () => {
  const codex = await teacherModels("codex", f.root);
  expect(codex.configuredModel).toBe("configured-custom");
  expect(codex.models.map((model) => model.id)).toEqual([
    "catalog-first",
    "catalog-second",
    "configured-custom",
  ]);
  const claude = await teacherModels("claude", f.root);
  expect(claude.configuredModel).toBe("configured-model");
  expect(claude.models).toContainEqual({
    id: "quick",
    label: "Quick",
    resolvedModel: "actual-quick",
  });
  expect(
    messages()
      .filter((m) => m.method === "model/list")
      .map((m) => m.params),
  ).toEqual([
    { includeHidden: true, cursor: null },
    { includeHidden: true, cursor: "second" },
  ]);
  expect(messages().some((m) => m.method === "turn/start")).toBe(false);
});
it("passes the explicit Codex selection on start, resume and turn and resets to configured default", async () => {
  let session: string | undefined;
  const active: string[] = [];
  for (const requestedModel of ["custom-id", null])
    await expect(
      runStructured(
        { backend: "codex", sessionId: session, requestedModel },
        "Question",
        f.root,
        (id) => {
          session = id;
        },
        schema,
        undefined,
        (model) => active.push(model),
      ),
    ).resolves.toEqual({ ok: true });
  expect(active).toEqual(["custom-id", "configured-custom"]);
  expect(session).toBe("same-thread");
  expect(
    messages()
      .filter((m) => ["thread/start", "thread/resume", "turn/start"].includes(m.method))
      .map((m) => [m.method, m.params.model, m.params.threadId]),
  ).toEqual([
    ["thread/start", "custom-id", undefined],
    ["turn/start", "custom-id", "same-thread"],
    ["thread/resume", "configured-custom", "same-thread"],
    ["turn/start", "configured-custom", "same-thread"],
  ]);
});
it("passes --model on Claude resume and reports the actual assistant model, including alias resolution", async () => {
  const active: string[] = [];
  let session: string | undefined;
  for (const requestedModel of ["quick", null])
    await expect(
      runStructured(
        { backend: "claude", sessionId: session, requestedModel },
        "Question",
        f.root,
        (id) => {
          session = id;
        },
        schema,
        undefined,
        (model) => active.push(model),
      ),
    ).resolves.toEqual({ ok: true });
  expect(active).toEqual(["actual-quick", "configured-model"]);
  const turns = messages().filter((m) => m.args && !m.args.includes("--input-format"));
  expect(turns.map((m) => m.args[m.args.indexOf("--model") + 1])).toEqual([
    "quick",
    "configured-model",
  ]);
  expect(turns[1].args).toContain("--resume");
  expect(turns[1].args).toContain("same-session");
  expect(turns.some((m) => m.args.includes("--fallback-model"))).toBe(false);
});
it.each(["codex", "claude"] as const)(
  "fails %s unavailable selections and reroutes without a second turn or an invented active model",
  async (backend) => {
    let active = 0;
    await expect(
      runStructured(
        { backend, requestedModel: "unavailable" },
        "Question",
        f.root,
        () => {},
        schema,
        undefined,
        () => active++,
      ),
    ).rejects.toThrow(/unavailable/);
    expect(active).toBe(0);
    f.write("behavior.json", JSON.stringify({ reroute: true }));
    await expect(
      runStructured(
        { backend, requestedModel: backend === "claude" ? "quick" : "custom-id" },
        "Question",
        f.root,
        () => {},
        schema,
        undefined,
        () => active++,
      ),
    ).rejects.toThrow(/rerouted|resolved to/);
    expect(active).toBe(0);
    const all = messages();
    expect(
      backend === "codex"
        ? all.filter((m) => m.method === "turn/start").length
        : all.filter((m) => m.args && !m.args.includes("--input-format")).length,
    ).toBe(2);
  },
);
it("validates IDs while preserving provider-qualified custom names", () => {
  expect(modelSelection("provider/model:custom")).toBe("provider/model:custom");
  for (const value of [undefined, 7, "", " bad", "bad\nmodel", "x".repeat(201)])
    expect(() => modelSelection(value)).toThrow(/Model ID/);
});

it("ignores model reroutes from a stale turn in the same resumed thread", async () => {
  f.write("behavior.json", JSON.stringify({ foreignReroute: true }));
  let active: string | undefined;
  await expect(
    runStructured(
      { backend: "codex", sessionId: "same-thread", requestedModel: "custom-id" },
      "Question",
      f.root,
      () => {},
      schema,
      undefined,
      (model) => {
        active = model;
      },
    ),
  ).resolves.toEqual({ ok: true });
  expect(active).toBe("custom-id");
});

it.each(["codex", "claude"] as const)(
  "keeps %s model selection and active reporting while research is enabled for one explicit turn only",
  async (backend) => {
    let session: string | undefined;
    const active: string[] = [];
    for (const research of [true, false])
      await expect(
        runStructured(
          {
            backend,
            sessionId: session,
            requestedModel: backend === "claude" ? "quick" : "custom-id",
          },
          "Explicit lesson, then ordinary reply",
          f.root,
          (id) => {
            session = id;
          },
          schema,
          undefined,
          (model) => active.push(model),
          research,
        ),
      ).resolves.toEqual({ ok: true });
    expect(active).toEqual(
      backend === "claude" ? ["actual-quick", "actual-quick"] : ["custom-id", "custom-id"],
    );
    const all = messages();
    if (backend === "claude") {
      const turns = all.filter((m) => m.args && !m.args.includes("--input-format"));
      expect(turns.map((m) => m.args[m.args.indexOf("--tools") + 1])).toEqual([
        "WebSearch,WebFetch",
        "",
      ]);
      expect(turns[0].args.slice(turns[0].args.indexOf("--allowedTools") + 1)).toEqual([
        "WebSearch",
        "WebFetch",
      ]);
      expect(turns[1].args).not.toContain("--allowedTools");
      expect(turns[1].args).toContain(session);
    } else {
      const starts = all.filter((m) => ["thread/start", "thread/resume"].includes(m.method));
      expect(starts.map((m) => m.params.config.web_search)).toEqual(["live", "disabled"]);
      for (const start of starts) {
        expect(start.params.config.features.shell_tool).toBe(false);
        expect(start.params.config.mcp_servers).toEqual({});
        expect(start.params.sandbox).toBe("read-only");
        expect(start.params.model).toBe("custom-id");
      }
      expect(starts[1].params.threadId).toBe(session);
    }
  },
);

it.each(["codex", "claude"] as const)(
  "decodes the dedicated %s lesson response into a saved canonical call by code",
  async (backend) => {
    const output = simpleLessonOutput;
    f.write("behavior.json", JSON.stringify({ output }));
    let raw: unknown;
    const plan = await runTeacher(
      { backend, requestedModel: backend === "claude" ? "quick" : "custom-id" },
      "Explicit lesson",
      f.root,
      () => {},
      undefined,
      { operations: ["publish_lesson"], required: true, research: true },
      (value) => {
        raw = value;
      },
    );
    expect(raw).toEqual(output);
    expect(plan).toEqual(lessonModelPlan(output));
    const all = messages();
    const schema =
      backend === "codex"
        ? all.find((m) => m.method === "turn/start").params.outputSchema
        : JSON.parse(
            all.find((m) => m.args && !m.args.includes("--input-format")).args[
              all
                .find((m) => m.args && !m.args.includes("--input-format"))
                .args.indexOf("--json-schema") + 1
            ],
          );
    expect(schema.properties).toHaveProperty("lesson_html");
    expect(schema.properties).not.toHaveProperty("calls");
    expect(schema.additionalProperties).toBe(false);
  },
);

it("disables inherited MCP servers, installed plugins and connected apps before every Codex turn", async () => {
  f.write(
    "behavior.json",
    JSON.stringify({ mcpServers: { configured: { command: "must-not-run" } } }),
  );
  await runStructured(
    { backend: "codex", requestedModel: "custom-id" },
    "Return data",
    f.root,
    () => {},
    { type: "object" },
  );
  const all = messages(),
    start = all.find((m) => m.method === "thread/start");
  expect(start.params.config.mcp_servers).toEqual({ configured: { enabled: false } });
  for (const name of [
    "apps",
    "plugins",
    "remote_plugin",
    "shell_tool",
    "unified_exec",
    "multi_agent",
    "browser_use",
    "in_app_browser",
    "computer_use",
    "image_generation",
    "view_image",
    "skill_mcp_dependency_install",
  ]) {
    expect(start.params.config.features[name]).toBe(false);
    const args = all.find((m) => m.args?.[0] === "app-server").args;
    expect(args.some((arg: string, i: number) => arg === "--disable" && args[i + 1] === name)).toBe(
      true,
    );
  }
  expect(all.findIndex((m) => m.method === "mcpServerStatus/list")).toBeLessThan(
    all.findIndex((m) => m.method === "turn/start"),
  );
  expect(all.find((m) => m.method === "mcpServerStatus/list").params.threadId).toBe("same-thread");
});
it.each([
  [{ exposeMcp: true }, /still exposes MCP servers/],
  [{ invalidInventory: true }, /MCP inventory/],
  [{ repeatInventory: true }, /repeated a pagination cursor/],
  [{ mcpServers: [] }, /invalid MCP server configuration/],
])("refuses an unverified Codex tool scope before starting inference", async (behavior, error) => {
  f.write("behavior.json", JSON.stringify(behavior));
  await expect(
    runStructured(
      { backend: "codex", requestedModel: "custom-id" },
      "Return data",
      f.root,
      () => {},
      { type: "object" },
    ),
  ).rejects.toThrow(error);
  expect(messages().some((m) => m.method === "turn/start")).toBe(false);
});
it.each(["mcpToolCall", "commandExecution", "fileChange", "webSearch"])(
  "rejects a forbidden Codex execution notification: %s",
  async (type) => {
    f.write("behavior.json", JSON.stringify({ forbiddenTool: type }));
    await expect(
      runStructured(
        { backend: "codex", requestedModel: "custom-id" },
        "Return data",
        f.root,
        () => {},
        { type: "object" },
      ),
    ).rejects.toThrow(/attempted forbidden/);
  },
);
it("permits native Codex web research only on an explicit research turn", async () => {
  f.write("behavior.json", JSON.stringify({ forbiddenTool: "webSearch" }));
  await expect(
    runStructured(
      { backend: "codex", requestedModel: "custom-id" },
      "Read the requested public source",
      f.root,
      () => {},
      schema,
      undefined,
      undefined,
      true,
    ),
  ).resolves.toEqual({ ok: true });
  expect(messages().find((m) => m.method === "thread/start").params.config.web_search).toBe("live");
});

it("disables inherited MCP servers, plugins, shell and research on dedicated Codex dispute turns", async () => {
  f.write(
    "behavior.json",
    JSON.stringify({ mcpServers: { inherited: { command: "must-not-run" } } }),
  );
  await runStructured({ backend: "codex" }, "Resolve a grade dispute", f.root, () => {}, schema);
  expect(
    messages()
      .find((m) => m.backend === "codex" && m.args)
      .args.slice(0, 6),
  ).toEqual(["app-server", "--stdio", "--disable", "apps", "--disable", "plugins"]);
  const start = messages().find((m) => m.method === "thread/start");
  expect(start.params).toMatchObject({
    sandbox: "read-only",
    approvalPolicy: "never",
    config: {
      mcp_servers: { inherited: { enabled: false } },
      web_search: "disabled",
      features: { shell_tool: false, plugins: false, apps: false },
    },
  });
});

it.each(["codex", "claude"] as const)(
  "sends typed passage data through %s after lesson history and preserves rejected raw output",
  async (backend) => {
    let sessionId: string | undefined;
    const identity = () => ({
      backend,
      sessionId,
      requestedModel: backend === "claude" ? "quick" : "custom-id",
    });
    const save = (id: string) => {
      sessionId = id;
    };
    f.write("behavior.json", JSON.stringify({ output: simpleLessonOutput }));
    await runTeacher(identity(), "Explicit lesson", f.root, save, undefined, {
      operations: ["publish_lesson"],
      required: true,
      research: true,
    });
    const output = {
      annotation_id: "exact-owner",
      answer_markdown: '"λ"\n\n```rust\nlet café = "🦀";\n```\nC:\\notes\\',
    };
    const contract = {
      operations: ["answer_lesson_question"],
      required: true,
      response: "passage-answer" as const,
      passageAnnotationId: "exact-owner",
    };
    f.write("behavior.json", JSON.stringify({ output }));
    let raw: unknown;
    const plan = await runTeacher(
      identity(),
      "Ordinary passage",
      f.root,
      save,
      undefined,
      contract,
      (value) => {
        raw = value;
      },
    );
    expect(raw).toEqual(output);
    expect(plan).toEqual(passageAnswerPlan(output));
    const rejected = { ...output, calls: [] };
    f.write("behavior.json", JSON.stringify({ output: rejected }));
    await expect(
      runTeacher(identity(), "Explicit retry", f.root, save, undefined, contract, (value) => {
        raw = value;
      }),
    ).rejects.toThrow("only annotation_id and answer_markdown");
    expect(raw).toEqual(rejected);
    const all = messages();
    if (backend === "codex") {
      const turns = all.filter((m) => m.method === "turn/start");
      expect(turns.slice(1).map((m) => m.params.outputSchema)).toEqual([
        passageAnswerSchema("exact-owner"),
        passageAnswerSchema("exact-owner"),
      ]);
      const resumes = all.filter((m) => m.method === "thread/resume");
      expect(resumes).toHaveLength(2);
      for (const m of resumes) {
        expect(m.params.threadId).toBe(sessionId);
        expect(m.params.config.web_search).toBe("disabled");
        expect(m.params.sandbox).toBe("read-only");
      }
    } else {
      const turns = all.filter((m) => m.args && !m.args.includes("--input-format"));
      for (const turn of turns.slice(1)) {
        expect(JSON.parse(turn.args[turn.args.indexOf("--json-schema") + 1])).toEqual(
          passageAnswerSchema("exact-owner"),
        );
        expect(turn.args[turn.args.indexOf("--tools") + 1]).toBe("");
        expect(turn.args).toContain(sessionId);
      }
    }
  },
);

it.each(["codex", "claude"] as const)(
  "binds typed refill identity/count on %s and retains a rejected extra variant",
  async (backend) => {
    const target = { classroom: "rust", requestId: "refill:exact", count: 1 as const };
    const contract = {
      operations: ["save_review_variants"],
      response: "review-variants" as const,
      refillTarget: target,
      required: true,
    };
    const output = {
      classroom: "rust",
      request_id: target.requestId,
      variants: [
        {
          id: "v3",
          html: '<li class="cl-q">quoted "value"\n</li>',
          rubric: simpleLessonOutput.quizzes[0].questions[0].rubric,
          task: "application",
        },
      ],
    };
    f.write("behavior.json", JSON.stringify({ output }));
    const identity = { backend, requestedModel: backend === "claude" ? "quick" : "custom-id" };
    expect(
      await runTeacher(identity, "Saved refill", f.root, () => {}, undefined, contract),
    ).toEqual(refillOutputPlan(output, target));
    const wrong = {
      ...output,
      variants: [...output.variants, { ...output.variants[0], id: "v4" }],
    };
    f.write("behavior.json", JSON.stringify({ output: wrong }));
    let raw: unknown;
    await expect(
      runTeacher(
        identity,
        "Next refill",
        f.root,
        () => {},
        undefined,
        contract,
        (value) => {
          raw = value;
        },
      ),
    ).rejects.toThrow(/exactly 1/);
    expect(raw).toEqual(wrong);
    if (backend === "codex")
      expect(
        messages()
          .filter((m) => m.method === "turn/start")
          .map((m) => m.params.outputSchema),
      ).toEqual([refillOutputSchema(target), refillOutputSchema(target)]);
  },
);
