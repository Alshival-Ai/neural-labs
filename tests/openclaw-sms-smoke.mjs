// Operator-only test: install phase downloads the official package; verify phase
// runs without network using synthetic credentials and no outbound messages.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile),root='/state';
Object.assign(process.env,{HOME:root,OPENCLAW_HOME:root,OPENCLAW_STATE_DIR:root+'/.openclaw',OPENCLAW_CONFIG_PATH:root+'/.openclaw/openclaw.json',CODEX_HOME:root+'/.codex'});
assert.equal(process.env.NEURAL_LABS_UPGRADE_PROBE,'synthetic');
const release=JSON.parse(await readFile('/usr/local/lib/neural-labs/openclaw-release.json','utf8'));
const cli=async(...args)=>(await execute('openclaw',args,{timeout:120000,maxBuffer:2**22})).stdout;
if(process.env.PROBE_MODE==='install') {
 await mkdir(process.env.OPENCLAW_STATE_DIR,{recursive:true});
 await writeFile('/state/.neural-sms-probe','synthetic');
 await writeFile(process.env.OPENCLAW_CONFIG_PATH,JSON.stringify({logging:{consoleLevel:'error'},gateway:{mode:'local',bind:'loopback',auth:{mode:'password',password:'synthetic-sms-admin'}},agents:{defaults:{heartbeat:{every:'0m'}}},cron:{enabled:false}}));
 await cli('plugins','install',`@openclaw/sms@${release.version}`,'--pin','--force','--accept-capabilities');
 console.log('Official npm SMS installation completed');
 process.exit(0);
}
assert.equal(process.env.PROBE_MODE,'verify');
assert.equal(await readFile('/state/.neural-sms-probe','utf8'),'synthetic');
await cli('config','set','channels.sms',JSON.stringify({enabled:true,configWrites:false,accountSid:'AC00000000000000000000000000000000',authToken:'synthetic-sms-secret',fromNumber:'+15555550101',publicWebhookUrl:'https://probe.example.com/webhooks/twilio/sms',webhookPath:'/webhooks/twilio/sms',dangerouslyDisableSignatureValidation:false,dmPolicy:'allowlist',allowFrom:['+15555550102']}),'--strict-json');
let logs='';const gateway=spawn('openclaw',['gateway','run','--port','18789'],{stdio:['ignore','pipe','pipe']});gateway.stdout.on('data',b=>logs+=b);gateway.stderr.on('data',b=>logs+=b);
try {
 let status;
 for(let n=0;n<180;n++){
  try {const r=await fetch('http://127.0.0.1:18789/webhooks/twilio/sms',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','X-Twilio-Signature':'invalid-synthetic-signature'},body:new URLSearchParams({From:'+15555550102',To:'+15555550101',Body:'This must be rejected before dispatch',MessageSid:'SM00000000000000000000000000000000'})});status=r.status;await r.body?.cancel();if(status===403)break;}catch{}
  await new Promise(r=>setTimeout(r,500));
 }
 assert.equal(status,403,logs.slice(-4000));
 const stdout=await cli('plugins','list','--json'),listed=JSON.parse(stdout.slice(stdout.indexOf('{')));
 assert.ok(listed.plugins.some(p=>p.id==='sms'&&p.version===release.version&&p.origin==='global'));
 console.log('Official SMS plugin installed from pinned package; invalid signature rejected with HTTP 403; no outbound transport used');
} finally {gateway.kill('SIGTERM');setTimeout(()=>gateway.kill('SIGKILL'),5000).unref();}
