import express from "express";
import request from "supertest";
import { createHmac, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Database } from "../src/database.js";
import type { ControlPlaneConfig } from "../src/config.js";
import { registerProjectSyncBridge, validProjectSyncSignature } from "../src/projectSyncBridge.js";
import { ProjectStore } from "../src/projects.js";

const secret = "fixture-secret-for-graph-replication-only";
const sign = (stamp: string, payload: string) => createHmac("sha256", secret).update(`project-sync\n${stamp}\n${payload}`).digest("hex");
describe("graph connection signatures", () => {
  it("binds the operation, exact payload and freshness", () => {
    const stamp = String(Math.floor(Date.now()/1000)), payload = "{}";
    expect(validProjectSyncSignature(secret, stamp, payload, sign(stamp,payload))).toBe(true);
    expect(validProjectSyncSignature(secret, stamp, payload+" ", sign(stamp,payload))).toBe(false);
    const old = String(Number(stamp)-60);
    expect(validProjectSyncSignature(secret, old, payload, sign(old,payload))).toBe(false);
    expect(validProjectSyncSignature(secret, stamp, payload, createHmac("sha256", secret).update(`chat\n${stamp}\n${payload}`).digest("hex"))).toBe(false);
  });
  it("is absent without a configured connection and rejects unsigned calls before database access", async () => {
    const db = { pool: { query: vi.fn() } };
    const standalone = express(), managed = express();
    for (const [app, config] of [[standalone, {}], [managed, { managed: { secret } }]] as const) {
      app.use(express.json()); registerProjectSyncBridge(app, db as unknown as Database, config as ControlPlaneConfig);
    }
    expect((await request(standalone).post('/api/projects/sync/bridge').send({payload:'{}'})).status).toBe(404);
    expect((await request(managed).post('/api/projects/sync/bridge').send({payload:'{}'})).status).toBe(403);
    expect(db.pool.query).not.toHaveBeenCalled();
  });
});

const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)("automatic graph bridge integration", () => {
  const schema = `sync_bridge_${randomUUID().replaceAll('-','')}`;
  const workspace = randomUUID(), instance = randomUUID();
  const app = express(); app.use(express.json());
  let root: Pool, pool: Pool, db: Database;
  let generation = 1, enabled = true;
  const members = [{subject:'17', email:'member@example.test', display_name:'Member', role:'user'}];
  beforeAll(async () => {
    root = new Pool({connectionString:url}); await root.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({connectionString:url, options:`-c search_path=${schema}`});
    db = new Database(pool); await db.migrate();
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      const body = JSON.parse(options.body);
      return new Response(JSON.stringify({generation, members}), {status: enabled && body.generation === generation ? 200 : 403});
    }));
    registerProjectSyncBridge(app, db, {managed:{workspace,instance,secret,portalOrigin:'https://portal.example.test'}} as ControlPlaneConfig);
  });
  afterAll(async () => { vi.unstubAllGlobals(); await db?.close(); if(root) { await root.query(`DROP SCHEMA ${schema} CASCADE`); await root.end(); } });
  const call = async (method:string, path:string, data:unknown=null, overrides:Record<string,unknown>={}) => {
    const payload=JSON.stringify({workspace,instance,generation:1,method,path,data,...overrides});
    const stamp=String(Math.floor(Date.now()/1000));
    return request(app).post('/api/projects/sync/bridge').set('X-Neural-Labs-Time',stamp)
      .set('X-Neural-Labs-Signature',sign(stamp,payload)).send({payload});
  };
  it("provisions verified subjects without login, preserves source clocks and checks revisions", async () => {
    const snapshot=await call('GET','sync/snapshot'); expect(snapshot.status).toBe(200);
    expect(snapshot.body.capabilities.source_edit_clocks).toBe(true);
    const member=snapshot.body.principals.find((row:{subject:string})=>row.subject==='17');
    expect(member).toBeTruthy();
    expect((await pool.query('SELECT * FROM identities')).rowCount).toBe(0);
    const source='2020-01-02T03:04:05.000Z';
    const created=await call('POST','items',{idempotency_key:randomUUID(),kind:'task',sync_edited_at:source,data:{title:'Background',assignee:member.id}});
    expect(created.status).toBe(200); expect(created.body.sync_edited_at).toBe(source);
    const edit=await call('PATCH',`items/${created.body.id}`,{idempotency_key:randomUUID(),revision:created.body.revision,sync_edited_at:source,data:{title:'Replicated'}});
    expect(edit.status).toBe(200); expect(edit.body.sync_edited_at).toBe(source);
    expect((await call('PATCH',`items/${created.body.id}`,{idempotency_key:randomUUID(),revision:created.body.revision,data:{title:'Stale'}})).status).toBe(409);
    const actor=(await db.getUser(member.id))!;
    await expect(new ProjectStore(pool).mutate(actor,'update',created.body.id,{idempotency_key:randomUUID(),revision:edit.body.revision,sync_edited_at:source,data:{title:'Forged clock'}}))
      .rejects.toMatchObject({code:'sync_scope_required'});
    const native=await new ProjectStore(pool).mutate(actor,'update',created.body.id,{idempotency_key:randomUUID(),revision:edit.body.revision,data:{title:'Actual newer edit'}});
    expect(new Date((native as unknown as {sync_edited_at:string}).sync_edited_at).getTime()).toBeGreaterThan(new Date(source).getTime());
  });
  it("rejects foreign workspaces, revoked connections and changed generations", async () => {
    expect((await call('GET','sync/snapshot',null,{workspace:randomUUID()})).status).toBe(403);
    enabled=false; expect((await call('GET','sync/snapshot')).status).not.toBe(200); enabled=true;
    generation=2; expect((await call('GET','sync/snapshot')).status).not.toBe(200); generation=1;
    expect((await call('POST','items/anything/actions',{})).status).toBe(400);
  });
});
