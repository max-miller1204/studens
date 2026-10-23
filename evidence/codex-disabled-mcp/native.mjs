import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import assert from 'node:assert/strict';
import {CODEX_TEACHER_ARGS,CODEX_TEACHER_FEATURES,runStructured} from '/home/maxmiller/.t3/worktrees/studens/t3-a5a0d94c/src/teacher.ts';
const evidence='/tmp/studens-codex-disabled-evidence';
const home=fs.mkdtempSync('/tmp/studens-disabled-native-');
const original=process.env.CODEX_HOME??path.join(os.homedir(),'.codex');
fs.copyFileSync(path.join(original,'auth.json'),path.join(home,'auth.json'));
fs.chmodSync(path.join(home,'auth.json'),0o600);
fs.writeFileSync(path.join(home,'config.toml'),`model="gpt-6-luna"\nmodel_reasoning_effort="low"\n[mcp_servers.disabled_one]\ncommand="must-not-run"\nenabled=false\n[mcp_servers.disabled_two]\ncommand="must-not-run-either"\nenabled=false\n`);
process.env.CODEX_HOME=home;
const raw=[];
let seq=0;
async function catalog(sessionId){
 const child=spawn('codex',CODEX_TEACHER_ARGS,{cwd:home,env:process.env});
 let stderr='';child.stderr.on('data',c=>stderr+=c);
 const pending=new Map();
 const closed=new Promise(resolve=>child.on('close',resolve));
 readline.createInterface({input:child.stdout}).on('line',line=>{const m=JSON.parse(line);raw.push(m);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}}});
 const request=(method,params)=>new Promise((resolve,reject)=>{const id=++seq;raw.push({direction:'request',id,method,params});pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
 const timer=setTimeout(()=>child.kill(),60000);
 try{
 await request('initialize',{clientInfo:{name:'studens_teacher',version:'0.12.0'}});
 child.stdin.write('{"method":"initialized","params":{}}\n');
 const config={model:'gpt-6-luna',cwd:home,approvalPolicy:'never',sandbox:'read-only',config:{mcp_servers:{disabled_one:{enabled:false},disabled_two:{enabled:false}},features:CODEX_TEACHER_FEATURES,web_search:'disabled'}};
 const result=await request(sessionId?'thread/resume':'thread/start',{...config,...(sessionId?{threadId:sessionId}:{})});
 const pages=[];let cursor=null;
 do{const page=await request('mcpServerStatus/list',{threadId:result.thread.id,detail:'full',limit:1,cursor});pages.push(page);cursor=page.nextCursor;}while(cursor);
 const rows=pages.flatMap(p=>p.data);
 assert.equal(rows.length,2);
 for(const s of rows){assert.equal(s.runtimeStatus,'disabled');assert.deepEqual(s.tools,{});assert.deepEqual(s.resources,[]);assert.deepEqual(s.resourceTemplates,[]);assert.equal(s.serverCapabilities,null);}
 fs.writeFileSync(path.join(evidence,sessionId?'native-resume.json':'native-start.json'),JSON.stringify(pages,null,2));
 return result.thread.id;
 }finally{clearTimeout(timer);child.stdin.end();child.kill();await closed;fs.appendFileSync(path.join(evidence,'native.stderr.log'),stderr);}
}
try{
 await catalog();
 const schema={type:'object',additionalProperties:false,properties:{ok:{type:'boolean'}},required:['ok']};
 let id;
 const result=await runStructured({backend:'codex',requestedModel:'gpt-6-luna'},'Return {"ok":true}.',home,value=>{id=value},schema);
 assert.deepEqual(result,{ok:true});
 const rollout=fs.readdirSync(path.join(home,'sessions'),{recursive:true}).find(x=>x.endsWith('.jsonl'));
 const originalRollout=fs.readFileSync(path.join(home,'sessions',rollout));
 fs.writeFileSync(path.join(evidence,'original-rollout.jsonl'),originalRollout);
 const copy=fs.mkdtempSync('/tmp/studens-disabled-resume-');
 try {
 for (const entry of ['auth.json','config.toml','sessions']) fs.cpSync(path.join(home,entry),path.join(copy,entry),{recursive:true});
 process.env.CODEX_HOME=copy;
 await catalog(id);
 assert.ok(fs.readFileSync(path.join(copy,'sessions',rollout)).subarray(0,originalRollout.length).equals(originalRollout));
 assert.deepEqual(fs.readFileSync(path.join(home,'sessions',rollout)),originalRollout);
 }finally{fs.rmSync(copy,{recursive:true,force:true});}
 fs.writeFileSync(path.join(evidence,'native-result.json'),JSON.stringify({version:'0.164.0',startAndResume:'disabled inventories accepted; no catalog turn/start',rolloutPrefixPreserved:true,realStructuredTurn:result},null,2));
 console.log('PASS native start, copied-rollout resume and real structured turn with two disabled MCP servers');
}finally{fs.writeFileSync(path.join(evidence,'native-rpc.json'),JSON.stringify(raw,null,2));fs.rmSync(home,{recursive:true,force:true});}
