import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { Pool } from 'pg';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { Database } from '../src/database.js';
import { ExternalCollaboration, credentialInput } from '../src/externalCollaboration.js';
import { registerCollaborationRoutes } from '../src/collaborationRoutes.js';
import type { ControlPlaneConfig } from '../src/config.js';

const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;
suite('external collaboration database boundary', () => {
  let admin: Pool, database: Database, schema: string, user: string, connection: string, service: ExternalCollaboration;
  const config = {workspace:{controlUrl:new URL('http://workspace:8080'),controlToken:'fixture-control'}} as ControlPlaneConfig;
  const transport=vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body=JSON.parse(String(init?.body));
    return new Response(JSON.stringify(body.operation === 'conversations.create' ? {session:{key:'native'}} : {id:randomUUID(),events:[],cursor:0}));
  });
  beforeEach(async()=>{
    schema='collaboration_test_'+randomUUID().replaceAll('-','');
    admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});await admin.query(`CREATE SCHEMA ${schema}`);
    database=new Database(new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema}`}));await database.migrate();
    await database.createLocalUser({email:'owner@example.test',displayName:'Owner',passwordHash:'fixture'});
    user=(await database.pool.query('SELECT id FROM users')).rows[0].id;
    connection=randomUUID();await database.pool.query(`INSERT INTO native_connections(id,scope,user_id,provider,method,label) VALUES($1,'personal',$2,'codex','subscription','Fixture')`,[connection,user]);
    service=new ExternalCollaboration(database,config,transport as typeof fetch);transport.mockClear();
  });
  afterEach(async()=>{await database.close();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
  const mint=()=>service.mint(user,credentialInput.parse({name:'External researcher',connection,model:'fixture'}));
  it('stores only token hashes and makes creation idempotent across disconnects',async()=>{
    const key=await mint(), requestId=randomUUID();
    const first=await service.call(key.token,{operation:'create',requestId});
    const second=await service.call(key.token,{operation:'create',requestId});
    expect(first.session).toBe(second.session);expect(first.session).toMatch(/^[a-f0-9-]{36}$/);
    const row=(await database.pool.query('SELECT * FROM collaboration_credentials')).rows[0];
    expect(JSON.stringify(row)).not.toContain(key.token);
    expect(row.scopes).toEqual(['read','run','cancel']);
    const native=JSON.parse(String(transport.mock.calls[0]?.[1]?.body));
    const grant=await service.authorize(native.lease.grant);
    expect(grant.collaboration).toMatchObject({principal:key.id,session:first.session,kind:'external-agent'});
    expect(grant.binding.owner).toBe(connection);
  });
  it('isolates sessions by external principal even when owned by the same user',async()=>{
    const a=await mint(), b=await mint();
    const session=(await service.call(a.token,{operation:'create',requestId:randomUUID()})).session;
    await expect(service.call(b.token,{operation:'follow',session,after:0,waitMs:0})).rejects.toThrow('not found');
    await expect(service.call(a.token,{operation:'approve',session,approval:randomUUID(),decision:{decision:'accept'}})).rejects.toThrow('scope');
  });
  it('revalidates credential revocation, provider generation and membership on renewal',async()=>{
    const key=await mint();await service.call(key.token,{operation:'create',requestId:randomUUID()});
    const lease=JSON.parse(String(transport.mock.calls[0]?.[1]?.body)).lease.grant;
    await database.pool.query('UPDATE native_connections SET generation=generation+1 WHERE id=$1',[connection]);
    await expect(service.authorize(lease)).rejects.toThrow('revoked');
    await database.pool.query('UPDATE native_connections SET generation=generation-1 WHERE id=$1',[connection]);
    await database.pool.query("UPDATE users SET status='disabled' WHERE id=$1",[user]);
    await expect(service.authorize(lease)).rejects.toThrow('membership');
    await database.pool.query("UPDATE users SET status='active' WHERE id=$1",[user]);
    await database.pool.query('UPDATE collaboration_credentials SET revoked_at=now() WHERE id=$1',[key.id]);
    await expect(service.authorize(lease)).rejects.toThrow('revoked');
    await expect(service.credential(key.token)).rejects.toThrow('revoked');
  });
  it('does not expose sessions or MCP through ambient browser cookies',async()=>{
    const app=express();app.use(express.json());registerCollaborationRoutes(app,service,{active:async()=>undefined,csrf:()=>false,sameOrigin:(_q,_s,next)=>next()});
    expect((await request(app).post('/api/collaboration/v1').set('Cookie','session=fixture').send({operation:'create',requestId:randomUUID()})).status).toBe(401);
    expect((await request(app).post('/api/collaboration/mcp').send({jsonrpc:'2.0',id:1,method:'tools/list'})).status).toBe(401);
    expect((await request(app).post('/internal/native/collaboration').send({collaboration:true,grant:randomUUID()})).status).toBe(401);
    expect((await request(app).post('/api/alshival/collaboration').send({})).status).toBe(404);
  });
  it('does not reuse the previous provider when a managed conversation selection changes',async()=>{
    const source=randomUUID();
    const managed=new ExternalCollaboration(database,{...config,managed:{secret:'fixture-secret'} as NonNullable<ControlPlaneConfig['managed']>},transport as typeof fetch);
    vi.spyOn(managed,'managedIdentity').mockResolvedValue({user,source} as Awaited<ReturnType<typeof managed.managedIdentity>>);
    vi.spyOn(managed,'member').mockImplementation(async()=>({actor:(await database.getUser(user))!,generation:1}));
    await database.pool.query(`INSERT INTO native_chat_defaults(selection_key,user_id,connection_id,connection_generation,model)
      VALUES($1,$2,$3,1,'fixture')`,[`user:${user}`,user,connection]);
    const context={turn:randomUUID(),attempt:randomUUID(),generation:1};
    const created=await managed.managedCall({...context,request:{operation:'create',requestId:source}});
    await database.pool.query("UPDATE native_chat_defaults SET model='changed' WHERE user_id=$1",[user]);
    const previousCalls=transport.mock.calls.length;
    await expect(managed.managedCall({...context,request:{operation:'send',session:created.session,requestId:randomUUID(),text:'new work'}})).rejects.toThrow('provider changed');
    expect(transport.mock.calls.length).toBe(previousCalls);
    // The user can still reconcile accepted work on its original provider.
    await managed.managedCall({...context,request:{operation:'follow',session:created.session,after:0,waitMs:0}});
    expect(transport.mock.calls.length).toBe(previousCalls+1);
  });
  it('never retries an uncertain native dispatch',async()=>{
    const key=await mint();transport.mockRejectedValueOnce(new Error('connection lost after dispatch'));
    await expect(service.call(key.token,{operation:'create',requestId:randomUUID()})).rejects.toThrow('lost');
    expect(transport).toHaveBeenCalledTimes(1);
    expect((await database.pool.query('SELECT count(*)::int AS n FROM collaboration_sessions')).rows[0].n).toBe(1);
  });
});
