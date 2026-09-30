import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { NativeState } from './native/state.mjs';
import { NativeJobs, validateJob } from './native/jobs.mjs';
import { NativeScheduler } from './native/schedules.mjs';
import { NativeTriggerLoop } from './native/trigger-loop.mjs';
import { NativeSources } from './native/sources.mjs';
const connection = {owner:'account',provider:'codex',method:'subscription',generation:1};
const definition = (extra={}) => ({id:'job',name:'Fixture',actor:'owner',connection,model:'fixture',enabled:true,
  schedule:{kind:'every',everyMs:1000,anchorMs:0},payload:{kind:'agentTurn',message:'Check'},missedRunPolicy:'skip',overlap:'forbid',
  executionPolicy:{sandbox:'workspace-write',approval:'on-request'},...extra});
const authorize = async () => ({actor:'owner',connection,revalidate:async()=>{},authorityGeneration:1});

test('failure streak and cooldown survive restart; manual and uncertain receipts do not count', async t => {
  const root=await mkdtemp(path.join(tmpdir(),'policy-'));t.after(()=>rm(root,{recursive:true,force:true}));
  let now=1000,state=new NativeState(path.join(root,'state'),{now:()=>now});
  state.setMetadata('scheduling','enabled'); state.putJob(validateJob(definition({failureAlert:{after:2,cooldownMs:5000}})));
  let sequence=0;
  const finish=(status,manual=false)=>{const r=state.claim({jobId:'job',occurrence:`test:${++sequence}`,actor:'owner',connection,manual});state.startRun(r.id);state.finishRun(r.id,status);return new NativeJobs({state}).notification('run',{jobId:'job',runId:r.id}).run;};
  assert.equal(finish('failed').external,false);
  assert.equal(finish('failed',true).external,false);
  state.close();state=new NativeState(path.join(root,'state'),{now:()=>now});t.after(()=>state.close());
  assert.equal(finish('failed').external,true);
  assert.equal(finish('failed').external,false);
  now+=5000;assert.equal(finish('failed').external,true);
  finish('succeeded');assert.equal(finish('failed').external,false);
  finish('cancelled');assert.equal(finish('failed').external,true);
  now+=5000;assert.equal(finish('failed').external,true);
});

test('stagger queue survives restart and does not duplicate an admitted occurrence',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'stagger-'));t.after(()=>rm(root,{recursive:true,force:true}));
  let now=1000,state=new NativeState(path.join(root,'state'),{now:()=>now});state.setMetadata('scheduling','enabled');
  state.putJob(validateJob(definition({schedule:{kind:'every',everyMs:1000,anchorMs:0,staggerMs:5000}})));
  let executed=0;
  const make=()=>{const scheduler=new NativeScheduler({state,authorize,execute:async()=>{executed++;return {status:'succeeded'};},now:()=>now});const loop=new NativeTriggerLoop({state,scheduler,root,now:()=>now});loop.closed=false;return loop;};
  let loop=make();await loop.admit(state.job('job'),'every:1000');const due=state.db.prepare('SELECT due_at FROM scheduled_pending').get().due_at;
  assert.ok(due>=1000&&due<=6000);state.close();state=new NativeState(path.join(root,'state'),{now:()=>now});t.after(()=>state.close());loop=make();
  now=6001;await loop.flush();await loop.scheduler.drain();await loop.admit(state.job('job'),'every:1000');await loop.flush();assert.equal(executed,1);
});

