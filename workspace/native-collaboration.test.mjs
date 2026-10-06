import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NativeRuntime, controlPlaneAuthority } from './native/runtime.mjs';
import { NativeState } from './native/state.mjs';

test('external sessions share native execution with isolated history, idempotency and scoped access', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(),'nl-collaboration-'));
  const state = new NativeState(':memory:');
  await mkdir(path.join(root,'accounts/account/.codex'),{recursive:true});
  await mkdir(path.join(root,'workspace'));
  await writeFile(path.join(root,'accounts/account/.codex/auth.json'),'fixture');
  const homes=[]; let enabled=true,calls=0;
  const grants = new Map();
  const grant = purpose => ({actor:'member',actorRole:'user',connection:'account',binding:{owner:'account',provider:'codex',generation:1,method:'subscription'},
    model:'fixture',scope:'personal',background:false,purpose,policy:{sandbox:'workspace-write',approval:'on-request'},
    collaboration:{name:'External fixture',lease:'secret-lease',principal:'external',session:'private-session',kind:'external-agent'}});
  for(const op of ['conversations.create','turns.start','events.read','turns.cancel','approvals.resolve']) grants.set(op,grant(op));
  const runtime = new NativeRuntime({stateRoot:root,workspaceRoot:path.join(root,'workspace'),state,
    authorize:async lease=>{ if(!enabled) throw new Error('revoked'); return grants.get(lease.grant); },
    launcher:async input=>{homes.push(input.homeRoot);return {spawn(){},exec(){}};}, accounts:{status:async()=>({ready:true})},
    providers:{codex:async ctx=>{calls++;await ctx.onEvent('output',{text:'private result'});return {status:'succeeded'};}}});
  t.after(async()=>{await runtime.close();await rm(root,{recursive:true,force:true});});runtime.turns.gated=false;
  const call=(operation,params={})=>runtime.handle({actor:'member',lease:{collaboration:true,grant:operation},operation,params});
  const created=await call('conversations.create');
  assert.equal(created.session.key,'private-session');
  assert.equal((await call('conversations.create')).session.key,'private-session');
  const params={conversation:'private-session',requestId:'request-1',input:[{type:'text',text:'inspect workspace'}]};
  const run=await call('turns.start',params);await runtime.turns.active.get(run.id)?.done;
  const replay=await call('turns.start',params);assert.equal(replay.id,run.id);assert.equal(calls,1);
  await assert.rejects(call('turns.start',{...params,input:[{type:'text',text:'different command'}]}),/request|conflict/i);
  assert.ok(homes.every(home=>home===path.join(root,'collaboration-homes/private-session')));
  const events=await call('events.read',{conversation:'private-session'});
  assert.ok(events.events.some(e=>e.type==='collaboration-participant'));
  assert.ok(!JSON.stringify(events).includes('secret-lease'));
  await assert.rejects(call('events.read',{conversation:'someone-else'}),/session mismatch/);
  await assert.rejects(call('turns.cancel',{turn:'another-turn'}),/turn mismatch/);
  await assert.rejects(call('approvals.resolve',{approval:'another-approval'}),/approval mismatch/);
  enabled=false;await assert.rejects(call('events.read',{conversation:'private-session'}),/revoked/);
});

test('collaboration authority uses its own authenticated renewal endpoint',async()=>{
  let observed;
  const authorize=controlPlaneAuthority({origin:'http://control-plane:4174',token:'fixture',request:async(url,init)=>{
    observed={url:String(url),...init};return {ok:true,json:async()=>({actor:'member'})};}});
  await authorize({collaboration:true,grant:'lease'});
  assert.equal(observed.url,'http://control-plane:4174/internal/native/collaboration');
  assert.deepEqual(JSON.parse(observed.body),{collaboration:true,grant:'lease'});
});
