import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {runStructured} from '/home/maxmiller/.t3/worktrees/studens/t3-a5a0d94c/src/teacher.ts';
const evidence='/tmp/studens-codex-disabled-evidence';
const home=fs.mkdtempSync('/tmp/studens-unsafe-native-');
const codex=spawnSync('which',['codex'],{encoding:'utf8'}).stdout.trim();
fs.copyFileSync(path.join(process.env.CODEX_HOME??path.join(os.homedir(),'.codex'),'auth.json'),path.join(home,'auth.json'));
fs.chmodSync(path.join(home,'auth.json'),0o600);
fs.writeFileSync(path.join(home,'config.toml'),'model="gpt-6-luna"\nmodel_reasoning_effort="low"\n[mcp_servers.disabled]\ncommand="must-not-run"\nenabled=false\n');
fs.mkdirSync(path.join(home,'bin'));
const wrapper=`#!${process.execPath}
const {spawn}=require('node:child_process'),fs=require('node:fs'),readline=require('node:readline');
const child=spawn(${JSON.stringify(codex)},process.argv.slice(2),{env:process.env});
fs.appendFileSync(process.env.PROBE_PIDS,String(child.pid)+'\\n');
const ids=new Set();
readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);fs.appendFileSync(process.env.PROBE_LOG,line+'\\n');if(m.method==='mcpServerStatus/list')ids.add(m.id);child.stdin.write(line+'\\n');}).on('close',()=>child.stdin.end());
readline.createInterface({input:child.stdout}).on('line',line=>{const m=JSON.parse(line);if(ids.has(m.id)&&m.result?.data?.length){const s=m.result.data[0];if(process.env.PROBE_STATE==='tools')s.tools={unexpected:{name:'unexpected'}};else s.runtimeStatus=process.env.PROBE_STATE==='null'?null:process.env.PROBE_STATE;}process.stdout.write(JSON.stringify(m)+'\\n');});
child.stderr.pipe(process.stderr);child.on('close',code=>process.exit(code??1));process.on('SIGTERM',()=>child.kill());
`;
fs.writeFileSync(path.join(home,'bin/codex'),wrapper,{mode:0o700});
process.env.PROBE_PIDS=path.join(evidence,'unsafe-pids');fs.writeFileSync(process.env.PROBE_PIDS,'');
process.env.CODEX_HOME=home;process.env.PATH=path.join(home,'bin')+':'+process.env.PATH;
const results=[];
try{for(const state of ['connected','null','tools']){
 process.env.PROBE_STATE=state;process.env.PROBE_LOG=path.join(evidence,'unsafe-'+state+'.jsonl');
 fs.writeFileSync(process.env.PROBE_LOG,'');
 let error;
 try{await runStructured({backend:'codex',requestedModel:'gpt-6-luna'},'Must not infer',home,()=>{},{type:'object'});}catch(e){error=e.message;}
 assert.match(error,/No model turn was started/);
 const requests=fs.readFileSync(process.env.PROBE_LOG,'utf8').trim().split('\n').map(JSON.parse);
 assert.ok(requests.some(m=>m.method==='mcpServerStatus/list'));
 assert.ok(!requests.some(m=>m.method==='turn/start'));
 results.push({state,error,turnStartCount:0});
}fs.writeFileSync(path.join(evidence,'unsafe-result.json'),JSON.stringify({method:'Real Codex 0.164.0 with only inventory response mutated at stdio boundary',results},null,2));console.log(JSON.stringify(results,null,2));
}finally{for (const pid of fs.readFileSync(process.env.PROBE_PIDS,'utf8').trim().split('\n').filter(Boolean).map(Number)){for(let i=0;i<200;i++){let alive;try{process.kill(pid,0);alive=true}catch{}if(!alive)break;await new Promise(r=>setTimeout(r,50));if(i===199)throw new Error('Owned Codex child did not exit: '+pid);}}fs.rmSync(home,{recursive:true,force:true});}
