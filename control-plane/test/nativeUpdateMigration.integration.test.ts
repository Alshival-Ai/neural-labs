import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { describe, it, expect } from "vitest";
import { migrations } from "../src/migrations.js";
import { updatePolicySchema, workerReportSchema } from "../src/updates.js";

const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)("native updater policy migration", () => {
  it("preserves prior choices and reports, and refuses to interrupt a release", async () => {
    const schema = `native_updates_${randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
    try {
      for (const migration of migrations.filter(value => value.version < 18)) await pool.query(migration.sql);
      const policy = { openclawAutomatic: true, codexAutomatic: true, days: [1, 3], start: "02:00", end: "04:00", timezone: "Europe/London" };
      const installed = { openclawVersion: "2026.9.5", codexVersion: "0.155.1", image: "sha256:" + "a".repeat(64) };
      await pool.query("INSERT INTO update_policy(singleton,policy) VALUES(true,$1)", [policy]);
      await pool.query("UPDATE update_runtime SET installed=$1,gate=true WHERE singleton", [installed]);
      const migration = migrations.find(value => value.version === 18)!;
      await expect(pool.query(migration.sql)).rejects.toThrow("Finish the active workspace update");
      expect((await pool.query("SELECT policy FROM update_policy")).rows[0].policy).toEqual(policy);
      await pool.query("INSERT INTO audit_log(action,metadata) VALUES('updates.native_managed_operator_started',$1)",
        [{ release: "b".repeat(40), workspace: randomUUID(), runtime: randomUUID() }]);
      await pool.query(migration.sql);
      expect((await pool.query("SELECT policy FROM update_policy")).rows[0].policy).toEqual(policy);
      const saved = (await pool.query("SELECT policy,revision FROM native_update_policy")).rows[0];
      expect(updatePolicySchema.parse(saved.policy)).toEqual({ runtimeAutomatic: true, days: policy.days, start: policy.start, end: policy.end, timezone: policy.timezone });
      const audit = (await pool.query("SELECT action,metadata FROM audit_log WHERE action LIKE 'updates.%'")).rows;
      expect(audit.find(row => row.action === "updates.native_policy_migration")?.metadata.policy).toEqual(policy);
      expect(audit.find(row => row.action === "updates.retained_legacy_runtime")?.metadata.installed).toEqual(installed);
      const runtime = (await pool.query("SELECT installed,available,heartbeat,gate FROM update_runtime")).rows[0];
      expect(runtime).toEqual({ installed: null, available: null, heartbeat: null, gate: true });
      expect(workerReportSchema.safeParse({ installed }).success).toBe(false);
      expect(workerReportSchema.safeParse({ installed: { image: installed.image, runtimeVersion: "1.0.0", codexVersion: "0.155.1", claudeVersion: "2.1.226" } }).success).toBe(true);
    } finally {
      await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
    }
  });
});
