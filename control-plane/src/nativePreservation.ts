import type { Pool } from "pg";
import { createHash } from "node:crypto";

const tables = ["notification_preferences", "automation_subscriptions", "notification_config",
  "notification_run_summaries", "notification_events", "notification_deliveries"] as const;
type Row = Record<string, unknown>;
export type PreservationRecords = Record<string, Array<{ key: string; value: Row }>>;

// Operator-only snapshot primitive; intentionally has no HTTP route. Credentials
// remain encrypted in PostgreSQL. This function neither sends nor resets data.
export async function snapshotNativePreservation(pool: Pool): Promise<PreservationRecords> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result: PreservationRecords = {};
    for (const table of tables) {
      const { rows } = await client.query<Row>(`SELECT * FROM ${table}`);
      result[table] = rows.map(row => {
        // Normalize timestamptz Date objects and PostgreSQL JSON into portable
        // JSON. A content key retains duplicate-looking state without inventing
        // an unstable row index; these tables already have unique primary keys.
        const value = JSON.parse(JSON.stringify(row)) as Row;
        return { key: createHash("sha256").update(JSON.stringify(value)).digest("hex"), value };
      });
    }
    const users = await client.query<Row>("SELECT id,role,status FROM users ORDER BY id");
    const policies = await client.query<Row>("SELECT policy_key,user_id,revision,policy,resolved,applied_revision FROM model_provider_policies ORDER BY policy_key");
    result.ownership = [
      ...users.rows.map(row => ({ key: `user:${String(row.id)}`, value: { kind: "user", ...row } })),
      ...policies.rows.map(row => ({ key: `policy:${String(row.policy_key)}`, value: { kind: "model-policy", ...row } })),
    ];
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

function normalized(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, normalized(child)]));
  return value;
}
function stateDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(normalized(value))).digest("hex");
}

// Explicit operator step, never an ordinary schema migration or an HTTP route.
// The caller obtains expectedRecords from the same-workspace drained export.
// A customer must supply its own reset policy; it never inherits pilot consent.
export async function prepareNativeChatReset(pool: Pool, input: {
  workspace: string; expectedWorkspace: string; migration: string;
  chatResetPolicy: "preserve" | "reset-team-pilot" | "separately-authorized-reset";
  expectedRecords: PreservationRecords;
}) {
  if (input.workspace !== input.expectedWorkspace || !/^[a-f0-9-]{36}$/.test(input.workspace)
      || !/^[a-f0-9]{64}$/.test(input.migration)
      || !["preserve", "reset-team-pilot", "separately-authorized-reset"].includes(input.chatResetPolicy))
    throw new Error("An explicit matching workspace chat-reset policy is required");
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SELECT pg_advisory_xact_lock(731240191)");
    const runtime = (await client.query("SELECT gate,active_job FROM update_runtime WHERE singleton FOR UPDATE")).rows[0];
    if (runtime?.gate !== true || runtime.active_job != null
        || (await client.query("SELECT 1 FROM team_agent_runs WHERE status IN ('queued','running') LIMIT 1")).rowCount
        || (await client.query("SELECT 1 FROM notification_deliveries WHERE status='sending' LIMIT 1")).rowCount)
      throw new Error("Chat reset requires closed admission and drained work");
    const previous = (await client.query("SELECT metadata FROM audit_log WHERE action='native.chat_reset_prepared' AND metadata->>'migration'=$1", [input.migration])).rows[0]?.metadata;
    if (previous && (previous.workspace !== input.workspace || previous.chatResetPolicy !== input.chatResetPolicy))
      throw new Error("Chat-reset receipt conflicts with this workspace policy");
    const retained: Record<string, Row[]> = {};
    for (const table of tables) {
      // Fixed identifiers; locks prevent notification claims or settings changes
      // from racing the preserved-state comparison and reference detachment.
      await client.query(`LOCK TABLE ${table} IN SHARE ROW EXCLUSIVE MODE`);
      const expected = input.expectedRecords[table];
      if (!Array.isArray(expected)) throw new Error("Complete notification preservation evidence is required");
      const live = JSON.parse(JSON.stringify((await client.query(`SELECT * FROM ${table}`)).rows)) as Row[];
      const expectedRows = expected.map(row => row.value);
      const compare = (rows: Row[], detach = false) => rows.map(row => stateDigest(table === "notification_preferences" && detach ? { ...row, session_key: null } : row)).sort();
      if (stateDigest(compare(live)) !== stateDigest(compare(expectedRows, Boolean(previous) && input.chatResetPolicy !== "preserve"))) throw new Error("Notification or subscription state changed since export");
      retained[table] = live;
    }
    if (previous) {
      await client.query("COMMIT");
      return previous as { migration: string; workspace: string; chatResetPolicy: string; notificationState: string; channelsRemoved: number };
    }
    let channelsRemoved = 0;
    if (input.chatResetPolicy !== "preserve") {
      const removed = await client.query("DELETE FROM team_channels RETURNING id");
      channelsRemoved = removed.rowCount ?? 0;
      await client.query("UPDATE notification_preferences SET session_key=NULL WHERE session_key IS NOT NULL");
      retained.notification_preferences = retained.notification_preferences!.map(row => ({ ...row, session_key: null }));
    }
    const receipt = { migration: input.migration, workspace: input.workspace, chatResetPolicy: input.chatResetPolicy,
      notificationState: stateDigest(Object.fromEntries(Object.entries(retained).map(([key, rows]) => [key, rows.map(stateDigest).sort()]))),
      channelsRemoved };
    await client.query("INSERT INTO audit_log(action,metadata) VALUES('native.chat_reset_prepared',$1)", [receipt]);
    await client.query("COMMIT");
    return receipt;
  } catch (error) {
    await client.query("ROLLBACK"); throw error;
  } finally { client.release(); }
}
