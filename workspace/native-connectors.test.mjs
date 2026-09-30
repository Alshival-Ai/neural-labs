import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,mkdir,writeFile,readFile,symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepareConnectorHome } from './native/connector-home.mjs';
import { NativeTools } from './native/tools.mjs';

test('connector execution copies only provider credentials, never account conversation history',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'nl-connector-home-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const source=path.join(root,'source'),dest=path.join(root,'dest');await mkdir(path.join(source,'.codex'),{recursive:true});await writeFile(path.join(source,'.codex','auth.json'),'fixture-auth');await writeFile(path.join(source,'.codex','history.jsonl'),'another members private history');
 await prepareConnectorHome(source,dest,'codex');assert.equal(await readFile(path.join(dest,'.codex','auth.json'),'utf8'),'fixture-auth');await assert.rejects(readFile(path.join(dest,'.codex','history.jsonl')),/ENOENT/);
 const unsafe=path.join(root,'unsafe');await mkdir(path.join(unsafe,'.codex'),{recursive:true});await symlink(path.join(source,'.codex','auth.json'),path.join(unsafe,'.codex','auth.json'));
 await assert.rejects(prepareConnectorHome(unsafe,path.join(root,'dest2'),'codex'),/ELOOP/);
});
test('communication tools bind actor and reject sends after revocation or in read-only mode',async t=>{
 let call;let active=true;const requests=[];const tools=new NativeTools({origin:'http://127.0.0.1:8792',configuration:{},createApplication:(...args)=>{call=args[7];return {app(){},close:async()=>{}};},communications:async(actor,input)=>{requests.push({actor,input});return {ok:true};}});t.after(()=>tools.close());
 const session=await tools.mint({actor:'member',policy:{sandbox:'read-only'},revalidate:async()=>{if(!active)throw new Error('revoked');}});
 await call({action:'history'});assert.equal(requests[0].actor,'member');await assert.rejects(call({action:'send',input:{member:'other'}}),/Read-only/);active=false;await assert.rejects(call({action:'history'}),/revoked/);active=true;await session.release();await assert.rejects(call({action:'history'}),/unavailable/);
});

test('connector native turns are idempotent and bound to one member',async t=>{
 const {NativeRuntime}=await import('./native/runtime.mjs');const {NativeState}=await import('./native/state.mjs');
 const root=await mkdtemp(path.join(os.tmpdir(),'nl-connector-run-'));const state=new NativeState(':memory:');
 await mkdir(path.join(root,'state/accounts/account/.codex'),{recursive:true});await mkdir(path.join(root,'workspace'));
 await writeFile(path.join(root,'state/accounts/account/.codex/auth.json'),'fixture');
 let active=true,calls=0;const launches=[];
 const authority={actor:'member',actorRole:'user',connection:'account',binding:{owner:'account',provider:'codex',generation:1,method:'subscription'},scope:'team',model:'fixture',background:true,authorityGeneration:1,policy:{sandbox:'workspace-write',approval:'never'},connector:{grant:'grant',message:'message',channel:'sms',thread:'thread'}};
 const runtime=new NativeRuntime({stateRoot:path.join(root,'state'),workspaceRoot:path.join(root,'workspace'),state,
   authorize:async selection=>{assert.equal(selection.grant,'grant');if(!active)throw new Error('revoked');return authority;},
   launcher:async input=>{launches.push(input);return {spawn(){},exec(){}};},accounts:{status:async()=>({ready:true})},
   providers:{codex:async ctx=>{calls++;await ctx.onEvent('output',{text:'private reply'});return {status:'succeeded'};}}});
 t.after(async()=>{await runtime.close();await rm(root,{recursive:true,force:true});});runtime.turns.gated=false;
 const input={actor:'member',message:'message',grant:'grant',channel:'sms',text:'hello',subject:'',history:'[]'};
 const turn=await runtime.connectorRun(input);await runtime.turns.active.get(turn.turn)?.done;
 assert.deepEqual(runtime.connectorStatus({...input,turn:turn.turn}),{status:'succeeded',text:'private reply'});
 assert.deepEqual(await runtime.connectorRun(input),turn);assert.equal(calls,1);
 await assert.rejects(runtime.connectorRun({...input,actor:'another'}),/binding/);
 assert.throws(()=>runtime.connectorStatus({...input,actor:'another',turn:turn.turn}),/unavailable/);
 assert.ok(launches.every(l=>l.homeRoot===path.join(root,'state/connector-homes/message')));
 active=false;await assert.rejects(runtime.connectorRun(input),/revoked/);
});
test('light-context scheduled execution uses a fresh auth-only home and cleans it afterwards',async t=>{
 const {NativeRuntime}=await import('./native/runtime.mjs');const {NativeState}=await import('./native/state.mjs');
 const root=await mkdtemp(path.join(os.tmpdir(),'nl-light-run-'));const state=new NativeState(':memory:');
 const account=path.join(root,'state/accounts/account/.codex');await mkdir(account,{recursive:true});await mkdir(path.join(root,'workspace'));
 await writeFile(path.join(account,'auth.json'),'fixture');await writeFile(path.join(account,'history.jsonl'),'private history');
 const binding={owner:'account',provider:'codex',generation:1,method:'subscription'};
 const policy={sandbox:'workspace-write',approval:'on-request'};
 let isolated,explicit=false;
 const runtime=new NativeRuntime({stateRoot:path.join(root,'state'),workspaceRoot:path.join(root,'workspace'),state,
  authorize:async()=>({actor:'member',actorRole:'admin',connection:'account',binding,scope:'background',model:'fixture',background:true,authorityGeneration:1,policy}),
  launcher:async input=>{if(input.homeRoot.includes('/light-homes/'))isolated=input.homeRoot;return {spawn(){},exec(){}};},accounts:{status:async()=>({ready:true})},
  skills:{prepare:async input=>{explicit=input.explicitOnly;return {input:input.input,mounts:[],packages:[],release:async()=>{}};}},
  providers:{codex:async()=>{assert.equal(await readFile(path.join(isolated,'.codex/auth.json'),'utf8'),'fixture');await assert.rejects(readFile(path.join(isolated,'.codex/history.jsonl')),/ENOENT/);return {status:'succeeded'};}}});
 t.after(async()=>{await runtime.close();await rm(root,{recursive:true,force:true});});runtime.turns.gated=false;state.setMetadata('scheduling','enabled');
 state.putJob({id:'job',name:'Light',actor:'member',connection:binding,model:'fixture',enabled:true,executionPolicy:policy,missedRunPolicy:'skip',overlap:'forbid',schedule:{kind:'every',everyMs:1000,anchorMs:0},payload:{kind:'agentTurn',message:'$selected',lightContext:true}});
 const receipt=await runtime.scheduler.launch('job','every:1000');await runtime.scheduler.drain();
 assert.equal(state.db.prepare('SELECT status FROM occurrences WHERE id=?').get(receipt.id).status,'succeeded');assert.equal(explicit,true);
 await assert.rejects(readFile(path.join(isolated,'.codex/auth.json')),/ENOENT/);assert.equal(await readFile(path.join(account,'history.jsonl'),'utf8'),'private history');
});
