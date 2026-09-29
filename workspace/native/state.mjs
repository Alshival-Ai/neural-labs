import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync } from "node:fs";
import path from "node:path";

export function canonical(value) {
  if (value === null || ["string", "boolean"].includes(typeof value)) return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== "object") throw new Error("State must contain JSON values only");
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("State must contain plain JSON objects only");
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}
export const digest = value => createHash("sha256").update(value).digest("hex");
export const identity = value => {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(value)) throw new Error("Invalid native identity");
  return value;
};

// This database belongs to the container's persistent state. It is not the
// control-plane database and contains no connector credentials.
export class NativeState {
  constructor(filename, { now = Date.now } = {}) {
    if (filename !== ":memory:") {
      mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
      try { if (!lstatSync(filename).isFile()) throw new Error("Native database must be a regular file"); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    this.db = new DatabaseSync(filename);
    this.now = now;
    if (filename !== ":memory:") chmodSync(filename, 0o600);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;`);
    const version = this.db.prepare("PRAGMA user_version").get().user_version;
    if (version > 1) { this.db.close(); throw new Error("Native state was written by a newer runtime"); }
    this.db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT OR IGNORE INTO metadata VALUES ('scheduling', 'disabled');
      INSERT OR IGNORE INTO metadata VALUES ('delivery', 'disabled');
      CREATE TABLE IF NOT EXISTS migrations (
        id TEXT PRIMARY KEY, workspace TEXT NOT NULL, manifest TEXT NOT NULL,
        phase TEXT NOT NULL CHECK(phase IN ('copying','verified')), report TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS retained_records (
        migration TEXT NOT NULL REFERENCES migrations(id), category TEXT NOT NULL,
        source_key TEXT NOT NULL, payload TEXT NOT NULL, sha256 TEXT NOT NULL,
        disposition TEXT NOT NULL, PRIMARY KEY(migration,category,source_key)
      );
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, definition TEXT NOT NULL, source_hash TEXT NOT NULL,
        enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), hold TEXT,
        classification TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0,
        migration TEXT REFERENCES migrations(id)
      );
      CREATE TABLE IF NOT EXISTS occurrences (
        id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), occurrence TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('claimed','running','succeeded','failed','blocked','cancelled','unknown')),
        actor TEXT NOT NULL, connection TEXT NOT NULL, definition TEXT NOT NULL,
        manual INTEGER NOT NULL CHECK(manual IN (0,1)), claimed_at INTEGER NOT NULL,
        finished_at INTEGER, result TEXT, UNIQUE(job_id,occurrence)
      );
      CREATE TABLE IF NOT EXISTS workflow_locks (
        key TEXT PRIMARY KEY, run_id TEXT UNIQUE NOT NULL REFERENCES occurrences(id)
      );
      CREATE TABLE IF NOT EXISTS checkpoints (
        job_id TEXT NOT NULL REFERENCES jobs(id), key TEXT NOT NULL, value TEXT NOT NULL,
        revision INTEGER NOT NULL, PRIMARY KEY(job_id,key)
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY, actor TEXT NOT NULL, binding TEXT NOT NULL,
        native_session TEXT, created_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS native_session_owner ON conversations(binding,native_session)
        WHERE native_session IS NOT NULL;
      CREATE TABLE IF NOT EXISTS turns (
        id TEXT PRIMARY KEY, conversation TEXT NOT NULL REFERENCES conversations(id),
        request_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL, input TEXT NOT NULL,
        created_at INTEGER NOT NULL, finished_at INTEGER
      );
      CREATE UNIQUE INDEX IF NOT EXISTS conversation_active ON turns(conversation)
        WHERE status IN ('running','unknown');
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, turn_id TEXT NOT NULL REFERENCES turns(id),
        type TEXT NOT NULL, payload TEXT NOT NULL
      );
      PRAGMA user_version=1;
      COMMIT;
    `);
  }

  close() { this.db.close(); }
  transaction(work) {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = work(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  metadata(key) { return this.db.prepare("SELECT value FROM metadata WHERE key=?").get(key)?.value; }
  setMetadata(key, value) {
    this.db.prepare("INSERT INTO metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
  }
  job(id) {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id=?").get(id);
    return row ? { ...row, definition: JSON.parse(row.definition), enabled: Boolean(row.enabled), completed: Boolean(row.completed) } : null;
  }
  putJob(definition, { hold = null, classification = "automation", migration = null } = {}) {
    identity(definition.id);
    if (typeof definition.enabled !== "boolean") throw new Error("Job enabled state is required");
    const source = canonical(definition);
    this.db.prepare(`INSERT INTO jobs (id,definition,source_hash,enabled,hold,classification,completed,migration)
      VALUES (?,?,?,?,?,?,?,?)`).run(definition.id, source, digest(source), Number(definition.enabled), hold,
      classification, Number(definition.schedule?.kind === "at" && Boolean(definition.state?.lastRunAtMs)), migration);
  }

  // Authorization and credential readiness must be checked by the caller before
  // claiming. A committed claim is never automatically reused, even if spawning
  // the provider failed before a receipt could be written.
  claim({ jobId, occurrence, actor, connection, manual = false, workflowKey = null, expectedDefinitionHash }) {
    identity(jobId); identity(actor);
    if (typeof occurrence !== "string" || !occurrence || occurrence.length > 512) throw new Error("Invalid occurrence");
    if (!connection || !["codex", "claude"].includes(connection.provider) || !Number.isSafeInteger(connection.generation)
        || connection.generation < 0 || !["subscription", "api-key"].includes(connection.method)) throw new Error("Explicit connection binding required");
    identity(connection.owner);
    return this.transaction(() => {
      if (this.metadata("scheduling") !== "enabled") throw new Error("Native execution is gated");
      const job = this.job(jobId);
      if (!job) throw new Error("Automation not found");
      if (expectedDefinitionHash && job.source_hash !== expectedDefinitionHash) throw new Error("Automation changed during execution authorization");
      const previous = this.db.prepare("SELECT * FROM occurrences WHERE job_id=? AND occurrence=?").get(jobId, occurrence);
      if (previous) {
        if (previous.actor !== actor || previous.connection !== canonical(connection) || Boolean(previous.manual) !== manual) throw new Error("Occurrence binding conflicts");
        return { accepted: false, previous };
      }
      if (job.hold || job.classification !== "automation") throw new Error("Automation requires migration review");
      if (!manual && (!job.enabled || job.completed)) throw new Error("Automation is disabled or completed");
      if (!manual && canonical(job.definition.connection) !== canonical(connection)) throw new Error("Scheduled account binding conflicts");
      const lock = workflowKey || (job.definition.overlap === "allow" ? null : `job:${jobId}`);
      if (lock && this.db.prepare("SELECT 1 FROM workflow_locks WHERE key=?").get(lock)) throw new Error("Workflow has an active or uncertain occurrence");
      const id = randomUUID();
      this.db.prepare(`INSERT INTO occurrences
        (id,job_id,occurrence,status,actor,connection,definition,manual,claimed_at) VALUES (?,?,?,'claimed',?,?,?,?,?)`)
        .run(id, jobId, occurrence, actor, canonical(connection), canonical(job.definition), Number(manual), this.now());
      if (lock) this.db.prepare("INSERT INTO workflow_locks VALUES (?,?)").run(lock, id);
      return { accepted: true, id };
    });
  }
  startRun(id) {
    const changed = this.db.prepare("UPDATE occurrences SET status='running' WHERE id=? AND status='claimed'").run(id).changes;
    if (changed !== 1) throw new Error("Occurrence cannot be launched again");
  }
  finishRun(id, status, result = {}) {
    if (!["succeeded", "failed", "blocked", "cancelled", "unknown"].includes(status)) throw new Error("Invalid run outcome");
    return this.transaction(() => {
      const row = this.db.prepare("SELECT * FROM occurrences WHERE id=?").get(id);
      if (!row || !["claimed", "running"].includes(row.status)) throw new Error("Occurrence already settled");
      this.db.prepare("UPDATE occurrences SET status=?,finished_at=?,result=? WHERE id=?").run(status, this.now(), canonical(result), id);
      // Unknown outcomes retain their workflow lock until an operator resolves
      // them. Completing an at job must never make it eligible after restart.
      if (status !== "unknown") this.db.prepare("DELETE FROM workflow_locks WHERE run_id=?").run(id);
      if (!row.manual && ["succeeded", "failed", "cancelled"].includes(status) && JSON.parse(row.definition).schedule?.kind === "at") {
        this.db.prepare("UPDATE jobs SET completed=1 WHERE id=?").run(row.job_id);
      }
    });
  }
  recoverInterrupted() {
    // Call once, under the exclusive runtime startup lease, never on a browser
    // reconnect or while another runtime can still own live work.
    return this.transaction(() => {
      const runs = this.db.prepare("UPDATE occurrences SET status='unknown' WHERE status IN ('claimed','running')").run().changes;
      const turns = this.db.prepare("UPDATE turns SET status='unknown' WHERE status='running'").run().changes;
      return { runs, turns };
    });
  }
  checkpoint(jobId, key, value, expectedRevision = 0) {
    return this.transaction(() => {
      const previous = this.db.prepare("SELECT revision FROM checkpoints WHERE job_id=? AND key=?").get(jobId, key);
      if ((previous?.revision ?? 0) !== expectedRevision) throw new Error("Checkpoint revision conflicts");
      this.db.prepare(`INSERT INTO checkpoints VALUES (?,?,?,?) ON CONFLICT(job_id,key)
        DO UPDATE SET value=excluded.value,revision=excluded.revision`).run(jobId, key, canonical(value), expectedRevision + 1);
      return expectedRevision + 1;
    });
  }
  createConversation(actor, binding) {
    identity(actor); identity(binding.owner);
    if (!["codex", "claude"].includes(binding.provider) || !Number.isSafeInteger(binding.generation) || binding.generation < 0
        || !["subscription", "api-key"].includes(binding.method)) throw new Error("Explicit connection binding required");
    const id = randomUUID();
    this.db.prepare("INSERT INTO conversations VALUES (?,?,?,NULL,?)").run(id, actor, canonical(binding), this.now());
    return id;
  }
  conversation(id, actor, binding) {
    const row = this.db.prepare("SELECT * FROM conversations WHERE id=? AND actor=?").get(id, actor);
    if (!row || row.binding !== canonical(binding)) throw new Error("Conversation binding does not match the current actor and connection");
    return row;
  }
  startTurn(conversation, actor, binding, requestId, input) {
    this.conversation(conversation, actor, binding);
    return this.transaction(() => {
      const previous = this.db.prepare("SELECT * FROM turns WHERE request_id=?").get(requestId);
      if (previous) {
        if (previous.conversation !== conversation || previous.input !== canonical(input)) throw new Error("Turn request conflicts");
        return { accepted: false, id: previous.id };
      }
      const id = randomUUID();
      this.db.prepare("INSERT INTO turns VALUES (?,?,?,'running',?,?,NULL)").run(id, conversation, requestId, canonical(input), this.now());
      return { accepted: true, id };
    });
  }
  event(turnId, type, payload) {
    return this.db.prepare("INSERT INTO events (turn_id,type,payload) VALUES (?,?,?)").run(turnId, type, canonical(payload)).lastInsertRowid;
  }
  bindSession(conversation, actor, binding, nativeSession) {
    const row = this.conversation(conversation, actor, binding);
    if (typeof nativeSession !== "string" || !nativeSession || nativeSession.length > 256
        || row.native_session && row.native_session !== nativeSession) throw new Error("Native session binding conflicts");
    this.db.prepare("UPDATE conversations SET native_session=? WHERE id=?").run(nativeSession, conversation);
  }
  finishTurn(id, status) {
    if (!["succeeded", "failed", "blocked", "cancelled", "unknown"].includes(status)) throw new Error("Invalid turn outcome");
    if (this.db.prepare("UPDATE turns SET status=?,finished_at=? WHERE id=? AND status='running'").run(status, this.now(), id).changes !== 1) throw new Error("Turn already settled");
  }
  events(conversation, actor, binding, after = 0) {
    this.conversation(conversation, actor, binding);
    if (!Number.isSafeInteger(after) || after < 0) throw new Error("Invalid event cursor");
    return this.db.prepare(`SELECT e.* FROM events e JOIN turns t ON t.id=e.turn_id
      WHERE t.conversation=? AND e.id>? ORDER BY e.id LIMIT 1000`).all(conversation, after)
      .map(row => ({ ...row, payload: JSON.parse(row.payload) }));
  }
}
