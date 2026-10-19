/** Installed CLI transport contracts; these fixtures do not establish account access. */
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { makeFixture, type Fixture } from "./helpers.ts";
import { runStructured, teacherModels } from "../src/teacher.ts";
import { modelSelection } from "../src/teacher-models.ts";
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
  send({type:'result',session_id:'same-session',structured_output:{ok:true}});
 });
} else readline.createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);log(m);
 if(backend==='claude') {
  const response=m.request.subtype==='initialize'?{models:[{value:'default',resolvedModel:'configured-model',displayName:'Default'},{value:'quick',resolvedModel:'actual-quick',displayName:'Quick'}]}:{effective:{model:'configured-model'}};
  send({type:'control_response',response:{subtype:'success',request_id:m.request_id,response}});return;
 }
 if(!m.id)return;
 if(m.method==='initialize')send({id:m.id,result:{}});
 else if(m.method==='config/read')send({id:m.id,result:{config:{model:'configured-custom'}}});
 else if(m.method==='model/list')send({id:m.id,result:{data:[{id:'catalog-'+(m.params.cursor||'first'),model:'catalog-'+(m.params.cursor||'first'),displayName:'Catalog',isDefault:false}],nextCursor:m.params.cursor?null:'second'}});
 else if(m.method==='thread/start'||m.method==='thread/resume')send({id:m.id,result:{model:m.params.model,thread:{id:m.params.threadId||'same-thread'}}});
 else if(m.method==='turn/start') {
  if(m.params.model==='unavailable'){send({id:m.id,error:{message:'Model unavailable for this account.'}});return;}
  send({id:m.id,result:{turn:{id:'turn'}}});
  if(behavior.foreignReroute)send({method:'model/rerouted',params:{threadId:m.params.threadId,turnId:'stale-turn',fromModel:m.params.model,toModel:'other-model',reason:'unavailable'}});
  if(behavior.reroute)send({method:'model/rerouted',params:{threadId:m.params.threadId,turnId:'turn',fromModel:m.params.model,toModel:'other-model',reason:'unavailable'}});
  send({method:'item/completed',params:{threadId:m.params.threadId,turnId:'turn',item:{type:'agentMessage',text:'{"ok":true}'}}});
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
