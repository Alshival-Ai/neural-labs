import express from "express";
import request from "supertest";
import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { CredentialCipher } from "../src/crypto.js";
import { registerNativeRuntime } from "../src/nativeRuntime.js";
import type { Database } from "../src/database.js";
import type { SessionService } from "../src/sessions.js";
import type { SessionActor } from "../src/types.js";
import type { ControlPlaneConfig } from "../src/config.js";

afterEach(() => vi.unstubAllGlobals());
it("managed MCP binds requests to the originating portal session and denies revocation", async () => {
  const lease = randomUUID(), masterKey = Buffer.alloc(32, 9);
  let active = true, gate = false;
  const actor = { user: { id: "alice", role: "user", status: "active" }, session: { tokenHash: "alice-session" } } as SessionActor;
  const query = vi.fn(async (sql: string, args?: unknown[]) => {
    if (sql.includes("SELECT gate")) return { rows: [{ gate }], rowCount: 1 };
    if (sql.startsWith("SELECT * FROM native_execution_leases")) return { rows: args?.[0] === lease ? [{
      actor_id: "alice", session_hash: "alice-session", connection_id: "provider", generation: 1, purpose: "turns.start",
    }] : [], rowCount: 1 };
    if (sql.startsWith("SELECT * FROM native_connections")) return { rows: [{
      id: "provider", scope: "personal", user_id: "alice", enabled: true, generation: 1,
    }], rowCount: 1 };
    if (sql.includes("SELECT s.portal_grant")) {
      expect(args).toEqual([lease, "alice"]);
      return { rows: [{ portal_grant: new CredentialCipher(masterKey).encrypt({ token: "fixture-portal-session" }) }], rowCount: 1 };
    }
    return { rows: [{ id: lease }], rowCount: 1 };
  });
  const config = { masterKey, managed: { secret: "fixture-hmac-secret", instance: randomUUID(), portalOrigin: "https://portal.example.test" } } as ControlPlaneConfig;
  const transport = vi.fn(async (_url, init) => {
    expect(JSON.parse(init.body)).toEqual({ token: "fixture-portal-session", method: "tools/list", params: {} });
    return Response.json({ tools: [{ name: "project_read" }] });
  }); vi.stubGlobal("fetch", transport);
  const app = express(); app.use(express.json());
  registerNativeRuntime(app, { pool: { query } } as unknown as Database,
    { actorByTokenHash: async (hash: string) => { expect(hash).toBe("alice-session"); return active ? actor : undefined; } } as SessionService,
    config, { sameOrigin: (_req, _res, next) => next(), active: async () => actor, csrf: () => true });
  const invoke = (id = lease) => request(app).post("/internal/native/alshival-mcp").set("Authorization", `Bearer ${id}`)
    .send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  const response = await invoke().expect(200);
  expect(response.body.result.tools[0].name).toBe("project_read");
  expect(JSON.stringify(response.body)).not.toContain("fixture-portal-session");
  await invoke(randomUUID()).expect(403);
  active = false; await invoke().expect(403);
  active = true; gate = true; await invoke().expect(503);
  expect(transport).toHaveBeenCalledTimes(1);
});
