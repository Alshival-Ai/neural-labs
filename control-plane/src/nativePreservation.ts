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