function fakeChild(){const c=new EventEmitter();c.stdout=new PassThrough();c.stderr=new PassThrough();c.exitCode=null;c.kill=()=>{c.exitCode=1;queueMicrotask(()=>c.emit('close',null,'SIGTERM'));};return c;}
test('supervised streams persist trusted receipts, reject forged events and stop on revocation',async t=>{
  const state=new NativeState(':memory:');t.after(()=>state.close());state.setMetadata('scheduling','enabled');
  state.putJob(validateJob(definition({schedule:{kind:'stream',source:'source',command:['/bin/sh','watch.sh'],cwd:'.'}})));
  let revoked=false,count=0,child,options;
  const scheduler=new NativeScheduler({state,authorize:async()=>({...await authorize(),revalidate:async()=>{if(revoked)throw Error('revoked');}}),execute:async()=>{count++;return {status:'succeeded'};}});
  const root=await mkdtemp(path.join(tmpdir(),'source-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const sources=new NativeSources({state,scheduler,workspaceRoot:'/fixture',root,launcher:async input=>{options=input;return {spawn:(command,args,opts)=>{assert.equal(opts.env.HOME,'/home/node');assert.equal(Object.keys(opts.env).length,3);child=fakeChild();return child;}};}});t.after(()=>sources.close());
  await sources.refresh(true);assert.ok(options.homeRoot.startsWith(root));
  await assert.rejects(scheduler.launch('job','stream:forged:1'),/Untrusted/);
  child.stdout.write('one\ntwo\n');await sources.refresh(true);await scheduler.drain();await sources.refresh(true);await scheduler.drain();assert.equal(count,2);
  await sources.refresh(true);assert.equal(count,2);
  revoked=true;await sources.refresh(true);assert.equal(sources.active,0);assert.equal(state.job('job').hold,'authorization-or-policy-unavailable');
});
test('source overflow holds work; interrupted process cannot invent an exit',async t=>{
  const state=new NativeState(':memory:');t.after(()=>state.close());state.setMetadata('scheduling','enabled');
  state.putJob(validateJob(definition({schedule:{kind:'process',source:'source',command:['/bin/true'],cwd:'.'}})));
  const scheduler=new NativeScheduler({state,authorize,execute:async()=>({status:'succeeded'})});
  const root=await mkdtemp(path.join(tmpdir(),'source-'));t.after(()=>rm(root,{recursive:true,force:true}));let child;
  const make=()=>new NativeSources({state,scheduler,root,workspaceRoot:'/fixture',launcher:async()=>({spawn:()=>child=fakeChild()})});
  let sources=make();await sources.refresh(true);await sources.close();sources=make();await sources.refresh(true);
  assert.equal(state.db.prepare('SELECT count(*) n FROM source_events').get().n,0);
  assert.equal(state.job('job').hold,'source-interrupted-review-required');await sources.close();
});
test('synthetic two and four concurrent jobs settle with separate receipts',async t=>{
  for(const concurrency of [2,4]){
    const state=new NativeState(':memory:');state.setMetadata('scheduling','enabled');let running=0,peak=0;
    const scheduler=new NativeScheduler({state,authorize,execute:async()=>{peak=Math.max(peak,++running);await new Promise(r=>setTimeout(r,10));running--;return {status:'succeeded'};}});
    for(let i=0;i<concurrency;i++)state.putJob(definition({id:`job-${i}`}));
    await Promise.all(Array.from({length:concurrency},(_,i)=>scheduler.launch(`job-${i}`,'every:1000')));await scheduler.drain();
    assert.equal(peak,concurrency);assert.equal(state.db.prepare("SELECT count(*) n FROM occurrences WHERE status='succeeded'").get().n,concurrency);state.close();
  }
});
test('source queue overflow holds the producer and preserves accepted events',async t=>{
 const state=new NativeState(':memory:');t.after(()=>state.close());state.setMetadata('scheduling','enabled');
 state.putJob(validateJob(definition({schedule:{kind:'stream',source:'source',command:['/bin/cat'],cwd:'.'}})));
 const scheduler=new NativeScheduler({state,authorize,execute:async()=>({status:'succeeded'})});const root=await mkdtemp(path.join(tmpdir(),'overflow-'));t.after(()=>rm(root,{recursive:true,force:true}));let child;
 const sources=new NativeSources({state,scheduler,root,workspaceRoot:'/fixture',launcher:async()=>({spawn:()=>child=fakeChild()})});
 await sources.refresh(true);child.stdout.write('line\n'.repeat(101));await sources.close();
 assert.equal(state.job('job').hold,'source-overflow-review-required');assert.equal(state.db.prepare('SELECT count(*) n FROM source_events').get().n,100);
});
test('SQLite 7 to 8 preserves definitions, holds and checkpoints',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'schema-'));t.after(()=>rm(root,{recursive:true,force:true}));const file=path.join(root,'state');let state=new NativeState(file);
 state.putJob(definition(),{hold:'native-connection-required'});state.checkpoint('job','fixture',{value:'preserve'});const original=state.job('job');
 state.db.exec('DROP TABLE source_events; DROP TABLE event_sources; DROP TABLE scheduled_pending; DROP TABLE run_notification_policy; DROP TABLE failure_policies; PRAGMA user_version=7;');state.close();
 state=new NativeState(file);t.after(()=>state.close());assert.deepEqual(state.job('job'),original);assert.equal(state.db.prepare('SELECT value FROM checkpoints').get().value,'{"value":"preserve"}');assert.equal(state.db.prepare('PRAGMA user_version').get().user_version,8);
});
