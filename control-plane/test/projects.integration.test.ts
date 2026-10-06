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
import { ProjectStatuses } from "../src/projectStatuses.js";
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
  it("owns separate board workflows, hides archived contents and preserves cross-board links", async () => {
    const admin = { ...owner, role: "admin" as const, projectPlan: true, projectInternal: true };
    const createBoard = (title: string) => store.mutate(admin, "create", null, { idempotency_key: randomUUID(), kind: "board", data: { title } });
    await expect(store.mutate(member, "create", null, { idempotency_key: randomUUID(), kind: "board", data: { title: "Forbidden" } }))
      .rejects.toMatchObject({ code: "board_manager_required" });
    const a = await createBoard("Board A"), b = await createBoard("Board B");
    const statuses = new ProjectStatuses(pool);
    const aDefault = (await statuses.list(admin)).find(row => row.board_id === a.id && row.is_default)!;
    const bDefault = (await statuses.list(admin)).find(row => row.board_id === b.id && row.is_default)!;
    expect(aDefault.id).not.toBe(bDefault.id);
    const first = await store.mutate(member, "create", null, { idempotency_key: randomUUID(), kind: "task", data: { title: "First board task", board_id: a.id } });
    const second = await store.mutate(member, "create", null, { idempotency_key: randomUUID(), kind: "task", data: { title: "Second board task", board_id: b.id } });
    const note = await store.mutate(member, "create", null, { idempotency_key: randomUUID(), kind: "note", data: { title: "Following note", parent_id: first.id } });
    expect(note.data.board_id).toBe(a.id);
    await expect(store.mutate(member, "update", first.id, { idempotency_key: randomUUID(), revision: first.revision, data: { status_id: bDefault.id } }))
      .rejects.toMatchObject({ code: "invalid_status" });
    const graph = new ProjectGraph(pool, store);
    const edge = await graph.create(member, { idempotency_key: randomUUID(), source_id: first.id, target_id: second.id, kind: "related" });
    const moved = await store.mutate(member, "update", first.id, { idempotency_key: randomUUID(), revision: first.revision, data: { board_id: b.id, status_id: bDefault.id } });
    expect(moved.id).toBe(first.id); expect((await store.get(member, note.id)).data.board_id).toBe(b.id);
    const archived = await store.mutate(admin, "update", b.id, { idempotency_key: randomUUID(), revision: b.revision, data: { archived: true } });
    expect((await store.list(member)).some(row => [first.id, second.id, note.id].includes(row.id))).toBe(false);
    await expect(store.get(member, first.id)).rejects.toMatchObject({ code: "board_archived" });
    expect((await graph.list(member)).some(row => row.id === edge.id)).toBe(false);
    expect((await statuses.list(member)).some(row => row.board_id === b.id)).toBe(false);
    expect((await store.list({ ...admin, projectSync: true })).some(row => row.id === first.id)).toBe(true);
    await store.mutate(admin, "update", b.id, { idempotency_key: randomUUID(), revision: archived.revision, data: { archived: false } });
    expect((await store.get(member, first.id)).id).toBe(first.id);
    expect((await graph.list(member)).some(row => row.id === edge.id)).toBe(true);
    await graph.remove(admin, edge.id);
  });
  it("links notes and resources without admitting them to task-only sync or dependencies", async () => {
    const graph = new ProjectGraph(pool, store);
    const create = (kind:string,title:string) => store.mutate(member,"create",null,{idempotency_key:randomUUID(),kind,data:{title}});
    const note=await create("note","Related note"), resource=await create("resource","Related resource"), task=await create("task","Related task");
    const input={idempotency_key:randomUUID(),source_id:note.id,target_id:resource.id,kind:"related"};
    const edge=await graph.create(member,input);
    expect((await graph.create(member,input)).id).toBe(edge.id);
    await graph.create(member,{...input,idempotency_key:randomUUID(),source_id:task.id});
    expect((await graph.list(member)).filter(e=>e.source_id===resource.id||e.target_id===resource.id)).toHaveLength(2);
    expect((await graph.list({...owner,projectSync:true},true)).some(e=>e.id===edge.id)).toBe(false);
    await expect(graph.create(member,{...input,idempotency_key:randomUUID(),kind:"depends_on"})).rejects.toMatchObject({code:"tasks_required"});
    await pool.query("UPDATE project_items SET data=jsonb_set(data,'{visibility}','\"internal\"') WHERE id=$1",[resource.id]);
    expect((await graph.list(member)).some(e=>e.id===edge.id)).toBe(false);
    await expect(graph.create(member,input)).rejects.toBeDefined();
  });
  it("keeps note ownership, validates resource homes, and detaches notes when a resource is archived", async () => {
    const create=(kind:string,title:string)=>store.mutate(member,"create",null,{idempotency_key:randomUUID(),kind,data:{title}});
    const note=await create("note","Attached note"), resource=await create("resource","Note home"), task=await create("task","Wrong home");
    const update=(item:typeof note,data:Record<string,unknown>,actor=member)=>store.mutate(actor,"update",item.id,{revision:item.revision,idempotency_key:randomUUID(),data});
    await expect(update(note,{resource_id:task.id})).rejects.toMatchObject({code:"invalid_resource_home"});
    await expect(update(task,{resource_id:resource.id})).rejects.toMatchObject({code:"invalid_resource_home"});
    await expect(update(note,{resource_id:resource.id},reviewer)).rejects.toBeDefined();
    const attached=await update(note,{resource_id:resource.id});
    expect(attached.data.resource_id).toBe(resource.id);
    expect(attached.author_id).toBe(member.id);
    await update(resource,{archived:true});
    const detached=await store.get(member,note.id);
    expect(detached.data.resource_id).toBeUndefined();
    expect(detached.revision).toBe(attached.revision+1);
    expect(detached.data.deleted).toBe(false);
    await expect(update(attached,{body:"stale"})).rejects.toMatchObject({code:"revision_conflict"});
  });
  it("adds accessible resource mentions as relations while ignoring inaccessible references", async () => {
    const graph=new ProjectGraph(pool,store);
    const resource=await store.mutate(member,"create",null,{idempotency_key:randomUUID(),kind:"resource",data:{title:"Mentioned"}});
    const hidden=await store.mutate(member,"create",null,{idempotency_key:randomUUID(),kind:"resource",data:{title:"Hidden"}});
    await pool.query("UPDATE project_items SET data=jsonb_set(data,'{visibility}','\"internal\"') WHERE id=$1",[hidden.id]);
    const note=await store.mutate(member,"create",null,{idempotency_key:randomUUID(),kind:"note",data:{title:"Mentions",body:`[Visible](#resource-${resource.id}) [Hidden](#resource-${hidden.id})`}});
    const links=(await graph.list(member)).filter(e=>e.source_id===note.id||e.target_id===note.id);
    expect(links).toHaveLength(1);
    expect([links[0]!.source_id,links[0]!.target_id]).toContain(resource.id);
    await graph.remove(member,links[0]!.id);
  });
  it("rejects private graph records for administrators and members", async () => {
    for (const actor of [owner, member]) {
      await expect(store.mutate(actor, "create", null, { idempotency_key: randomUUID(), kind: "task",
        data: { title: "Internal", visibility: "internal" } })).rejects.toMatchObject({ code: "shared_tasks_required" });
    }
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
    const first = await task("First"); const second = await task("Second");
    const requestId = randomUUID();
    const link = await graph.create(staff, { idempotency_key: requestId, source_id: first.id, target_id: second.id, kind: "depends_on" });
    expect((await graph.create(staff, { idempotency_key: requestId, source_id: first.id, target_id: second.id, kind: "depends_on" })).id).toBe(link.id);
    await expect(graph.create(staff, { idempotency_key: randomUUID(), source_id: second.id, target_id: first.id, kind: "depends_on" })).rejects.toMatchObject({ code: "dependency_cycle" });
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
  it("keeps imported historical comments off the fresh channel, including after edits", async () => {
    const actor = { ...owner, projectSync: true };
    const task = await store.mutate(actor, "create", null, { idempotency_key: randomUUID(), kind: "task", data: { title: "History" } });
    const comment = await store.mutate(actor, "create", null, { idempotency_key: randomUUID(), kind: "comment",
      sync_created_at: "2020-01-01T00:00:00Z", data: { title: "Old comment", body: "Retained", parent_id: task.id } });
    await store.mutate(actor, "update", comment.id, { idempotency_key: randomUUID(), revision: comment.revision, data: { body: "Edited old comment" } });
    const removed = await store.mutate(actor, "update", task.id, { idempotency_key: randomUUID(), revision: task.revision, data: { deleted: true } });
    await store.mutate(actor, "update", task.id, { idempotency_key: randomUUID(), revision: removed.revision, data: { deleted: false } });
    const collaboration = new CollaborationStore(pool);
    const channel = (await collaboration.listChannels(member)).find(row => row.primary)!;
    expect((await collaboration.listMessages(member, channel.id)).some(row => row.projectItemId === comment.id)).toBe(false);
    expect((await store.get(member, comment.id)).data.body).toBe("Edited old comment");
  });
  it("shares durable sticky positions and rejects stale moves", async () => {
    const note = await store.mutate(member, "create", null, { idempotency_key: randomUUID(), kind: "note", data: { title: "Sticky" } });
    await store.mutate(member, "update", note.id, { idempotency_key: randomUUID(), revision: note.revision, data: { position: { x: 40, y: 80 } } });
    expect((await store.get(reviewer, note.id)).data.position).toEqual({ x: 40, y: 80 });
    await expect(store.mutate(member, "update", note.id, { idempotency_key: randomUUID(), revision: note.revision, data: { position: { x: 10, y: 20 } } })).rejects.toMatchObject({ code: "revision_conflict" });
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
    expect((await request(app).get("/api/projects/members")).status).toBe(401);
    const people = await request(app).get("/api/projects/members").set("x-fixture-session", "member");
    expect(people.status).toBe(200);
    expect(people.body.actor).toEqual({ id: member.id });
    expect(people.body.members).toContainEqual({ id: member.id, display_name: member.displayName });
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
  it("reserves sync credentials for current project administrators", async () => {
    const app = express(); app.use(express.json());
    registerProjectRoutes(app, database, {} as ControlPlaneConfig, {
      active: async (req, res) => {
        if (req.get("x-fixture-session") === "member") return { user: member } as SessionActor;
        if (req.get("x-fixture-session") === "owner") return { user: owner } as SessionActor;
        res.sendStatus(401); return undefined;
      },
      csrf: req => req.get("x-fixture-csrf") === "valid", sameOrigin: (_req, _res, next) => next(),
    });
    const input = { name: "Mirror", scopes: ["project:read", "project:write", "project:sync"] };
    expect((await request(app).post("/api/projects/keys").set("x-fixture-session", "member")
      .set("x-fixture-csrf", "valid").send(input)).status).toBe(403);
    await pool.query("UPDATE users SET role='admin' WHERE id=$1", [owner.id]);
    try {
      const created = await request(app).post("/api/projects/keys").set("x-fixture-session", "owner")
        .set("x-fixture-csrf", "valid").send(input);
      expect(created.status).toBe(201);
      const token = created.body.token;
      expect((await request(app).get("/api/projects/sync/snapshot").auth(token, { type: "bearer" })).status).toBe(200);
      await pool.query("UPDATE users SET role='user' WHERE id=$1", [owner.id]);
      expect((await request(app).get("/api/projects/sync/snapshot").auth(token, { type: "bearer" })).status).toBe(403);
    } finally { await pool.query("UPDATE users SET role='user' WHERE id=$1", [owner.id]); }
  });
  it("rejects the old publication split on shared tasks", async () => {
    await expect(store.mutate({ ...owner, projectInternal: true }, "create", null,
      { idempotency_key: randomUUID(), kind: "task", data: { title: "Plan", publication: { published: false, title: "", body: "" } } }
    )).rejects.toMatchObject({ code: "shared_tasks_required" });
  });
  it("retires a status with revision checks and moves task state without losing task contents", async () => {
    const catalog = new ProjectStatuses(pool), manager = { ...owner, role: "admin" as const };
    const status = await catalog.save(manager, { revision: 0, data: { name: "QA", color: "teal", category: "doing", position: 20, is_default: false } });
    const task = await store.mutate(member, "create", null, { idempotency_key: randomUUID(), kind: "task", data: { title: "QA task", status_id: status.id } });
    const replacement = (await catalog.list()).find(row => !row.board_id && row.legacy_state === "waiting");
    await expect(catalog.save(member, { id: status.id, revision: status.revision, data: { ...status, name: "Changed" } })).rejects.toMatchObject({ status: 403 });
    const data = { name: status.name, color: status.color, category: status.category, position: status.position, is_default: false, retired: true, replacement_id: replacement.id };
    await catalog.save(manager, { id: status.id, revision: status.revision, data });
    await expect(catalog.save(manager, { id: status.id, revision: status.revision, data })).rejects.toMatchObject({ status: 409 });
    const moved = await store.get(member, task.id);
    expect(moved.data).toMatchObject({ title: "QA task", state: "waiting", status_id: replacement.id });
    expect(moved.revision).toBe(task.revision + 1);
  });
  it("rejects a stale sync link deletion after another member revives the link", async () => {
    const graph = new ProjectGraph(pool);
    const tasks = await Promise.all(["A", "B"].map(title => store.mutate(member, "create", null, { idempotency_key: randomUUID(), kind: "task", data: { title } })));
    const payload = { source_id: tasks[0]!.id, target_id: tasks[1]!.id, kind: "related" };
    const edge = await graph.create(member, { ...payload, idempotency_key: randomUUID() });
    await graph.remove(member, edge.id);
    const revived = await graph.create(member, { ...payload, idempotency_key: randomUUID() });
    expect(revived.revision).toBeGreaterThan(edge.revision);
    await expect(graph.remove({ ...owner, projectSync: true }, edge.id, edge.revision)).rejects.toMatchObject({ code: "revision_conflict" });
    expect((await graph.list(member)).some(row => row.id === edge.id)).toBe(true);
  });
  it("serves graph context only to a trusted runtime for a currently active member", async () => {
    const app = express(); app.use(express.json());
    registerProjectRoutes(app, database, { workspace: { controlToken: "fixture-runtime-token" } } as ControlPlaneConfig, {
      active: async () => undefined, csrf: () => false, sameOrigin: (_req, _res, next) => next(),
    });
    const body = { actorId: member.id };
    expect((await request(app).post("/internal/projects/read").send(body)).status).toBe(401);
    const result = await request(app).post("/internal/projects/read").auth("fixture-runtime-token", { type: "bearer" }).send(body);
    expect(result.status).toBe(200); expect(result.body.items.length).toBeGreaterThan(0);
    await pool.query("UPDATE users SET status='disabled' WHERE id=$1", [member.id]);
    try { expect((await request(app).post("/internal/projects/read").auth("fixture-runtime-token", { type: "bearer" }).send(body)).status).toBe(403); }
    finally { await pool.query("UPDATE users SET status='active' WHERE id=$1", [member.id]); }
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
