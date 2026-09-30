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
import { ProjectGraph } from "../src/projectGraph.js";
import { CollaborationStore } from "../src/collaboration.js";
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
  it("stores task links locally, rejects dependency cycles, and filters private endpoints", async () => {
    const graph = new ProjectGraph(pool, store);
    const staff = { ...owner, projectInternal: true };
    const task = async (title: string, visibility = "shared") => store.mutate(staff, "create", null,
      { idempotency_key: randomUUID(), kind: "task", data: { title, visibility } });
    const first = await task("First"); const second = await task("Second"); const privateTask = await task("Private", "internal");
    const requestId = randomUUID();
    const link = await graph.create(staff, { idempotency_key: requestId, source_id: first.id, target_id: second.id, kind: "depends_on" });
    expect((await graph.create(staff, { idempotency_key: requestId, source_id: first.id, target_id: second.id, kind: "depends_on" })).id).toBe(link.id);
    await expect(graph.create(staff, { idempotency_key: randomUUID(), source_id: second.id, target_id: first.id, kind: "depends_on" })).rejects.toMatchObject({ code: "dependency_cycle" });
    await graph.create(staff, { idempotency_key: randomUUID(), source_id: first.id, target_id: privateTask.id, kind: "related" });
    expect((await graph.list(member)).map(edge => edge.id)).toEqual([link.id]);
    await graph.remove(staff, link.id);
    expect((await graph.list(staff)).some(edge => edge.id === link.id)).toBe(false);
  });
  it("broadcasts task comments to the workspace channel and turns replies into comments", async () => {
    const task = await store.mutate(member, "create", null, { idempotency_key: randomUUID(), kind: "task", data: { title: "Discuss" } });
    const comment = await store.mutate(member, "create", null, { idempotency_key: randomUUID(), kind: "comment",
      data: { title: "Reply", body: "First update", parent_id: task.id } });
    const collaboration = new CollaborationStore(pool);
    const channel = (await collaboration.listChannels(member)).find(row => row.primary)!;
    const message = (await collaboration.listMessages(member, channel.id)).find(row => row.projectItemId === comment.id)!;
    expect(message.body).toBe("First update");
    const response = await collaboration.postMessage(member, { channelId: channel.id, body: "Follow up", attachments: [],
      clientRequestId: randomUUID(), replyToId: message.id });
    expect(response.message.projectItemId).toBeTruthy();
    const linked = await store.get(member, response.message.projectItemId!);
    expect(linked.kind).toBe("comment"); expect(linked.data.parent_id).toBe(task.id);
  });
  it("keeps internal task comments out of the everyone channel", async () => {
    const staff = { ...owner, projectInternal: true };
    const task = await store.mutate(staff, "create", null, { idempotency_key: randomUUID(), kind: "task",
      data: { title: "Private plan", visibility: "internal" } });
    const comment = await store.mutate(staff, "create", null, { idempotency_key: randomUUID(), kind: "comment",
      data: { title: "Private reply", body: "Internal detail", parent_id: task.id, visibility: "internal" } });
    const collaboration = new CollaborationStore(pool);
    const channel = (await collaboration.listChannels(member)).find(row => row.primary)!;
    expect((await collaboration.listMessages(member, channel.id)).some(row => row.projectItemId === comment.id)).toBe(false);
  });
  it("removes task comments from the channel when publication is withdrawn", async () => {
    const staff = { ...owner, projectInternal: true };
    const task = await store.mutate(staff, "create", null, { idempotency_key: randomUUID(), kind: "task",
      data: { title: "Published plan", publication: { published: true, title: "Public plan", body: "" } } });
    const comment = await store.mutate(staff, "create", null, { idempotency_key: randomUUID(), kind: "comment",
      data: { title: "Update", body: "Safe update", parent_id: task.id, visibility: "shared" } });
    const collaboration = new CollaborationStore(pool);
    const channel = (await collaboration.listChannels(member)).find(row => row.primary)!;
    expect((await collaboration.listMessages(member, channel.id)).find(row => row.projectItemId === comment.id)?.projectTaskTitle)
      .toBe("Public plan");
    const withdrawn = await store.mutate(staff, "update", task.id, { idempotency_key: randomUUID(), revision: task.revision,
      data: { publication: { published: false, title: "Public plan", body: "" } } });
    expect((await collaboration.listMessages(member, channel.id)).some(row => row.projectItemId === comment.id)).toBe(false);
    await store.mutate(staff, "update", task.id, { idempotency_key: randomUUID(), revision: withdrawn.revision,
      data: { publication: { published: true, title: "Public plan", body: "" } } });
    expect((await collaboration.listMessages(member, channel.id)).some(row => row.projectItemId === comment.id)).toBe(true);
  });
  it("reserves stable imported IDs for explicit sync authority", async () => {
    const id = randomUUID(); const request = { idempotency_key: randomUUID(), sync_id: id,
      sync_author_id: reviewer.id, kind: "task", data: { title: "Imported" } };
    await expect(store.mutate(member, "create", null, request)).rejects.toMatchObject({ code: "sync_scope_required" });
    const item = await store.mutate({ ...owner, projectSync: true }, "create", null, request);
    expect(item.id).toBe(id);
    expect(item.author_id).toBe(reviewer.id);
    expect((await store.mutate({ ...owner, projectSync: true }, "create", null, request)).id).toBe(id);
    await expect(store.mutate({ ...owner, projectSync: true }, "create", null,
      { ...request, idempotency_key: randomUUID() })).rejects.toMatchObject({ code: "sync_identity_conflict" });
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
  it("does not treat managed customer owners as internal staff", async () => {
    const staff = { ...owner, projectInternal: true };
    const customer = { ...owner, projectInternal: false };
    const internal = await store.mutate(staff, "create", null, { idempotency_key: randomUUID(), kind: "task", data: { title: "Private", visibility: "internal" } });
    await expect(store.get(customer, internal.id)).rejects.toMatchObject({ status: 404 });
    const published = await store.mutate(staff, "create", null, { idempotency_key: randomUUID(), kind: "task", data: {
      title: "Staff plan", body: "Staff details", details: { secret: "internal" }, publication: { published: true, title: "Customer title", body: "Customer summary" },
    } });
    const visible = await store.get(customer, published.id);
    expect(visible.data.title).toBe("Customer title"); expect(visible.data.body).toBe("Customer summary");
    expect(visible.data.details).toEqual({});
    const draft = await store.mutate(staff, "create", null, { idempotency_key: randomUUID(), kind: "deliverable", data: {
      title: "Draft", publication: { published: false, title: "", body: "" },
    } });
    const nested = await store.mutate(staff, "create", null, { idempotency_key: randomUUID(), kind: "note", data: { title: "Nested", parent_id: draft.id } });
    await expect(store.get(customer, nested.id)).rejects.toMatchObject({ status: 404 });
    expect((await store.list(customer)).some(item => item.id === nested.id)).toBe(false);
  });
  it("does not serve a stale project after its export is committed", async () => {
    await pool.query("UPDATE project_storage SET state='exported'");
    await expect(store.list(member)).rejects.toMatchObject({ status: 423 });
    await pool.query("UPDATE project_storage SET state='active'");
  });
  it("fences writes during transfer and leaves existing content readable", async () => {
    await pool.query("UPDATE project_storage SET state='frozen'");
    await expect(store.mutate(owner, "create", null, { idempotency_key: randomUUID(), kind: "task", data: { title: "Blocked" } })).rejects.toMatchObject({ status: 423 });
    expect((await store.list(owner)).length).toBeGreaterThan(0);
    await pool.query("UPDATE project_storage SET state='active'");
  });
});
