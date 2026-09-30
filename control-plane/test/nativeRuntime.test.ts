import { describe, it, expect, vi } from "vitest";
import type { Database } from "../src/database.js";
import type { SessionService } from "../src/sessions.js";
import type { SessionActor } from "../src/types.js";
import { NativeExecutionAuthority } from "../src/nativeRuntime.js";

function fixture() {
  const actor = { user: { id: "member", role: "user", status: "active" }, session: { tokenHash: "session-hash" } } as SessionActor;
  const connection = { id: "connection", scope: "personal", user_id: "member", enabled: true, generation: 1, provider: "codex", method: "subscription" };
  const lease = { actor_id: "member", session_hash: "session-hash", connection_id: "connection", generation: 1, model: "fixture", purpose: "turns.start" };
  const query = vi.fn(async (sql: string, _args?: unknown[]) => ({ rows: sql.startsWith("SELECT * FROM native_connections") ? [connection]
    : sql.startsWith("SELECT * FROM native_execution_leases") ? [lease] : [{ id: "lease" }], rowCount: 1 }));
  const sessions = { actorByTokenHash: vi.fn(async () => actor as SessionActor | undefined) };
  const authority = new NativeExecutionAuthority({ pool: { query } } as unknown as Database, sessions as unknown as SessionService);
  return { actor, connection, lease, query, sessions, authority };
}
describe("native execution authority", () => {
  it("never infers a shared connection and denies another person's credentials", async () => {
    const f = fixture();
    f.connection.user_id = "other";
    await expect(f.authority.issue(f.actor, { connection: "connection", model: "fixture" }, "turns.start")).rejects.toThrow("unavailable");
    f.connection.scope = "shared"; f.connection.user_id = "";
    await expect(f.authority.issue(f.actor, { connection: "connection", model: "fixture" }, "turns.start")).resolves.toMatch(/^[a-f0-9-]{36}$/);
    for (const operation of ["account.login", "account.submit", "account.cancel", "account.verify"])
      await expect(f.authority.issue(f.actor, { connection: "connection", model: "fixture" }, operation)).rejects.toThrow("unavailable");
    await expect(f.authority.issue(f.actor, { connection: "connection", model: "fixture" }, "account.status")).resolves.toBeTruthy();
  });
  it("rechecks the originating session and credential generation on every lease renewal", async () => {
    const f = fixture();
    const result = await f.authority.verify("lease");
    expect(result.binding).toEqual({ owner: "connection", provider: "codex", generation: 1, method: "subscription" });
    expect(f.sessions.actorByTokenHash).toHaveBeenCalledWith("session-hash");
    f.connection.generation++;
    await expect(f.authority.verify("lease")).rejects.toThrow("generation changed");
    f.connection.generation--; f.sessions.actorByTokenHash.mockResolvedValue(undefined);
    await expect(f.authority.verify("lease")).rejects.toThrow("membership was revoked");
  });
  it("binds explicit no-prompt choice to an authenticated chat lease without expanding its sandbox", async () => {
    const f = fixture();
    await f.authority.issue(f.actor, { connection: "connection", model: "fixture" }, "turns.start", "never");
    expect(f.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO native_execution_leases"))?.[1]?.[6]).toBe("turns.start:no-prompt");
    f.lease.purpose = "turns.start:no-prompt";
    expect((await f.authority.verify("lease")).policy).toEqual({ sandbox: "workspace-write", approval: "never" });
    f.connection.generation++;
    await expect(f.authority.verify("lease")).rejects.toThrow("generation changed");
    await expect(f.authority.issue(f.actor, { connection: "connection", model: "fixture" }, "jobs.run", "never")).rejects.toThrow("personal chat turns");
  });
  it("does not use a background or team connection as personal fallback", async () => {
    const f = fixture();
    for (const scope of ["team", "background"]) {
      f.connection.scope = scope;
      await expect(f.authority.verify("lease")).rejects.toThrow("unavailable");
    }
    f.connection.scope = "personal"; f.connection.enabled = false;
    await expect(f.authority.verify("lease")).rejects.toThrow("paused");
  });
  it("allows administrators to explicitly select background accounts for review without permitting personal turns", async () => {
    const f = fixture(); f.connection.scope = "background"; f.actor.user.role = "admin";
    expect(await f.authority.issue(f.actor, { connection: "connection", model: "fixture" }, "jobs.review")).toBeTruthy();
    await expect(f.authority.issue(f.actor, { connection: "connection", model: "fixture" }, "turns.start")).rejects.toThrow("unavailable");
    f.actor.user.role = "user";
    await expect(f.authority.issue(f.actor, { connection: "connection", model: "fixture" }, "jobs.review")).rejects.toThrow("unavailable");
  });
});
