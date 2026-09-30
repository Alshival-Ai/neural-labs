import { canonical, digest, identity } from "./state.mjs";
import { cronExpression, timezone } from "./schedules.mjs";

const plain = value => value && typeof value === "object" && !Array.isArray(value);
const text = (value, max) => typeof value === "string" && value.trim() && value.length <= max;
const REVIEWABLE_HOLDS = new Set(["native-connection-required", "execution-policy-review-required",
  "authorization-or-policy-unavailable", "membership-revoked"]);
export function validateJob(definition) {
  identity(definition.id); identity(definition.actor); identity(definition.connection?.owner);
  if (!text(definition.name, 200) || typeof definition.enabled !== "boolean"
      || !text(definition.model, 160) || !plain(definition.schedule) || !plain(definition.payload)
      || !["codex", "claude"].includes(definition.connection.provider)
      || !["subscription", "api-key"].includes(definition.connection.method)
      || !Number.isSafeInteger(definition.connection.generation) || definition.connection.generation < 1)
    throw new Error("An explicit automation owner, connection, model and schedule are required");
  if (!["skip", "run-once"].includes(definition.missedRunPolicy)
      || !["allow", "forbid"].includes(definition.overlap)
      || !["read-only", "workspace-write"].includes(definition.executionPolicy?.sandbox)
      || definition.executionPolicy?.approval !== "on-request") throw new Error("Invalid automation execution policy");
  if (definition.workflowLock !== undefined && definition.workflowLock !== null) identity(definition.workflowLock);
  const s = definition.schedule;
  if (s.kind === "cron") { cronExpression(s.expr); timezone(s.tz || "UTC"); }
  else if (s.kind === "every") {
    if (!Number.isSafeInteger(s.everyMs) || s.everyMs < 1 || !Number.isSafeInteger(s.anchorMs) || s.anchorMs < 0) throw new Error("An interval requires a persistent anchor");
  } else if (s.kind === "at") {
    if (!text(s.at, 64) || !/[zZ]$|[+-]\d{2}:\d{2}$/.test(s.at) || !Number.isSafeInteger(Date.parse(s.at))) throw new Error("One-time schedules require an explicit timezone");
  } else if (["process", "stream"].includes(s.kind)) { identity(s.source); }
  else throw new Error("Unsupported automation trigger");
  if (definition.payload.kind !== "agentTurn" || !text(definition.payload.message, 2 * 1024 * 1024)) throw new Error("Invalid automation payload");
  const timeout = definition.payload.timeoutSeconds;
  if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0 || timeout > 86400)) throw new Error("Automation timeout must be within one day");
  // Preserve imported fields verbatim, but never silently activate a policy
  // that this executor cannot enforce. Migration retains such definitions held.
  if (definition.payload.thinking && !(definition.connection.provider === "codex" ? ["none", "minimal", "low", "medium", "high", "xhigh"] : ["low", "medium", "high", "xhigh", "max"]).includes(definition.payload.thinking)) throw new Error("Unsupported provider reasoning effort");
  if (definition.payload.fallbacks?.length || definition.payload.toolsAllow?.length
      || definition.trigger || definition.pacing || definition.delivery && definition.delivery.mode !== "none"
      || definition.failureAlert || definition.schedule.staggerMs > 0
      || definition.payload.lightContext === true || definition.sessionTarget && definition.sessionTarget !== "isolated"
      || definition.schedule.kind === "process" || definition.schedule.kind === "stream")
    throw new Error("Automation policy adapters require review");
  if (Buffer.byteLength(canonical(definition)) > 2 * 1024 * 1024) throw new Error("Automation definition is too large");
  return definition;
}

