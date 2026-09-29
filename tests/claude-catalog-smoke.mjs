// Operator-only fresh-state check. Use the isolated container upgrade smoke runner.
import {mkdir,writeFile} from 'node:fs/promises';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import assert from 'node:assert/strict';
import {claudeModelCatalog} from '/usr/local/lib/neural-labs/model-catalog.mjs';
const execute=promisify(execFile);
assert.equal(process.env.NEURAL_LABS_UPGRADE_PROBE,'synthetic','Use bin/openclaw-upgrade-smoke');
Object.assign(process.env,{HOME:'/tmp/fresh',OPENCLAW_HOME:'/tmp/fresh',OPENCLAW_STATE_DIR:'/tmp/fresh/.openclaw',OPENCLAW_CONFIG_PATH:'/tmp/fresh/.openclaw/openclaw.json'});
await mkdir('/tmp/fresh/.openclaw',{recursive:true});await mkdir('/tmp/fresh/workspace',{recursive:true});
await writeFile(process.env.OPENCLAW_CONFIG_PATH,JSON.stringify({logging:{consoleLevel:'error'},gateway:{mode:'local',bind:'loopback',port:18789,auth:{mode:'password',password:'synthetic-fresh-password'}},agents:{defaults:{model:{primary:'openai/gpt-6-astra'},heartbeat:{every:'0m'}},entries:{main:{workspace:'/tmp/fresh/workspace'},'nl-new':{workspace:'/tmp/fresh/workspace',agentDir:'/tmp/fresh/.openclaw/agents/nl-new/agent'}}},plugins:{load:{paths:['/usr/local/lib/neural-labs/claude-plugin']},entries:{codex:{enabled:true},'neural-labs-claude':{enabled:true},anthropic:{config:{sessionCatalog:{enabled:false}}}}},cron:{enabled:false}}));
async function cli(...args){return(await execute('openclaw',args,{timeout:120000,maxBuffer:2**23})).stdout;}
function json(s){return JSON.parse(s.slice(s.indexOf('{')));}
let logs='';let gateway=spawn('openclaw',['gateway','run','--port','18789'],{stdio:['ignore','pipe','pipe']});gateway.stdout.on('data',b=>logs+=b);gateway.stderr.on('data',b=>logs+=b);
try{let ready=false;for(let n=0;n<240;n++){try{if((await fetch('http://127.0.0.1:18789/healthz')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}assert.ok(ready,logs.slice(-3000));
const rpc=async(method,params)=>json(await cli('gateway','call',method,'--params',JSON.stringify(params),'--url','ws://127.0.0.1:18789','--password','synthetic-fresh-password','--json'));
const result=await claudeModelCatalog(rpc,'nl-new');console.log(JSON.stringify({phase:'fresh',count:result.models?.length,pending:result.pendingProviders,outcomes:result.providerOutcomes}));assert.ok(result.models?.some(r=>r.provider==='anthropic'));
const row=result.models.find(r=>r.provider==='anthropic'),ref=row.id.startsWith('anthropic/')?row.id:`anthropic/${row.id}`;
await cli('config','set','agents.entries.nl-new.models',JSON.stringify({[ref]:{agentRuntime:{id:'neural-labs-claude'}}}),'--strict-json');
const bound=await claudeModelCatalog(rpc,'nl-new');console.log(JSON.stringify({phase:'bound',count:bound.models?.length,pending:bound.pendingProviders}));assert.ok(bound.models?.some(r=>r.provider==='anthropic'));
gateway.kill('SIGTERM');await new Promise(resolve=>gateway.once('exit',resolve));
gateway=spawn('openclaw',['gateway','run','--port','18789'],{stdio:['ignore','pipe','pipe']});gateway.stdout.on('data',b=>logs+=b);gateway.stderr.on('data',b=>logs+=b);
ready=false;for(let n=0;n<240;n++){try{if((await fetch('http://127.0.0.1:18789/healthz')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}assert.ok(ready,logs.slice(-3000));
const cold=await claudeModelCatalog(rpc,'nl-new');console.log(JSON.stringify({phase:'restarted',count:cold.models?.length}));assert.ok(cold.models?.some(r=>r.provider==='anthropic'));
console.log('Fresh owner, configured owner and restarted Claude catalog discovery passed without credentials or network');
}finally{gateway.kill('SIGTERM');await new Promise(r=>{gateway.once('exit',r);setTimeout(()=>{gateway.kill('SIGKILL');r();},10000).unref();});}
