import { createHmac } from "node:crypto";
import { CollaborationStore } from "../src/collaboration.js";
import { registerManagedChat } from "../src/managedChat.js";
import { randomUUID } from "node:crypto";
import express from "express";
import { Pool } from "pg";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Database } from "../src/database.js";
import type { ControlPlaneConfig } from "../src/config.js";
import { bindAuthenticationMode, managedUserId, registerManagedRoutes } from "../src/managed.js";
import { SessionService } from "../src/sessions.js";

const integration = process.env.TEST_DATABASE_URL ? describe : describe.skip;
integration("managed identity database boundary", () => {
  let admin: Pool, database: Database, schema: string;
  const managed = { portalOrigin: "https://alshival.ai", workspace: "11111111-1111-4111-8111-111111111111",
    instance: "22222222-2222-4222-8222-222222222222", secret: "s".repeat(43) };
  const config = { managed, publicOrigin: new URL("https://fixture.alshival.cloud"), secureCookies: true,
    masterKey: Buffer.alloc(32, 5), workspace: { controlToken: "fixture-control-token" } } as ControlPlaneConfig;
  const { managed: _managed, ...standalone } = config;
  beforeEach(async () => {
    schema = "managed_test_" + randomUUID().replaceAll("-", "");
    admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await admin.query(`CREATE SCHEMA ${schema}`);
    database = new Database(new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}` }));
    await database.migrate();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await database.close();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });
  it("binds one identity authority and refuses instance or standalone conversion", async () => {
    await bindAuthenticationMode(database, config);
    await bindAuthenticationMode(database, config);
    await expect(bindAuthenticationMode(database, standalone)).rejects.toThrow();
    await expect(bindAuthenticationMode(database, { ...config, managed: { ...managed, instance: managed.workspace } })).rejects.toThrow();
  });
  it("never imports existing standalone users into managed identity", async () => {
    await database.createLocalUser({ email: "local@example.com", displayName: "Existing", passwordHash: "fixture" });
    await expect(bindAuthenticationMode(database, config)).rejects.toThrow("fresh identity database");
    await bindAuthenticationMode(database, standalone);
  });
  it("redeems a portal handoff, encrypts its grant, and rechecks roles and revocation", async () => {
    await bindAuthenticationMode(database, config);
    const actor = { subject: "123", email: "member@example.com", display_name: "Member", role: "admin",
      workspace: managed.workspace, instance: managed.instance, origin: config.publicOrigin!.origin,
      generation: 3, expires_at: new Date(Date.now() + 3600000).toISOString(), token: "g".repeat(43) };
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(actor));
    const app = express(); app.use(express.urlencoded({ extended: false })); app.use(express.json());
    const sessions = new SessionService(database, config);
    registerManagedRoutes(app, config, database, sessions);
    app.get("/probe", async (req, res) => { const current = await sessions.actor(req); res.status(current ? 200 : 401).json(current?.user ?? {}); });
    const login = await request(app).post("/auth/alshival/handoff").set("Host", config.publicOrigin!.host)
      .set("Origin", managed.portalOrigin).type("form").send({ handoff: "h".repeat(43) });
    expect(login.status).toBe(303);
    const cookie = (login.headers["set-cookie"] as unknown as string[]).map(value => value.split(";")[0]).join("; ");
    expect(cookie).toContain("__Host-neural-labs-session=");
    const stored = await database.pool.query("SELECT portal_grant FROM sessions");
    expect(stored.rows[0].portal_grant).not.toContain(actor.token);
    const id = managedUserId(managed, actor.subject);
    expect((await request(app).get("/probe").set("Cookie", cookie)).body).toMatchObject({ id, role: "admin" });
    actor.role = "user";
    expect((await request(app).get("/probe").set("Cookie", cookie)).body.role).toBe("user");
    fetcher.mockResolvedValue(new Response(null, { status: 403 }));
    expect((await request(app).get("/probe").set("Cookie", cookie)).status).toBe(401);
  });
  it("shares one channel and one run across retries, enforces channel access, and honors cancellation", async () => {
    const actor = { subject: "123", email: "member@example.com", display_name: "Member", role: "admin",
      workspace: managed.workspace, instance: managed.instance, origin: config.publicOrigin!.origin,
      generation: 3, expires_at: new Date(Date.now() + 3600000).toISOString() };
    const transport = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(actor));
    const app = express(); app.use(express.json());
    const store = new CollaborationStore(database.pool), publish = vi.fn(), enqueue = vi.fn(), cancel = vi.fn();
    registerManagedChat(app, config, database, store, publish, enqueue, cancel);
    const call = (operation: string, params: Record<string, unknown> = {}) => {
      const payload = JSON.stringify({ token: "t".repeat(43), operation, ...params });
      const stamp = String(Math.floor(Date.now() / 1000));
      const signature = createHmac("sha256", managed.secret).update(`chat\n${stamp}\n${payload}`).digest("hex");
      return request(app).post("/api/alshival/chat-bridge").set("X-Neural-Labs-Time", stamp)
        .set("X-Neural-Labs-Signature", signature).send({ payload });
    };
    const requestId = randomUUID();
    const created = await Promise.all([call("create", { requestId }), call("create", { requestId })]);
    expect(created.map(result => result.status)).toEqual([200, 200]);
    expect(created[0]!.body.channel.id).toBe(created[1]!.body.channel.id);
    const channel = created[0]!.body.channel.id;
    const message = { channel, requestId: randomUUID(), body: "@Alshival check the shared file" };
    const sent = await Promise.all([call("send", message), call("send", message)]);
    expect(sent.map(result => result.status)).toEqual([200, 200]);
    expect(enqueue).toHaveBeenCalledTimes(1);
    const original = (await call("history", { channel })).body;
    expect(original.messages.filter((row: { authorKind: string }) => row.authorKind === "user")).toHaveLength(1);
    expect((await call("send", { ...message, body: "different" })).status).toBe(409);
    await call("cancel", { channel });
    expect(cancel).toHaveBeenCalledWith(enqueue.mock.calls[0]![0].id);
    expect((await call("history", { channel })).body.run.status).toBe("failed");
    expect(await store.claimRun(enqueue.mock.calls[0]![0].id)).toBeUndefined();
    transport.mockResolvedValue(new Response(null, { status: 403 }));
    const revoked = await call("history", { channel });
    expect(revoked.status).toBe(503);
    expect(revoked.body.messages).toBeUndefined();
  });

  it("imports only bound shared history once, preserves authors and does not activate former members", async () => {
    const identity = { subject: "123", email: "current@example.com", display_name: "Current", role: "admin",
      workspace: managed.workspace, instance: managed.instance, origin: config.publicOrigin!.origin,
      generation: 3, expires_at: new Date(Date.now() + 3600000).toISOString() };
    const source = randomUUID();
    const history = { workspace: managed.workspace, instance: managed.instance, generation: 3,
      id: source, name: "Shared archive", users: [{ subject: "old", email: "former@example.com", display_name: "Former member" }],
      messages: [{ role: "user", subject: "old", body: "  Original spacing  ", createdAt: "2026-01-01T12:00:00Z",
        attachments: [{ path: "notes.txt", name: "notes.txt", size: 5 }] },
        { role: "assistant", body: "Original answer", createdAt: "2026-01-01T12:00:01Z", attachments: [] }] };
    const transport = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) =>
      Response.json(String(url).includes("shared-history") ? history : identity));
    const app = express(); app.use(express.json());
    const store = new CollaborationStore(database.pool), enqueue = vi.fn();
    registerManagedChat(app, config, database, store, vi.fn(), enqueue, vi.fn());
    const call = (sourceConversation = source) => {
      const payload = JSON.stringify({ token: "t".repeat(43), operation: "import", sourceConversation });
      const stamp = String(Math.floor(Date.now() / 1000));
      return request(app).post("/api/alshival/chat-bridge").set("X-Neural-Labs-Time", stamp)
        .set("X-Neural-Labs-Signature", createHmac("sha256", managed.secret).update(`chat\n${stamp}\n${payload}`).digest("hex")).send({ payload });
    };
    const first = await call();
    expect(first.status).toBe(200);
    expect(first.body.messages[1]).toMatchObject({ body: "  Original spacing  ", author: { displayName: "Former member" },
      createdAt: "2026-01-01T12:00:00.000Z", attachments: history.messages[0]!.attachments });
    identity.subject = "124"; identity.email = "other@example.com";
    const again = await call();
    expect(again.status).toBe(200);
    expect(again.body.channel.id).toBe(first.body.channel.id);
    expect((await database.pool.query("SELECT status FROM users WHERE id=$1", [managedUserId(managed, "old")])).rows[0].status).toBe("disabled");
    expect(enqueue).not.toHaveBeenCalled();
    history.workspace = randomUUID();
    expect((await call()).status).toBe(503);
    transport.mockResolvedValue(new Response(null, { status: 403 }));
    expect((await call(randomUUID())).status).toBe(503);
    expect((await database.pool.query("SELECT count(*)::int AS n FROM team_channels")).rows[0].n).toBe(1);
  });

});