export class NativeJobs {
  constructor({ state, changed = async () => {}, authorizeReview }) {
    this.state = state; this.changed = changed; this.authorizeReview = authorizeReview;
  }
  administrator(grant) { if (grant.actorRole !== "admin") throw new Error("Administrator access is required to change automations"); }
  history(grant, { jobId, before = "", limit = 50 }) {
    identity(jobId);
    if (!this.state.job(jobId)) throw new Error("Automation not found");
    if (!Number.isInteger(limit) || limit < 1 || limit > 200 || typeof before !== "string" || before.length > 4096) throw new Error("Invalid history page");
    let cursor = [Number.MAX_SAFE_INTEGER, "z", "z"];
    if (before) {
      try { cursor = JSON.parse(Buffer.from(before, "base64url").toString("utf8")); } catch { throw new Error("Invalid history cursor"); }
      if (!Array.isArray(cursor) || cursor.length !== 3 || !Number.isSafeInteger(cursor[0]) || cursor.slice(1).some(v => typeof v !== "string")) throw new Error("Invalid history cursor");
    }
    const rows = this.state.db.prepare(`WITH history AS (
      SELECT 'native' origin,id source_key,job_id,claimed_at stamp,NULL payload,NULL sha256 FROM occurrences
      UNION ALL
      SELECT 'retained',r.migration||'/'||r.source_key,
        COALESCE(json_extract(r.payload,'$.job_id'),json_extract(r.payload,'$.jobId')),
        CAST(COALESCE(json_extract(r.payload,'$.started_at_ms'),json_extract(r.payload,'$.runAtMs'),0) AS INTEGER),r.payload,r.sha256
      FROM retained_records r JOIN migrations m ON m.id=r.migration WHERE r.category='receipts' AND m.phase='verified'
    ) SELECT * FROM history WHERE job_id=? AND (stamp,origin,source_key)<(?,?,?)
      ORDER BY stamp DESC,origin DESC,source_key DESC LIMIT ?`).all(jobId, ...cursor, limit + 1);
    const page = rows.slice(0, limit);
    const entries = page.map(row => {
      if (row.origin === "native") return this.projectRun(grant, this.state.db.prepare("SELECT * FROM occurrences WHERE id=?").get(row.source_key));
      const raw = JSON.parse(row.payload);
      if (digest(canonical(raw)) !== row.sha256) throw new Error("Retained automation history failed its integrity check");
      const finished = raw.finished_at_ms ?? raw.finishedAtMs;
      return { runId: `retained:${row.source_key}`, receiptId: raw.receipt_id || null, jobId, runAtMs: row.stamp,
        status: raw.status || "unknown", historical: true, sha256: row.sha256,
        ...(Number.isSafeInteger(finished) && finished >= row.stamp ? { durationMs: finished - row.stamp } : {}),
        summary: grant.actorRole === "admin" && raw.error_text ? raw.error_text : `Preserved run: ${raw.status || "unknown"}`,
        ...(grant.actorRole === "admin" ? { raw } : {}) };
    });
    const last = page.at(-1);
    return { entries, next: rows.length > limit ? Buffer.from(JSON.stringify([last.stamp, last.origin, last.source_key])).toString("base64url") : null };
  }
  projectRun(grant, row) {
    const result = row.result ? JSON.parse(row.result) : {}, definition = JSON.parse(row.definition);
    return { runId: row.id, jobId: row.job_id, status: row.status, runAtMs: row.claimed_at,
      durationMs: row.finished_at === null ? undefined : row.finished_at - row.claimed_at,
      summary: result.code || `Automation ${row.status}`, manual: Boolean(row.manual),
      ...(grant.actorRole === "admin" || row.actor === grant.actor ? { actor: row.actor, model: definition.model, result } : {}) };
  }
  notification(action, input) {
    if (action === "session") {
      identity(input.userId); identity(input.sessionKey);
      return { owned: Boolean(this.state.db.prepare(`SELECT 1 FROM conversations c LEFT JOIN conversation_profiles p ON p.conversation=c.id
        WHERE c.id=? AND c.actor=? AND COALESCE(p.deleted,0)=0`).get(input.sessionKey, input.userId)) };
    }
    const saved = input.jobId ? this.state.job(identity(input.jobId)) : null;
    const current = saved ? this.state.db.prepare("SELECT id FROM occurrences WHERE job_id=? AND status IN ('claimed','running') ORDER BY claimed_at DESC LIMIT 1").get(saved.id) : null;
    const job = saved ? { id: saved.id, name: saved.definition.name, enabled: saved.enabled, currentRunId: current?.id || null } : null;
    if (action === "job") return { job };
    const project = row => ({ id: row.id, jobId: row.job_id, name: this.state.job(row.job_id)?.definition.name || "Automation",
      outcome: row.status === "succeeded" ? "success" : "failure", finishedAt: row.finished_at });
    if (action === "runs") {
      const after = Number(input.after || 0);
      if (!Number.isSafeInteger(after) || after < 0) throw new Error("Invalid notification history cursor");
      // Imported historical receipts never enter the live notification feed.
      // PostgreSQL retains the existing event/outbox deduplication records.
      return { runs: this.state.db.prepare("SELECT * FROM occurrences WHERE finished_at>=? AND status IN ('succeeded','failed','blocked') ORDER BY finished_at").all(after).map(project) };
    }
    if (action === "run") {
      identity(input.runId);
      const row = this.state.db.prepare("SELECT * FROM occurrences WHERE job_id=? AND id=?").get(input.jobId, input.runId);
      return { job, run: !row ? null : ["claimed", "running"].includes(row.status) ? { id: row.id, jobId: row.job_id, running: true }
        : ["succeeded", "failed", "blocked"].includes(row.status) ? project(row) : null };
    }
    throw new Error("Unknown notification operation");
  }
  snapshot(grant) {
    const admin = grant.actorRole === "admin";
    const jobs = this.state.db.prepare("SELECT id FROM jobs WHERE COALESCE(hold,'')!='deleted' ORDER BY id").all().map(({ id }) => {
      const row = this.state.job(id), definition = row.definition;
      const latest = this.state.db.prepare("SELECT * FROM occurrences WHERE job_id=? ORDER BY claimed_at DESC LIMIT 1").get(id);
      const active = this.state.db.prepare("SELECT claimed_at FROM occurrences WHERE job_id=? AND status IN ('claimed','running','unknown') LIMIT 1").get(id);
      const publicFields = { id, nativeHistory: true, name: definition.name, enabled: row.enabled, schedule: { kind: definition.schedule?.kind },
        payload: { kind: definition.payload?.kind }, classification: row.classification, completed: row.completed,
        configRevision: row.source_hash, hold: row.hold, manualRunWarning: row.hold ? `Held: ${row.hold}` : undefined,
        state: { ...(definition.state || {}), ...(latest ? { lastRunAtMs: latest.claimed_at, lastRunStatus: latest.status } : {}),
          ...(active ? { runningAtMs: active.claimed_at } : {}) } };
      return admin ? { ...definition, ...publicFields, schedule: definition.schedule, payload: definition.payload,
        reviewable: row.classification === "automation" && REVIEWABLE_HOLDS.has(row.hold) } : publicFields;
    });
    const entries = this.state.db.prepare("SELECT * FROM occurrences ORDER BY claimed_at DESC LIMIT 2000").all().map(row => this.projectRun(grant, row));
    return { status: { enabled: this.state.metadata("scheduling") === "enabled" }, jobs, entries };
  }
  async create(grant, input) {
    this.administrator(grant); identity(input.id);
    const definition = validateJob({ ...input, actor: grant.actor, connection: grant.binding, model: grant.model,
      missedRunPolicy: input.missedRunPolicy ?? "skip", overlap: input.overlap ?? "forbid",
      executionPolicy: input.executionPolicy ?? grant.policy,
      schedule: input.schedule?.kind === "every" ? { ...input.schedule, anchorMs: input.schedule.anchorMs ?? this.state.now() } : input.schedule });
    const prior = this.state.job(input.id);
    if (prior) {
      // An unknown create response is reconciled by id and exact definition,
      // never by creating a second scheduled job.
      if (prior.source_hash !== digest(canonical({ ...definition, schedule: input.schedule?.kind === "every" && input.schedule.anchorMs === undefined
        ? { ...definition.schedule, anchorMs: prior.definition.schedule.anchorMs } : definition.schedule }))) throw new Error("Automation creation conflicts");
      return { id: prior.id, configRevision: prior.source_hash, accepted: false };
    }
    this.state.putJob(definition); await this.changed();
    return { id: definition.id, configRevision: this.state.job(definition.id).source_hash, accepted: true };
  }
  async update(grant, { id, expectedRevision, patch, reassign = false }) {
    this.administrator(grant); identity(id);
    if (!plain(patch) || Object.keys(patch).some(key => !["name", "description", "enabled", "schedule", "payload", "missedRunPolicy", "overlap", "executionPolicy", "workflowLock", "delivery", "failureAlert"].includes(key))) throw new Error("Invalid automation patch");
    const result = this.state.transaction(() => {
      const job = this.state.job(id);
      if (!job || job.source_hash !== expectedRevision || job.hold === "deleted") throw new Error("Automation changed; refresh before editing");
      if (job.classification !== "automation") throw new Error("This retained record requires migration review");
      const definition = { ...job.definition, ...patch,
        ...(reassign ? { actor: grant.actor, connection: grant.binding, model: grant.model } : {}) };
      // Pausing an incompatible imported job is always possible and retains
      // every original field and its review hold.
      if (!(Object.keys(patch).length === 1 && patch.enabled === false && !reassign)) validateJob(definition);
      const serialized = canonical(definition), revision = digest(serialized);
      this.state.db.prepare("UPDATE jobs SET definition=?,source_hash=?,enabled=? WHERE id=?").run(serialized, revision, Number(definition.enabled), id);
      return { id, configRevision: revision };
    });
    await this.changed(); return result;
  }
  async remove(grant, { id, expectedRevision }) {
    this.administrator(grant); identity(id);
    this.state.transaction(() => {
      const job = this.state.job(id);
      if (!job || job.source_hash !== expectedRevision) throw new Error("Automation changed; refresh before deleting");
      if (job.classification !== "automation" || this.state.db.prepare("SELECT 1 FROM occurrences WHERE job_id=? AND status IN ('claimed','running','unknown')").get(id)) throw new Error("An active, uncertain or system automation cannot be deleted");
      // Receipts, checkpoints and subscriptions retain the original job ID.
      this.state.db.prepare("UPDATE jobs SET hold='deleted' WHERE id=?").run(id);
    });
    await this.changed(); return { ok: true };
  }
  async review(grant, input) {
    this.administrator(grant);
    if (!plain(input) || Object.keys(input).some(key => !["id", "requestId", "expectedRevision", "missedRunPolicy", "overlap", "executionPolicy"].includes(key))) throw new Error("Invalid automation review");
    const { id, requestId, expectedRevision, missedRunPolicy, overlap, executionPolicy } = input;
    identity(id); identity(requestId);
    // The selected account is explicit. No inferred default, credential copy or
    // browser-supplied actor can change the saved scheduled owner.
    const request = canonical({ input, actor: grant.actor, connection: grant.binding, model: grant.model });
    const prior = this.state.db.prepare("SELECT * FROM job_reviews WHERE request_id=?").get(requestId);
    if (prior) {
      if (prior.request !== request) throw new Error("Automation review request conflicts");
      await this.changed();
      return { id, configRevision: prior.revision, accepted: false };
    }
    const job = this.state.job(id);
    const check = current => {
      if (!current || current.source_hash !== expectedRevision || current.hold !== job?.hold) throw new Error("Automation changed; refresh before reviewing");
      if (current.classification !== "automation" || !REVIEWABLE_HOLDS.has(current.hold)) throw new Error("This hold requires operator review");
      if (current.definition.state?.runningAtMs || this.state.db.prepare("SELECT 1 FROM occurrences WHERE job_id=? AND status IN ('claimed','running','unknown')").get(id))
        throw new Error("An active or uncertain run requires reconciliation before review");
    };
    check(job);
    // Only account/model and these displayed execution choices change. Payload,
    // triggers, locks, delivery, timeouts and failure policies remain intact.
    const definition = validateJob({ ...job.definition, actor: grant.actor, connection: grant.binding, model: grant.model,
      enabled: job.enabled, missedRunPolicy, overlap, executionPolicy });
    if (typeof this.authorizeReview !== "function") throw new Error("Native background readiness cannot be verified");
    const revalidate = await this.authorizeReview(grant, definition);
    await revalidate();
    const serialized = canonical(definition), revision = digest(serialized);
    this.state.transaction(() => {
      check(this.state.job(id));
      this.state.db.prepare("INSERT INTO job_reviews VALUES (?,?,?,?,?,?,?,?,?)")
        .run(requestId, id, grant.actor, request, canonical(job.definition), serialized, job.hold, this.state.now(), revision);
      // Completed flags, receipts, checkpoints and original migration records
      // remain untouched. Releasing a hold is never an occurrence claim.
      this.state.db.prepare("UPDATE jobs SET definition=?,source_hash=?,hold=NULL WHERE id=?").run(serialized, revision, id);
    });
    await this.changed();
    return { id, configRevision: revision, accepted: true };
  }
}
