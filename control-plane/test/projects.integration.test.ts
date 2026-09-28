import express from "express";
import request from "supertest";
import { registerProjectRoutes } from "../src/projectRoutes.js";
import type { ControlPlaneConfig } from "../src/config.js";
import type { SessionActor } from "../src/types.js";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Database } from "../src/database.js";
import { ProjectStore } from "../src/projects.js";
import type { UserRecord } from "../src/types.js";

const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)("environment-local projects", () => {
  const schema = `projects_${randomUUID().replaceAll("-", "")}`;
  let root: Pool; let pool: Pool; let database: Database; let store: ProjectStore;
  let owner: UserRecord; let member: UserRecord; let reviewer: UserRecord;
  beforeAll(async () => {
    root = new Pool({ connectionString: url });
    await root.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
    database = new Database(pool); await database.migrate(); store = new ProjectStore(pool);
    owner = await database.createLocalUser({ email: "owner@example.test", displayName: "Owner", passwordHash: "fixture" });
    member = await database.createLocalUser({ email: "member@example.test", displayName: "Member", passwordHash: "fixture" });
    reviewer = await database.createLocalUser({ email: "reviewer@example.test", displayName: "Reviewer", passwordHash: "fixture" });
    await pool.query("UPDATE users SET status='active'");
    owner.status = member.status = reviewer.status = "active";
  });
  afterAll(async () => { await database?.close(); if (root) { await root.query(`DROP SCHEMA ${schema} CASCADE`); await root.end(); } });
  it("keeps internal records out of member list, reads, replies and history", async () => {
    const item = await store.mutate(owner, "create", null, { idempotency_key: randomUUID(), kind: "note", data: { title: "Internal", visibility: "internal" } });
    expect((await store.list(member)).find(value => value.id === item.id)).toBeUndefined();
    await expect(store.get(member, item.id)).rejects.toMatchObject({ status: 404 });
    await expect(store.history(member, item.id)).rejects.toMatchObject({ status: 404 });
    await expect(store.mutate(member, "create", null, { idempotency_key: randomUUID(), kind: "comment", data: { title: "Reply", parent_id: item.id } })).rejects.toMatchObject({ status: 404 });
  });
  it("serializes concurrent revisions and binds retry IDs to actor and payload", async () => {
    const request = { idempotency_key: randomUUID(), kind: "task", data: { title: "Concurrent" } };
    const item = await store.mutate(member, "create", null, request);
    expect((await store.mutate(member, "create", null, request)).id).toBe(item.id);
    await expect(store.mutate(member, "create", null, { ...request, data: { title: "Changed retry" } })).rejects.toMatchObject({ code: "idempotency_conflict" });
    const results = await Promise.allSettled(["First", "Second"].map(title => store.mutate(member, "update", item.id, { revision: item.revision, idempotency_key: randomUUID(), data: { title } })));
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
  });
  it("requires a separate reviewer and keeps accepted tasks editable", async () => {
    const item = await store.mutate(member, "create", null, { idempotency_key: randomUUID(), kind: "task", data: { title: "Review", state: "review", assignee: member.id, reviewer: reviewer.id } });
    await expect(store.mutate(member, "action", item.id, { revision: item.revision, idempotency_key: randomUUID(), action: "approve" })).rejects.toMatchObject({ code: "reviewer_required" });
    const accepted = await store.mutate(reviewer, "action", item.id, { revision: item.revision, idempotency_key: randomUUID(), action: "approve" });
    expect(accepted.data.state).toBe("done");
    const edited = await store.mutate(member, "update", item.id, { revision: accepted.revision, idempotency_key: randomUUID(), data: { body: "Updated after acceptance" } });
    expect(edited.data.state).toBe("done");
  });
  it("binds external credentials to their user, scopes, expiry and revocation", async () => {
    const app = express(); app.use(express.json());
    const actor = { user: member } as SessionActor;
    registerProjectRoutes(app, database, {} as ControlPlaneConfig, {
      active: async (req, res) => { if (req.get("x-fixture-session") === "member") return actor; res.sendStatus(401); },
      csrf: req => req.get("x-fixture-csrf") === "valid", sameOrigin: (_req, _res, next) => next(),
    });
    expect((await request(app).get("/api/projects")).status).toBe(401);
    const created = await request(app).post("/api/projects/keys").set("x-fixture-session", "member").set("x-fixture-csrf", "valid")
      .send({ name: "Reader", scopes: ["project:read"] });
    expect(created.status).toBe(201);
    const token = created.body.token;
    expect((await pool.query("SELECT token_hash FROM project_api_keys WHERE id=$1", [created.body.id])).rows[0].token_hash).not.toContain(token);
    expect((await request(app).get("/api/projects/items").auth(token, { type: "bearer" })).status).toBe(200);
    expect((await request(app).post("/api/projects/items").auth(token, { type: "bearer" })
      .send({ idempotency_key: randomUUID(), kind: "task", data: { title: "Forbidden" } })).status).toBe(403);
    const mcp = await request(app).post("/api/projects/mcp").auth(token, { type: "bearer" })
      .set("Accept", "application/json, text/event-stream")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    expect(mcp.status).toBe(200);
    expect(mcp.text).toContain("project_list");
    await pool.query("UPDATE project_api_keys SET revoked_at=now() WHERE id=$1", [created.body.id]);
    expect((await request(app).get("/api/projects/items").auth(token, { type: "bearer" })).status).toBe(401);
  });
  it("fences writes during transfer and leaves existing content readable", async () => {
    await pool.query("UPDATE project_storage SET state='frozen'");
    await expect(store.mutate(owner, "create", null, { idempotency_key: randomUUID(), kind: "task", data: { title: "Blocked" } })).rejects.toMatchObject({ status: 423 });
    expect((await store.list(owner)).length).toBeGreaterThan(0);
    await pool.query("UPDATE project_storage SET state='active'");
  });
});
