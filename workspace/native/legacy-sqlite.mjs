import { DatabaseSync } from "node:sqlite";
import { canonical, digest } from "./state.mjs";

const REQUIRED = ["cron_jobs", "cron_run_receipts", "cron_job_scratch", "skill_workshop_proposals"];
const OPTIONAL = ["skill_workshop_proposal_events", "skill_workshop_proposal_rollbacks", "skill_workshop_collection_reviews",
  "skill_usage", "flow_runs", "task_runs", "task_delivery_state", "claw_cron_refs"];

// Read only the scheduling/workshop tables, never credential, browser, device,
// transcript or secret-store tables. A single SQLite transaction supplies a
// consistent snapshot even during a read-only preflight inventory. The final
// filesystem+database export still requires the host to drain all writers.
export function readLegacyScheduler(filename) {
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    db.exec("PRAGMA query_only=ON; BEGIN");
    const available = new Map(db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table'").all().map(row => [row.name, row.sql]));
    for (const table of REQUIRED) if (!available.has(table)) throw new Error(`Unsupported legacy schema: missing ${table}`);
    const tables = {}, sourceTables = [], counts = {};
    for (const table of [...REQUIRED, ...OPTIONAL]) {
      if (!available.has(table)) continue;
      // Identifiers are from the fixed list above, never source contents.
      const columns = db.prepare(`PRAGMA table_info(${table})`).all();
      const keys = columns.filter(column => column.pk).sort((a, b) => a.pk - b.pk).map(column => column.name);
      if (!keys.length) throw new Error(`Legacy table ${table} has no durable identity`);
      const rows = db.prepare(`SELECT * FROM ${table}`).all();
      tables[table] = rows;
      counts[table] = rows.length;
      sourceTables.push({ key: `${table}:schema`, value: { table, schema: available.get(table), columns } });
      for (const row of rows) {
        if (Object.values(row).some(value => value instanceof Uint8Array)) throw new Error(`Legacy ${table} contains an unsupported binary field`);
        sourceTables.push({ key: `${table}:${digest(canonical(keys.map(key => row[key])))}`, value: { table, row } });
      }
    }
    const ids = new Set();
    const jobs = tables.cron_jobs.map(row => {
      if (ids.has(row.job_id)) throw new Error("Legacy stores contain duplicate job IDs; an explicit mapping is required");
      ids.add(row.job_id);
      const definition = JSON.parse(row.job_json);
      if (!definition || definition.id !== row.job_id || typeof definition.enabled !== "boolean"
          || Number(definition.enabled) !== row.enabled) throw new Error("Legacy job projection does not match its stored definition");
      // Runtime state is stored separately by current OpenClaw. Preserve that
      // current projection as well as the original job_json in sourceTables.
      const state = row.state_json ? JSON.parse(row.state_json) : definition.state;
      return { key: row.job_id, value: { ...definition, ...(state ? { state } : {}) } };
    });
    const result = { jobs,
      receipts: tables.cron_run_receipts.map(row => ({ key: row.receipt_id, value: row })),
      scratch: tables.cron_job_scratch.map(row => ({ key: canonical([row.store_key, row.job_id]), value: row })),
      proposals: tables.skill_workshop_proposals.map(row => ({ key: row.proposal_id, value: row })), sourceTables, counts };
    db.exec("COMMIT");
    return result;
  } finally { db.close(); }
}
