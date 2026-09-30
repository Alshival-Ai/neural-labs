import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { registerNativeRuntime } from "../src/nativeRuntime.js";
import type { Database } from "../src/database.js";
import type { SessionService } from "../src/sessions.js";
import type { SessionActor } from "../src/types.js";
import type { ControlPlaneConfig } from "../src/config.js";

const run = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const approval = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("native Team permission review", () => {
  it("shows and resolves a live Team permission only for an administrator", async () => {
    const actor = { user: { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", role: "user", status: "active" } } as SessionActor;
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM team_agent_runs WHERE id=$1")) return { rows: [{ id: run }], rowCount: 1 };
      throw new Error(`Unexpected query ${sql}`);
    });
    const audit = vi.fn(async () => {});
    const fetchFn = vi.fn(async (_url: unknown, init: RequestInit) => new Response(JSON.stringify(
      JSON.parse(String(init.body)).operation === "read" ? { approvals: [{ id: approval, request: { method: "command" } }] } : { ok: true }),
    { headers: { "Content-Type": "application/json" } }));
    const app = express(); app.use(express.json());
    registerNativeRuntime(app, { pool: { query }, audit } as unknown as Database, {} as SessionService,
      { workspace: { controlToken: "private-workspace-token", controlUrl: "http://workspace:18790" } } as unknown as ControlPlaneConfig,
      { sameOrigin: (_req, _res, next) => next(), active: async () => actor, csrf: () => true, fetch: fetchFn as typeof fetch });
    await request(app).get(`/api/admin/runtime/team-approvals/${run}`).expect(403);
    await request(app).post(`/api/admin/runtime/team-approvals/${run}/${approval}`).send({ decision: "accept" }).expect(403);
    expect(fetchFn).not.toHaveBeenCalled();
    actor.user.role = "admin";
    const pending = await request(app).get(`/api/admin/runtime/team-approvals/${run}`).expect(200);
    expect(pending.body.approvals).toHaveLength(1);
    await request(app).post(`/api/admin/runtime/team-approvals/${run}/${approval}`).send({ decision: "accept" }).expect(200);
    expect(audit).toHaveBeenCalledWith(actor.user.id, "team.native_approval.resolved", run,
      { approval, decision: "accept" });
  });
});
