import { canonical, digest } from "./state.mjs";
import { WorkspaceSkillError } from "../skills-manager.mjs";

const historyTables = new Set(["skill_workshop_proposal_events", "skill_workshop_proposal_rollbacks"]);
const fail = (status, message) => new WorkspaceSkillError(status, "skill_history", message);
function authorize(actor) {
  // Legacy workshop records do not consistently identify an owning member.
  // Preserve them for administrators without inventing team-wide ownership.
  if (actor?.role !== "admin") throw fail(403, "Only administrators can inspect retained proposal history");
}
function unpack(row) {
  const raw = JSON.parse(row.payload);
  if (digest(canonical(raw)) !== row.sha256) throw fail(409, "Retained proposal evidence failed its integrity check");
  return raw;
}
function proposal(raw) {
  if (typeof raw.record_json !== "string") return raw;
  try { return JSON.parse(raw.record_json); }
  catch { return null; } // Keep malformed historical records inspectable verbatim.
}

export class NativeSkillHistory {
  constructor(state) { this.state = state; }
  list(actor, { after = "", limit = 50 } = {}) {
    authorize(actor);
    if (typeof after !== "string" || after.length > 4096 || !Number.isInteger(limit) || limit < 1 || limit > 100)
      throw fail(400, "Invalid history page");
    let cursor = ["", ""];
    if (after) {
      try { cursor = JSON.parse(Buffer.from(after, "base64url").toString("utf8")); }
      catch { throw fail(400, "Invalid history cursor"); }
      if (!Array.isArray(cursor) || cursor.length !== 2 || cursor.some(value => typeof value !== "string")) throw fail(400, "Invalid history cursor");
    }
    const rows = this.state.db.prepare(`SELECT r.* FROM retained_records r JOIN migrations m ON m.id=r.migration
      WHERE r.category='proposals' AND m.phase='verified' AND (r.migration,r.source_key)>(?,?)
      ORDER BY r.migration,r.source_key LIMIT ?`).all(...cursor, limit + 1);
    const records = rows.slice(0, limit).map(row => {
      const record = proposal(unpack(row));
      return { migration: row.migration, id: row.source_key, sha256: row.sha256,
        title: typeof record?.title === "string" ? record.title : row.source_key,
        status: typeof record?.status === "string" ? record.status : "unclassified",
        updatedAt: typeof record?.updatedAt === "string" ? record.updatedAt : null };
    });
    const last = records.at(-1);
    return { records, next: rows.length > limit ? Buffer.from(JSON.stringify([last.migration, last.id])).toString("base64url") : null };
  }
  inspect(actor, { migration, id }) {
    authorize(actor);
    if (typeof migration !== "string" || !/^[a-f0-9]{64}$/.test(migration) || typeof id !== "string" || !id || id.length > 2048)
      throw fail(400, "Select a retained proposal");
    const row = this.state.db.prepare(`SELECT r.* FROM retained_records r JOIN migrations m ON m.id=r.migration
      WHERE r.category='proposals' AND m.phase='verified' AND r.migration=? AND r.source_key=?`).get(migration, id);
    if (!row) throw fail(404, "Retained proposal not found");
    const raw = unpack(row), history = [];
    for (const source of this.state.db.prepare("SELECT * FROM retained_records WHERE migration=? AND category='sourceTables' ORDER BY source_key").all(migration)) {
      const value = unpack(source);
      if (historyTables.has(value.table) && value.row?.proposal_id === id)
        history.push({ table: value.table, sourceKey: source.source_key, sha256: source.sha256, record: value.row });
    }
    return { migration, id, sha256: row.sha256, record: proposal(raw), raw, history, readOnly: true };
  }
}
