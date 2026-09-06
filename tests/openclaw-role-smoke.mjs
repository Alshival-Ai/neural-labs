// Operator-only, network-isolated test with synthetic proxy identities.
// Loopback proxy trust is enabled only inside this disposable test container.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {generateKeyPairSync,createHash,sign,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
const require=createRequire('/usr/local/lib/neural-labs/package.json');
const WebSocket=require('ws');
const {buildDeviceAuthPayloadV3}=await import(pathToFileURL(require.resolve('@openclaw/gateway-client')));
const {PROTOCOL_VERSION}=await import(pathToFileURL(require.resolve('@openclaw/gateway-protocol/version')));
const {gatewayIsolationOperations}=await import('/usr/local/lib/neural-labs/gateway-isolation.mjs');
const execute=promisify(execFile),root='/tmp/role-probe',scopes=['operator.read','operator.write','operator.approvals','operator.questions'];
Object.assign(process.env,{HOME:root,OPENCLAW_HOME:root,OPENCLAW_STATE_DIR:root+'/.openclaw',OPENCLAW_CONFIG_PATH:root+'/.openclaw/openclaw.json',CODEX_HOME:root+'/.codex',OPENCLAW_GATEWAY_PASSWORD:'synthetic-role-admin'});
await mkdir(process.env.OPENCLAW_STATE_DIR,{recursive:true});
const cfg={logging:{consoleLevel:'error'},gateway:{mode:'local',bind:'loopback',port:18789,trustedProxies:['127.0.0.1'],auth:{mode:'trusted-proxy',trustedProxy:{userHeader:'x-forwarded-user',requiredHeaders:['x-forwarded-proto'],allowLoopback:true,deviceAutoApprove:{enabled:true,scopes}}},controlUi:{allowedOrigins:['https://probe.example.com']},roles:{default:'unlinked',definitions:{unlinked:{agents:[],sessions:{others:'none'},scopes:[...scopes,'operator.admin']},alice:{agents:['nl-alice'],sessions:{others:'none'},scopes},bob:{agents:['nl-bob'],sessions:{others:'none'},scopes}}}},agents:{ownership:'explicit',defaults:{heartbeat:{every:'0m'}},list:[{id:'main',workspace:root+'/workspace'},{id:'nl-alice',workspace:root+'/workspace'},{id:'nl-bob',workspace:root+'/workspace'}]},cron:{enabled:false}};
for(const {path,value} of gatewayIsolationOperations()){const keys=path.split('.');let o=cfg;for(const k of keys.slice(0,-1))o=o[k]??={};o[keys.at(-1)]=value;}
await writeFile(process.env.OPENCLAW_CONFIG_PATH,JSON.stringify(cfg));
const admin=async(method,params={})=>{const {stdout}=await execute('openclaw',['gateway','call',method,'--params',JSON.stringify(params),'--url','ws://127.0.0.1:18789','--password','synthetic-role-admin','--json'],{timeout:30000,maxBuffer:2**22});return JSON.parse(stdout.slice(stdout.indexOf('{')));};
let logs='';const gateway=spawn('openclaw',['gateway','run','--port','18789'],{stdio:['ignore','pipe','pipe']});gateway.stdout.on('data',b=>logs+=b);gateway.stderr.on('data',b=>logs+=b);
const clients=[];
async function connect(user,{device=true}={}){
 const ws=new WebSocket('ws://127.0.0.1:18789',{headers:{origin:'https://probe.example.com','x-forwarded-for':'203.0.113.9','x-forwarded-proto':'https',...(user?{'x-forwarded-user':user}:{})}});clients.push(ws);
 const pending=new Map();let resolveChallenge;const challenge=new Promise(r=>resolveChallenge=r);
 ws.on('message',bytes=>{const event=JSON.parse(bytes);if(event.event==='connect.challenge')resolveChallenge(event.payload);if(event.type==='res'){pending.get(event.id)?.(event);pending.delete(event.id);}});
 const request=(method,params)=>new Promise((resolve,reject)=>{const id=randomUUID();const timeout=setTimeout(()=>reject(new Error('RPC timed out: '+method)),12000);pending.set(id,r=>{clearTimeout(timeout);resolve(r)});ws.send(JSON.stringify({type:'req',id,method,params}));});
 const c=await challenge;
 const client={id:'openclaw-control-ui',version:'1.0.0',platform:'web',mode:'webchat'};
 let identity;
 if(device){const pair=generateKeyPairSync('ed25519'),raw=pair.publicKey.export({format:'der',type:'spki'}).subarray(-32),id=createHash('sha256').update(raw).digest('hex'),signedAt=Date.now();identity={id,publicKey:raw.toString('base64url'),signature:sign(null,Buffer.from(buildDeviceAuthPayloadV3({deviceId:id,clientId:client.id,clientMode:client.mode,role:'operator',scopes,signedAtMs:signedAt,token:null,nonce:c.nonce,platform:client.platform})),pair.privateKey).toString('base64url'),signedAt,nonce:c.nonce};}
 const hello=await request('connect',{minProtocol:PROTOCOL_VERSION,maxProtocol:PROTOCOL_VERSION,client,role:'operator',scopes,...(identity?{device:identity}:{})});
 return {ws,hello,request};
}
try{
 let ready=false;for(let i=0;i<120;i++){try{if((await fetch('http://127.0.0.1:18789/healthz')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}assert.ok(ready,logs.slice(-3000));
 const anonymous=await connect();assert.equal(anonymous.hello.ok,false);anonymous.ws.close();
 const proxyOnly=await connect('alice',{device:false});assert.equal(proxyOnly.hello.ok,true);assert.equal((await proxyOnly.request('sessions.create',{agentId:'nl-alice',key:'agent:nl-alice:neura:unlinked'})).ok,false);proxyOnly.ws.close();
 for(const user of ['alice','bob']){const c=await connect(user);assert.equal(c.hello.ok,true,JSON.stringify(c.hello));c.ws.close();const profiles=await admin('users.list');const profile=profiles.profiles.find(p=>p.emails.includes(user));assert.ok(profile);await admin('users.setRole',{profileId:profile.id,role:user});}
 const alice=await connect('alice'),bob=await connect('bob');assert.equal(alice.hello.ok,true);assert.equal(bob.hello.ok,true);
 for(const [user,c] of [['alice',alice],['bob',bob]]){const r=await c.request('sessions.create',{agentId:'nl-'+user,key:`agent:nl-${user}:neura:role-probe`,visibility:'draft'});assert.equal(r.ok,true,JSON.stringify(r));}
 const crossed=await alice.request('chat.history',{agentId:'nl-bob',sessionKey:'agent:nl-bob:neura:role-probe'});assert.equal(crossed.ok,false,JSON.stringify(crossed));assert.match(JSON.stringify(crossed),/forbidden|denied|allowed|permission|not found/i);
 const own=await alice.request('chat.history',{agentId:'nl-alice',sessionKey:'agent:nl-alice:neura:role-probe'});assert.equal(own.ok,true,JSON.stringify(own));
 const profiles=await admin('users.list'),profile=profiles.profiles.find(p=>p.emails.includes('alice'));
 await admin('users.setRole',{profileId:profile.id,role:'unlinked'});
 const paused=await connect('alice');assert.equal(paused.hello.ok,true,JSON.stringify(paused.hello));
 const denied=await paused.request('chat.send',{agentId:'nl-alice',sessionKey:'agent:nl-alice:neura:role-probe',message:'This must be rejected before any run',idempotencyKey:randomUUID()});assert.equal(denied.ok,false,JSON.stringify(denied));assert.match(JSON.stringify(denied),/forbidden|denied|allowed|permission|not found/i);paused.ws.close();
 await admin('users.setRole',{profileId:profile.id,role:'alice'});const resumed=await connect('alice');assert.equal((await resumed.request('chat.history',{agentId:'nl-alice',sessionKey:'agent:nl-alice:neura:role-probe'})).ok,true);
 console.log('Anonymous access rejected; verified proxy identity remains role-scoped; owned history allowed; cross-user history denied; pause/resume enforced; admin access works');
}finally{clients.forEach(c=>c.terminate());gateway.kill('SIGTERM');setTimeout(()=>gateway.kill('SIGKILL'),5000).unref();}
