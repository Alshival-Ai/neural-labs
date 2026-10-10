import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { Pool } from 'pg';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { Database } from '../src/database.js';
import { SessionService } from '../src/sessions.js';
import { loadConfig } from '../src/config.js';
import { registerVoice } from '../src/voice.js';
import { CollaborationStore } from '../src/collaboration.js';

const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
suite('voice session authority and delegation', () => {
  let admin: Pool, database: Database, schema: string, user: string, connection: string;
  let app: express.Express, sessionId: string, actor: any;
  let store: CollaborationStore;
  const enqueue = vi.fn();
  const turn = randomUUID();
  const admission = vi.fn(async (_actor: unknown, _session: string, _request?: string) => {});
  const transport = vi.fn(async (url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith('/internal/voice/session')) return new Response(JSON.stringify({id:body.id,answer:'v=0',maxSeconds:300}));
    if (body.operation === 'turns.start') return new Response(JSON.stringify({id:turn,accepted:true}));
    return new Response(JSON.stringify({events:[{id:1,turn_id:turn,type:'output',payload:{delta:'Saved task'}},{id:2,turn_id:turn,type:'turn-completed',payload:{status:'succeeded'}}],cursor:2}));
  });
  beforeEach(async () => {
    schema = 'voice_test_' + randomUUID().replaceAll('-','');
    admin = new Pool({connectionString:process.env.TEST_DATABASE_URL}); await admin.query(`CREATE SCHEMA ${schema}`);
    database = new Database(new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`})); await database.migrate();
    const person = await database.createLocalUser({email:'voice@example.test',displayName:'Voice fixture',passwordHash:'fixture'}); user = person.id;
    await database.pool.query("UPDATE users SET status='active' WHERE id=$1",[user]);
    await database.createSession({tokenHash:'fixture-session',csrfHash:'fixture-csrf',userId:user,idleExpiresAt:new Date(Date.now()+600000),absoluteExpiresAt:new Date(Date.now()+600000)});
    await database.pool.query("UPDATE update_runtime SET gate=false WHERE singleton");
    connection = randomUUID(); await database.pool.query("INSERT INTO native_connections(id,scope,user_id,provider,method,label) VALUES($1,'personal',$2,'codex','subscription','Fixture')",[connection,user]);
    const config = await loadConfig({CONTROL_PLANE_MASTER_KEY:Buffer.alloc(32,7).toString('base64'),MCP_CONFIG_TOKEN:'fixture-mcp-token-at-least-32-characters',WORKSPACE_CONTROL_TOKEN:'fixture-control-token-at-least-32-characters',PGPASSWORD:'fixture'});
    const sessions = new SessionService(database,config); actor = await sessions.actorByTokenHash('fixture-session');
    app = express(); app.use(express.json());
    store = new CollaborationStore(database.pool);
    registerVoice(app,database,sessions,config,{sameOrigin:(_req,_res,next)=>next(),active:async()=>actor,
      csrf:(req,res)=> { if(req.get('x-csrf-token')!=='fixture') {res.status(403).end();return false;} return true; },
      fetch:transport as typeof fetch,store,publish:()=>{},enqueue,admit:admission});
    sessionId = randomUUID(); admission.mockClear(); transport.mockClear(); enqueue.mockClear();
  });
  afterEach(async()=>{await database.close();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
  const start = () => request(app).post('/api/voice/sessions').set('x-csrf-token','fixture').send({requestId:sessionId,offer:'v=0',conversation:'fixture-chat',selection:{connection,model:'fixture'}});
  const callback = (body: Record<string,unknown>) => request(app).post('/internal/voice/callback').set('authorization','Bearer fixture-control-token-at-least-32-characters').send({id:sessionId,...body});
  it('limits new sessions per actor without blocking heartbeats or ending', async () => {
    await start().expect(201);
    for (let i = 0; i < 5; i++) await start().expect(403);
    await start().expect(429);
    await request(app).post(`/api/voice/sessions/${sessionId}/heartbeat`).set('x-csrf-token','fixture').send({}).expect(200);
    await request(app).post(`/api/voice/sessions/${sessionId}/end`).set('x-csrf-token','fixture').send({}).expect(200);
  });
  it('delegates a transcript exactly once and reads the existing agent result',async()=>{
    await start().expect(201);
    const requestId=randomUUID(), body={operation:'request',requestId,event:'audio-1',body:'Create a task'};
    expect((await callback(body).expect(200)).body).toEqual({answer:'Saved task'});
    await callback(body).expect(200);
    expect(transport.mock.calls.filter(call=>JSON.parse(String(call[1]?.body)).operation==='turns.start')).toHaveLength(1);
    expect(admission.mock.calls.filter(call=>call[2])).toHaveLength(1);
    const row=(await database.pool.query('SELECT * FROM voice_events WHERE request_id=$1',[requestId])).rows[0];
    expect(row.data.body).toBe('Create a task');
  });
  it('rejects forged callbacks, missing CSRF, credential rotation, and ended sessions',async()=>{
    await request(app).post('/api/voice/sessions').send({}).expect(403);
    await start().expect(201);
    await request(app).post('/internal/voice/callback').send({id:sessionId,operation:'authorize'}).expect(403);
    await database.pool.query('UPDATE native_connections SET generation=generation+1 WHERE id=$1',[connection]);
    await callback({operation:'authorize'}).expect(403);
    await request(app).post(`/api/voice/sessions/${sessionId}/end`).set('x-csrf-token','fixture').send({}).expect(200);
    await callback({operation:'authorize'}).expect(403);
  });
  it('does not start provider calls when external admission denies access',async()=>{
    admission.mockRejectedValueOnce(new Error('Denied'));
    await start().expect(403); expect(transport).not.toHaveBeenCalled();
  });
  it('does not revive a logged-out or expired session',async()=>{
    await start().expect(201);
    await database.pool.query("UPDATE voice_sessions SET expires_at=now()-interval '1 second' WHERE id=$1",[sessionId]);
    await callback({operation:'authorize'}).expect(403);
  });
  it('posts a shared transcript to the Team agent once and follows its own run',async()=>{
    const channel=(await store.listChannels(actor.user)).find(value=>value.primary)!;
    await request(app).post('/api/voice/sessions').set('x-csrf-token','fixture').send({requestId:sessionId,offer:'v=0',channel:channel.id}).expect(201);
    const requestId=randomUUID(), body={operation:'request',requestId,event:'audio-team',body:'Check the release'};
    expect((await callback(body).expect(200)).body).toEqual({pending:true});
    await callback(body).expect(200);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect((await store.listMessages(actor.user,channel.id)).some(message=>message.body==='@Alshival Check the release')).toBe(true);
    expect(transport.mock.calls.filter(call=>JSON.parse(String(call[1]?.body)).operation==='turns.start')).toHaveLength(0);
    const run=enqueue.mock.calls[0]![0];
    await database.pool.query("UPDATE team_agent_runs SET status='failed' WHERE id=$1",[run.id]);
    expect((await callback({operation:'result',requestId}).expect(200)).body.answer).toContain('did not complete');
    await database.pool.query("DELETE FROM sessions WHERE token_hash='fixture-session'");
    await callback({operation:'authorize'}).expect(403);
  });
});
