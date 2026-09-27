import { createHmac } from "node:crypto";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { managedConfig, managedUserId, portalCall, registerManagedRoutes } from "../src/managed.js";
import type { ControlPlaneConfig } from "../src/config.js";
import type { Database } from "../src/database.js";
import type { SessionService } from "../src/sessions.js";

const managed = {
  portalOrigin: "https://alshival.ai", workspace: "11111111-1111-4111-8111-111111111111",
  instance: "22222222-2222-4222-8222-222222222222", secret: "x".repeat(43),
};
const config = { managed, publicOrigin: new URL("https://fixture.alshival.cloud") } as ControlPlaneConfig;
const actor = { subject: "123", email: "fixture@example.com", display_name: "Fixture", role: "user",
  workspace: managed.workspace, instance: managed.instance, origin: config.publicOrigin!.origin,
  generation: 1, expires_at: new Date(Date.now() + 3600000).toISOString() };

describe("Alshival managed authentication", () => {
  it("defaults standalone and rejects incomplete managed configuration", () => {
    expect(managedConfig({})).toBeUndefined();
    expect(() => managedConfig({ NEURAL_LABS_AUTH_MODE: "other" })).toThrow();
    expect(() => managedConfig({ NEURAL_LABS_AUTH_MODE: "alshival" })).toThrow();
    expect(() => managedConfig({ NEURAL_LABS_AUTH_MODE: "alshival", NEURAL_LABS_PORTAL_ORIGIN: "http://alshival.ai" })).toThrow();
  });
  it("uses stable workspace-scoped identity, never email", () => {
    expect(managedUserId(managed, "123")).toBe(managedUserId(managed, "123"));
    expect(managedUserId(managed, "124")).not.toBe(managedUserId(managed, "123"));
    expect(managedUserId({ ...managed, workspace: "other" }, "123")).not.toBe(managedUserId(managed, "123"));
  });
  it("signs requests and validates response bindings and expiry", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json(actor));
    await expect(portalCall(config, "authorize", "session-token", transport)).resolves.toMatchObject(actor);
    const [url, init] = transport.mock.calls[0]!;
    expect(url).toBe(`${managed.portalOrigin}/workspaces/neural-labs/instances/${managed.instance}/authorize/`);
    const headers = init!.headers as Record<string, string>;
    expect(headers["X-Neural-Labs-Signature"]).toBe(createHmac("sha256", managed.secret)
      .update(`${managed.instance}\nauthorize\n${headers["X-Neural-Labs-Time"]}\n${init!.body}`).digest("hex"));
    expect(init!.redirect).toBe("error");
    for (const change of [{ workspace: managed.instance }, { instance: managed.workspace }, { origin: "https://other.alshival.cloud" },
      { expires_at: "2000-01-01T00:00:00Z" }]) {
      transport.mockResolvedValueOnce(Response.json({ ...actor, ...change }));
      await expect(portalCall(config, "authorize", "token", transport)).rejects.toThrow();
    }
    transport.mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(portalCall(config, "authorize", "token", transport)).rejects.toThrow();
  });
  it("blocks local identity mutations and redirects browser login", async () => {
    const app = express(); app.use(express.urlencoded({ extended: false }));
    registerManagedRoutes(app, config, {} as Database, {} as SessionService);
    for (const path of ["/api/auth/local/signup", "/api/auth/local/login", "/api/account/identities/local",
      "/api/account/passkeys/registration/verify", "/api/admin/users/123", "/api/admin/authentication", "/api/admin/updates/install", "/setup"]) {
      expect((await request(app).post(path)).status).toBe(403);
    }
    const result = await request(app).get("/login");
    expect(result.status).toBe(303);
    expect(result.headers.location).toBe(`https://alshival.ai/workspaces/${managed.workspace}/neural-labs/`);
    expect((await request(app).get("/api/auth/providers")).body.local.enabled).toBe(false);
    expect((await request(app).post("/auth/alshival/handoff").set("Origin", "https://attacker.test").send({ handoff: "x".repeat(43) })).status).toBe(403);
  });
});

describe("managed tool trust boundary", () => {
  it("never converts a claimed agent ID into a user's personal grant", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ tools: [] }));
    try {
      const app = express(); app.use(express.json());
      const query = vi.fn();
      registerManagedRoutes(app, { ...config, workspace: { controlToken: "fixture-control-token" } } as ControlPlaneConfig,
        { pool: { query } } as unknown as Database, {} as SessionService);
      for (const agentId of ["main", "nl-" + "a".repeat(32)]) {
        const result = await request(app).post("/internal/alshival/tools")
          .set("Authorization", "Bearer fixture-control-token").send({ agentId, method: "tools/list" });
        expect(result.status).toBe(200);
        const [url, init] = fetcher.mock.calls.at(-1)!;
        expect(String(url)).toContain("/background-tools/");
        expect(JSON.parse(String(init?.body))).toEqual({ method: "tools/list", params: {} });
      }
      expect(query).not.toHaveBeenCalled();
      expect((await request(app).post("/internal/alshival/tools").set("Authorization", "Bearer wrong")
        .send({ agentId: "main", method: "tools/list" })).status).toBe(401);
    } finally { fetcher.mockRestore(); }
  });
  it("personal tools require both a live browser session and CSRF", async () => {
    const app = express(); app.use(express.json());
    const actor = vi.fn().mockResolvedValue(undefined);
    registerManagedRoutes(app, config, {} as Database, { actor } as unknown as SessionService);
    expect((await request(app).post("/api/alshival/tools").set("Host", config.publicOrigin!.host)
      .set("Origin", config.publicOrigin!.origin).send({ method: "tools/list" })).status).toBe(403);
    expect(actor).toHaveBeenCalledOnce();
    expect((await request(app).post("/api/alshival/tools").set("Origin", "https://untrusted.example")
      .send({ method: "tools/list" })).status).toBe(403);
    expect(actor).toHaveBeenCalledOnce();
  });
});
