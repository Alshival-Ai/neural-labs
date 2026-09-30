import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { registerNativeRuntime } from "../src/nativeRuntime.js";
import type { Database } from "../src/database.js";
import type { SessionService } from "../src/sessions.js";
import type { ControlPlaneConfig } from "../src/config.js";
import type { SessionActor } from "../src/types.js";

const member = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const account = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const team = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function fixture() {
  const actor = { user: { id: member, role: "user", status: "active" } } as SessionActor;
  const defaults = new Map<string, { connection: string; generation: number; model: string; revision: number }>();
  const query = vi.fn(async (sql: string, args: unknown[] = []) => {
    if (sql.includes("FROM native_connections WHERE id=$1 AND generation=$2")) {
      const valid = args[0] === (args[2] ? team : account) && args[1] === (args[2] ? 2 : 1);
      return { rows: valid ? [{ id: args[0] }] : [], rowCount: valid ? 1 : 0 };
    }
    if (sql.includes("FROM native_chat_defaults WHERE selection_key=$1")) {
      const row = defaults.get(String(args[0]));
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.startsWith("INSERT INTO native_chat_defaults")) {
      const key = String(args[0]);
      if (defaults.has(key)) return { rows: [], rowCount: 0 };
      const row = { connection: String(args[2]), generation: Number(args[3]), model: String(args[4]), revision: 1 };
      defaults.set(key, row); return { rows: [row], rowCount: 1 };
    }
    if (sql.startsWith("UPDATE native_chat_defaults SET")) {
      const key = String(args[0]), old = defaults.get(key);
      if (!old || old.revision !== args[5]) return { rows: [], rowCount: 0 };
      const row = { connection: String(args[2]), generation: Number(args[3]), model: String(args[4]), revision: old.revision + 1 };
      defaults.set(key, row); return { rows: [row], rowCount: 1 };
    }
    throw new Error(`Unexpected database query: ${sql}`);
  });
  const database = { pool: { query }, audit: vi.fn(async () => {}) } as unknown as Database;
  const app = express(); app.use(express.json());
  registerNativeRuntime(app, database, {} as SessionService, { workspace: { controlToken: "fixture-private-token" } } as ControlPlaneConfig,
    { sameOrigin: (_req, _res, next) => next(), active: async () => actor, csrf: () => true });
  return { app, actor, defaults, query };
}

describe("native chat defaults", () => {
  it("keeps Team selection administrator-only and rejects another scope or stale generation", async () => {
    const f = fixture();
    const input = { connection: team, generation: 2, model: "claude-team", revision: 0 };
    await request(f.app).put("/api/admin/runtime/team-defaults").send(input).expect(403);
    await request(f.app).put("/api/runtime/defaults").send(input).expect(403);
    f.actor.user.role = "admin";
    await request(f.app).put("/api/admin/runtime/team-defaults").send({ ...input, generation: 1 }).expect(403);
    const saved = await request(f.app).put("/api/admin/runtime/team-defaults").send(input).expect(200);
    expect(saved.body.selection).toMatchObject({ connection: team, generation: 2, model: "claude-team" });
    expect(f.defaults.has("workspace:team")).toBe(true);
    await request(f.app).put("/api/admin/runtime/team-defaults").send(input).expect(409);
  });

  it("stores a member's explicit personal selection separately from the Team default", async () => {
    const f = fixture();
    const input = { connection: account, generation: 1, model: "gpt-fixture", revision: 0 };
    await request(f.app).put("/api/runtime/defaults").send(input).expect(200);
    expect((await request(f.app).get("/api/runtime/defaults").expect(200)).body.selection).toMatchObject({ ...input, revision: 1 });
    expect((await request(f.app).get("/api/admin/runtime/team-defaults").expect(403)).body.error).toBeTruthy();
    expect(f.defaults.has(`user:${member}`)).toBe(true);
  });
});
