// Operator-only test using synthetic state; never run on tenant volumes.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile), mode=process.env.PROBE_MODE;
assert.equal(process.env.NEURAL_LABS_UPGRADE_PROBE, 'synthetic', 'Use bin/openclaw-upgrade-smoke');
assert.ok(['seed','candidate','restore'].includes(mode));
Object.assign(process.env,{HOME:'/state',OPENCLAW_HOME:'/state',OPENCLAW_STATE_DIR:'/state/.openclaw',OPENCLAW_CONFIG_PATH:'/state/.openclaw/openclaw.json',CODEX_HOME:'/state/codex',NO_COLOR:'1'});
const root=process.env.OPENCLAW_STATE_DIR, config=process.env.OPENCLAW_CONFIG_PATH;
async function cli(...args){try{return (await execute('openclaw',args,{timeout:120000,maxBuffer:2**23})).stdout;}catch(e){throw new Error(`CLI ${args.slice(0,3).join(' ')}: ${e.stderr||e.stdout||e.message}`);}}
function json(text){return JSON.parse(text.slice(text.indexOf('{')));}
const auth=async id=>json(await cli('models','auth','list','--agent',id,'--provider','openai','--json'));
if(mode==='seed') {
 await mkdir(root,{recursive:true});
 await writeFile('/state/.neural-upgrade-probe','synthetic');
 await writeFile(config,JSON.stringify({logging:{consoleLevel:'error'},gateway:{mode:'local',bind:'loopback',port:18789,auth:{mode:'password',password:'synthetic-migration-password'}},agents:{defaults:{model:{primary:'openai/gpt-5.6-sol'},heartbeat:{every:'0m'}},list:['main','nl-alice','nl-bob'].map(id=>({id,workspace:'/state/workspace',agentDir:`${root}/agents/${id}/agent`}))},tools:{sessions:{visibility:'tree'},agentToAgent:{enabled:false},swarm:{enabled:false}},cron:{enabled:false}}));
 await mkdir('/state/workspace',{recursive:true});
 await writeFile('/state/workspace/migration-sentinel.txt','synthetic retained file');
 for(const id of ['main','nl-alice','nl-bob']) {
  const dir=`${root}/agents/${id}/agent`;await mkdir(dir,{recursive:true});
  await writeFile(`${dir}/auth-profiles.json`,JSON.stringify({version:1,profiles:{[`openai:${id}`]:{type:'oauth',provider:'openai',access:`synthetic-access-${id}`,refresh:`synthetic-refresh-${id}`,expires:Date.now()+7*86400000,accountId:`synthetic-${id}`}}}));
 }
 console.log('Migrating synthetic legacy credentials using public doctor');
 await cli('doctor','--fix','--non-interactive');
 for(const id of ['nl-alice','nl-bob']) await cli('models','auth','order','set','--agent',id,'--provider','openai',`openai:${id}`);
}
assert.equal(await readFile('/state/.neural-upgrade-probe','utf8'),'synthetic');
console.log((await cli('--version')).trim(),mode);
for(const id of ['nl-alice','nl-bob']) {
 const a=await auth(id);
 assert.ok(a.authStatePath.endsWith(`/agents/${id}/agent/openclaw-agent.sqlite`),JSON.stringify(a));
 assert.ok(a.profiles.some(p=>p.id===`openai:${id}`&&p.type==='oauth'));
 assert.ok(!a.profiles.some(p=>p.id===`openai:${id==='nl-alice'?'nl-bob':'nl-alice'}`));
 const order=json(await cli('models','auth','order','get','--agent',id,'--provider','openai','--json'));
 assert.deepEqual(order.order,[`openai:${id}`]);
}
let output='';
const gateway=spawn('openclaw',['gateway','run','--port','18789'],{stdio:['ignore','pipe','pipe']});
gateway.stdout.on('data',b=>output+=b);gateway.stderr.on('data',b=>output+=b);
try {
 let ready=false;
 for(let n=0;n<120;n++) {try{if((await fetch('http://127.0.0.1:18789/healthz')).ok){ready=true;break;}}catch{} await new Promise(r=>setTimeout(r,500));}
 assert.ok(ready,output.slice(-6000));
 const rpc=async(method,params={})=>json(await cli('gateway','call',method,'--params',JSON.stringify(params),'--url','ws://127.0.0.1:18789','--password','synthetic-migration-password','--json'));
 if(mode==='seed') {
  for(const id of ['nl-alice','nl-bob']){
   await rpc('sessions.create',{key:`agent:${id}:neura:upgrade`,agentId:id,label:`migration-${id}`,visibility:'draft'});
   await rpc('chat.inject',{sessionKey:`agent:${id}:neura:upgrade`,agentId:id,message:`retained-transcript-${id}`});
  }
  await rpc('cron.add',{name:'migration-disabled-job',agentId:'nl-alice',enabled:false,schedule:{kind:'every',everyMs:3600000},sessionTarget:'isolated',wakeMode:'next-heartbeat',payload:{kind:'agentTurn',message:'Synthetic task, must remain disabled'},delivery:{mode:'none'}});
 }
 for(const id of ['nl-alice','nl-bob']) {
  const h=await rpc('chat.history',{sessionKey:`agent:${id}:neura:upgrade`,agentId:id});
  assert.ok(JSON.stringify(h).includes(`retained-transcript-${id}`));
 }
 const jobs=await rpc('cron.list',{includeDisabled:true});
 assert.ok(jobs.jobs.some(j=>j.name==='migration-disabled-job'&&j.enabled===false));
 const invoke=async(tool,args={})=>{
  const r=await fetch('http://127.0.0.1:18789/tools/invoke',{method:'POST',headers:{Authorization:'Bearer synthetic-migration-password','Content-Type':'application/json'},body:JSON.stringify({tool,agentId:'nl-alice',sessionKey:'agent:nl-alice:neura:upgrade',args})});
  return {status:r.status,body:await r.json()};
 };
 const own=await invoke('sessions_history',{sessionKey:'agent:nl-alice:neura:upgrade'});
 assert.ok(JSON.stringify(own).includes('retained-transcript-nl-alice'),JSON.stringify(own));
 const other=await invoke('sessions_history',{sessionKey:'agent:nl-bob:neura:upgrade'});
 assert.ok(!JSON.stringify(other).includes('retained-transcript-nl-bob'));
 assert.match(JSON.stringify(other),/forbidden|restricted|denied|visibility|disabled/i);
 const list=await invoke('sessions_list');assert.ok(!JSON.stringify(list).includes('agent:nl-bob:neura:upgrade'));
 assert.equal((await fetch('http://127.0.0.1:18789/tools/invoke',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"tool":"sessions_list"}'})).status,401);
 assert.equal(await readFile('/state/workspace/migration-sentinel.txt','utf8'),'synthetic retained file');
 console.log('Owned credentials/order, transcripts, disabled schedule, files and cross-agent tool isolation passed');
 if(mode==='candidate') {
  await cli('agents','add','nl-new','--non-interactive','--workspace','/state/workspace','--json');
  const fresh=await auth('nl-new');assert.ok(!fresh.profiles.some(p=>p.id==='openai:nl-alice'||p.id==='openai:nl-bob'));
  await cli('models','auth','logout','openai:nl-alice','--agent','nl-alice','--yes');
  const disconnected=await auth('nl-alice');
  assert.ok(disconnected.authStatePath.endsWith('/agents/nl-alice/agent/openclaw-agent.sqlite'));
  assert.ok(!disconnected.profiles.some(p=>p.id==='openai:nl-alice'));
  assert.ok((await auth('nl-bob')).profiles.some(p=>p.id==='openai:nl-bob'));
  console.log('New agent does not acquire personal credentials; logout preserves the other owner');
 }
} finally {gateway.kill('SIGTERM');await new Promise(r=>{gateway.once('exit',r);setTimeout(()=>{gateway.kill('SIGKILL');r();},10000).unref();});}
