import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Database } from "../src/database.js";
import { loadConfig } from "../src/config.js";
import { SessionService } from "../src/sessions.js";
import { NativeExecutionAuthority } from "../src/nativeRuntime.js";
const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)("durable native execution leases", () => {
  const schema = `native_leases_${randomUUID().replaceAll("-", "")}`;
  let admin: Pool, pool: Pool, database: Database, sessions: SessionService;
  beforeAll(async () => {
    admin = new Pool({ connectionString: url }); await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
    database = new Database(pool); await database.migrate(); await database.migrate();
    const config = await loadConfig({ CONTROL_PLANE_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
      MCP_CONFIG_TOKEN: "native-fixture-mcp-token-at-least-32-characters", WORKSPACE_CONTROL_TOKEN: "native-fixture-control-token-at-least-32-characters", PGPASSWORD: "fixture" });
    sessions = new SessionService(database, config);
  });
  afterAll(async () => { await database?.close(); await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin?.end(); });
  it("keeps leases across authority restarts and revokes on owner generation, membership, expiry and logout", async () => {
    const user = await database.createLocalUser({ email: "lease-fixture@example.org", displayName: "Fixture", passwordHash: "fixture-only" });
    await pool.query("UPDATE users SET status='active' WHERE id=$1", [user.id]);
    await database.createSession({ tokenHash: "fixture-session", csrfHash: "fixture-csrf", userId: user.id,
      idleExpiresAt: new Date(Date.now() + 60000), absoluteExpiresAt: new Date(Date.now() + 60000) });
    const connection = randomUUID();
    await pool.query("INSERT INTO native_connections(id,scope,user_id,provider,method,label) VALUES($1,'personal',$2,'codex','subscription','Fixture')", [connection, user.id]);
    const actor = (await sessions.actorByTokenHash("fixture-session"))!;
    const authority = new NativeExecutionAuthority(database, sessions);
    const lease = await authority.issue(actor, { connection, model: "fixture-model" }, "turns.start");
    const restarted = new NativeExecutionAuthority(database, sessions);
    expect((await restarted.verify(lease)).actor).toBe(user.id);
    await pool.query("UPDATE native_connections SET generation=2 WHERE id=$1", [connection]);
    await expect(restarted.verify(lease)).rejects.toThrow("generation changed");
    await pool.query("UPDATE native_connections SET generation=1 WHERE id=$1", [connection]);
    await pool.query("UPDATE users SET status='disabled' WHERE id=$1", [user.id]);
    await expect(restarted.verify(lease)).rejects.toThrow("membership was revoked");
    await pool.query("UPDATE users SET status='active' WHERE id=$1", [user.id]);
    await pool.query("UPDATE native_execution_leases SET expires_at=now()-interval '1 second' WHERE id=$1", [lease]);
    await expect(restarted.verify(lease)).rejects.toThrow("expired");
    const second = await authority.issue(actor, { connection, model: "fixture-model" }, "turns.start");
    await database.deleteSession("fixture-session");
    await expect(restarted.verify(second)).rejects.toThrow("expired");
    expect((await pool.query("SELECT * FROM native_execution_leases")).rowCount).toBe(0);
  });
});
