import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { CollaborationStore } from "../src/collaboration.js";
import type { UserRecord } from "../src/types.js";
import { Database } from "../src/database.js";
import { UpdateService, defaultUpdatePolicy } from "../src/updates.js";
const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)("update persistence and cutover coordination", () => {
  const schema = `updates_${randomUUID().replaceAll("-", "")}`;
  let admin: Pool, pool: Pool, db: Database, updates: UpdateService, actor: string;
  const available = { id: "workspace-v2026.9.5", image: `ghcr.io/alshival-ai/neural-labs-workspace@sha256:${"a".repeat(64)}`,
    openclawVersion: "2026.9.5", codexVersion: "0.155.1", appServerVersion: "0.154.0", sourceRevision: "b".repeat(40),
    notesUrl: "https://github.com/Alshival-Ai/neural-labs/releases/tag/workspace-v2026.9.5", manualRequired: false, reason: "" };
  beforeAll(async () => {
    admin = new Pool({ connectionString: url }); await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` }); db = new Database(pool); await db.migrate();
    updates = new UpdateService(pool, true);
    actor = (await db.createLocalUser({ email: "updater@example.org", displayName: "Update test", passwordHash: "synthetic" })).id;
  });
  afterAll(async () => { await db?.close(); await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin?.end(); });
  it("imports the environment once and rejects stale revisions with an audit trail", async () => {
    const initial = await updates.policy(); expect(initial.policy.codexAutomatic).toBe(true); expect(initial.policy.openclawAutomatic).toBe(false);
    await updates.save(initial.revision, { ...defaultUpdatePolicy, codexAutomatic: false }, actor);
    expect((await new UpdateService(pool, true).policy()).policy.codexAutomatic).toBe(false);
    await expect(updates.save(initial.revision, initial.policy, actor)).rejects.toMatchObject({ status: 409 });
    expect((await pool.query("SELECT action FROM audit_log WHERE action='updates.policy_saved'")).rows).toHaveLength(1);
  });
  it("serializes requests, gates through recovery, and accepts terminal-report replay", async () => {
    await updates.report({ available });
    const jobs = await Promise.all([updates.enqueue("install", actor), updates.enqueue("install", actor)]);
    expect(jobs[0]!.id).toBe(jobs[1]!.id);
    const id = jobs[0]!.id;
    for (const phase of ["preparing", "ready", "maintenance", "updating", "verifying", "restoring", "activating", "restored"] as const) {
      await updates.report({ job: { id, phase, message: "Synthetic update" } });
      expect((await updates.maintenance()).maintenance).toBe(["maintenance", "updating", "verifying", "restoring"].includes(phase));
    }
    await updates.report({ job: { id, phase: "restored", message: "Replay" } });
    await expect(updates.enqueue("automatic", null)).rejects.toMatchObject({ code: "release_held" });
  });
  it("waits for database admission and refuses late chat writes even after disconnect", async () => {
    const { id } = await updates.enqueue("install", actor);
    for (const phase of ["preparing", "ready"] as const) await updates.report({ job: { id, phase, message: "Ready" } });
    const writer = await pool.connect();
    try {
      await writer.query("BEGIN");
      await writer.query("SELECT gate FROM update_runtime WHERE singleton FOR SHARE");
      const pending = updates.report({ job: { id, phase: "maintenance", message: "Gate" } });
      expect(await Promise.race([pending.then(() => "entered"), new Promise(resolve => setTimeout(() => resolve("blocked"), 30))])).toBe("blocked");
      await writer.query("COMMIT"); await pending;
    } finally { writer.release(); }
    await expect(new CollaborationStore(pool).postMessage({ id: actor } as UserRecord, { channelId: randomUUID(), body: "Late chat", attachments: [], clientRequestId: randomUUID() })).rejects.toMatchObject({ code: "workspace_maintenance" });
    for (const phase of ["restoring", "activating", "restored"] as const) await updates.report({ job: { id, phase, message: "Restored" } });
  });
  it("atomically refuses automatic cutover after the administrator disables it", async () => {
    await updates.report({ available: { ...available, id: "workspace-v2026.9.6" } });
    const { id } = await updates.enqueue("automatic", null);
    await updates.report({ job: { id, phase: "preparing", message: "Preparing" } });
    await updates.report({ job: { id, phase: "ready", message: "Ready" } });
    await expect(updates.report({ job: { id, phase: "maintenance", message: "Enter maintenance" } })).rejects.toMatchObject({ code: "automatic_disabled" });
    expect((await updates.maintenance()).maintenance).toBe(false);
    await updates.report({ job: { id, phase: "failed", message: "Admission declined" } });
  });
  it("never permits rollback after the commit decision and retains the gate on failed recovery", async () => {
    const { id } = await updates.enqueue("install", actor);
    for (const phase of ["preparing", "ready", "maintenance", "updating", "verifying", "committing"] as const) await updates.report({ job: { id, phase, message: "Synthetic update" } });
    await expect(updates.report({ job: { id, phase: "restoring", message: "Unsafe rewind" } })).rejects.toMatchObject({ code: "invalid_transition" });
    await updates.report({ job: { id, phase: "recovery_required", message: "Closed" } });
    expect((await updates.maintenance()).maintenance).toBe(true);
    await expect(updates.enqueue("install", actor)).rejects.toMatchObject({ code: "maintenance_active" });
    expect((await updates.workerState()).protocol).toBe(1);
  });
});
