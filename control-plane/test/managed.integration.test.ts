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
      .set("Origin", managed.portalOrigin).type("form").send({ handoff: "h".repeat(43), app: "projects" });
    expect(login.status).toBe(303);
    expect(login.headers.location).toBe("/workspace?app=projects");
    for (const cookie of login.headers["set-cookie"] as unknown as string[]) {
      expect(cookie).toContain("SameSite=None"); expect(cookie).toContain("Secure"); expect(cookie).toContain("Partitioned");
    }
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
});
