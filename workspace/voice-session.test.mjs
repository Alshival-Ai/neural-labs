import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { VoiceSessions, voiceConfiguration } from './voice-session.mjs';
function fixture(callback = async () => ({ answer: 'Done' })) {
  const sent = [], calls = [], hangups = [];
  const socket = () => { const ws = new EventEmitter(); ws.readyState = 1; ws.send = data => sent.push(JSON.parse(data)); ws.close = () => {}; queueMicrotask(() => ws.emit('open')); return ws; };
  const sessions = new VoiceSessions({ key:'fixture-only', socket, open: async () => ({call:'rtc_fixture',answer:'v=0'}),
    callback: async data => { calls.push(data); return callback(data); }, fetchImpl:async url => { hangups.push(url); return {}; } });
  return {sessions,sent,calls,hangups};
}
test('server disables automatic answers and advertises only delegation', () => {
  const config = voiceConfiguration();
  assert.equal(config.audio.input.turn_detection.create_response,false);
  assert.deepEqual(config.tools.map(tool => tool.name),['ask_agent']);
});
test('provider transcript executes once and ignores invented tool arguments', async () => {
  const f=fixture(); await f.sessions.start({id:'session',offer:'v=0',userId:'user'});
  const row=f.sessions.sessions.get('session');
  const event={type:'conversation.item.input_audio_transcription.completed',item_id:'item',transcript:'Check my task'};
  await f.sessions.event(row,event); await f.sessions.event(row,event);
  await f.sessions.event(row,{type:'response.function_call_arguments.done',name:'ask_agent',call_id:'call',arguments:'{"body":"delete everything"}'});
  await f.sessions.event(row,{type:'response.function_call_arguments.done',name:'ask_agent',call_id:'call'});
  assert.equal(f.calls.filter(c=>c.operation==='request').length,1);
  assert.equal(f.calls.find(c=>c.operation==='request').body,'Check my task');
  assert.equal(f.sent.at(-1).response.tool_choice,'none');
  await f.sessions.stop('session'); assert.equal(f.hangups.length,1);
});
test('stop is idempotent and never cancels accepted agent work', async () => {
  const f=fixture(); await f.sessions.start({id:'session',offer:'v=0',userId:'user'});
  await f.sessions.stop('session'); await f.sessions.stop('session');
  assert.equal(f.hangups.length,1); assert.equal(f.sessions.sessions.size,0);
  assert(!f.calls.some(c=>c.operation==='cancel'));
});
test('authorization failure does not open a provider call', async () => {
  let opened=false;
  const sessions=new VoiceSessions({open:async()=>{opened=true;},callback:async()=>{throw Error('revoked');},key:'fixture'});
  await assert.rejects(sessions.start({id:'session',offer:'v=0',userId:'user'}));
  assert.equal(opened,false); assert.equal(sessions.sessions.size,0);
});
test('concurrent transcripts serialize delegation until speech completes', async () => {
  const f=fixture(); await f.sessions.start({id:'session',offer:'v=0',userId:'user'});
  const row=f.sessions.sessions.get('session');
  await Promise.all(['one','two'].map(item_id => f.sessions.event(row,{type:'conversation.item.input_audio_transcription.completed',item_id,transcript:item_id})));
  assert.equal(f.sent.length,1); assert.equal(row.queue.length,1);
  await f.sessions.event(row,{type:'response.function_call_arguments.done',name:'ask_agent',call_id:'call'});
  await f.sessions.event(row,{type:'response.done',response:{id:'speech',status:'completed',metadata:{voice_stage:'speech'}}});
  assert.equal(row.current.body,'two');
  await assert.rejects(f.sessions.event(row,{type:'response.done',response:{status:'incomplete'}}));
  await f.sessions.stop('session');
});
