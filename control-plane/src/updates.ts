import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { z } from "zod";

export const updatePolicySchema = z.object({
  openclawAutomatic: z.boolean(), codexAutomatic: z.boolean(),
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(v => new Set(v).size === v.length),
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.string().max(100).refine(value => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }),
}).strict().refine(v => v.end > v.start, "The maintenance window must end on the same day after it starts");
export type UpdatePolicy = z.infer<typeof updatePolicySchema>;
export const defaultUpdatePolicy: UpdatePolicy = { openclawAutomatic: false, codexAutomatic: false, days: [0], start: "03:00", end: "05:00", timezone: "America/Chicago" };
export const jobPhases = ["queued", "checking", "preparing", "ready", "deferred", "maintenance", "updating", "verifying", "committing", "activating", "restoring", "succeeded", "restored", "failed", "recovery_required", "cancelled"] as const;
export type UpdatePhase = typeof jobPhases[number];
export const terminalPhases: readonly string[] = ["succeeded", "restored", "failed", "recovery_required", "cancelled"];
const transitions: Record<UpdatePhase, readonly UpdatePhase[]> = {
  queued: ["checking", "preparing", "failed", "cancelled"], checking: ["succeeded", "failed", "cancelled"], preparing: ["ready", "failed", "cancelled"],
  ready: ["deferred", "maintenance", "failed", "cancelled"], deferred: ["ready", "maintenance", "failed", "cancelled"],
  maintenance: ["deferred", "updating", "restoring", "recovery_required"], updating: ["verifying", "restoring", "recovery_required"],
  verifying: ["committing", "restoring", "recovery_required"], committing: ["activating", "recovery_required"],
  activating: ["succeeded", "restored", "recovery_required"],
  restoring: ["activating", "recovery_required"], succeeded: [], restored: [], failed: [], recovery_required: [], cancelled: [],
};
export function validUpdateTransition(from: UpdatePhase, to: UpdatePhase) { return from === to || transitions[from].includes(to); }
export class UpdateError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }

// The worker independently authenticates the published manifest before use.
// No browser-supplied image or command is accepted at this boundary.
export const releaseSummarySchema = z.object({
  id: z.string().regex(/^workspace-v[0-9][A-Za-z0-9.-]{0,79}$/),
  openclawVersion: z.string().regex(/^\d{4}\.\d+\.\d+$/),
  codexVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  appServerVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  image: z.string().regex(/^ghcr\.io\/alshival-ai\/neural-labs-workspace@sha256:[a-f0-9]{64}$/),
  sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
  notesUrl: z.string().regex(/^https:\/\/github\.com\/Alshival-Ai\/neural-labs\/releases\/tag\/workspace-v[0-9A-Za-z.-]+$/),
  manualRequired: z.boolean(), reason: z.string().max(300).default(""),
}).strict();
export const workerReportSchema = z.object({
  available: releaseSummarySchema.nullable().optional(),
  installed: z.object({ image: z.string().max(200), openclawVersion: z.string().max(64), codexVersion: z.string().max(64) }).strict().optional(),
  error: z.string().max(300).nullable().optional(),
  job: z.object({ id: z.string().uuid(), phase: z.enum(jobPhases), message: z.string().max(300), releaseId: z.string().max(90).optional() }).strict().optional(),
}).strict();

export class UpdateService {
  activeRequests = 0;
  constructor(private pool: Pool, private initialCodex = false) {}
  async initialize() {
    await this.pool.query("INSERT INTO update_policy(singleton,policy) VALUES(true,$1) ON CONFLICT DO NOTHING", [{ ...defaultUpdatePolicy, codexAutomatic: this.initialCodex }]);
  }
  async policy() {
    await this.initialize();
    const row = (await this.pool.query("SELECT revision,policy FROM update_policy WHERE singleton")).rows[0];
    return { revision: Number(row.revision), policy: updatePolicySchema.parse(row.policy) };
  }
  async save(revision: number, policy: UpdatePolicy, actor: string) {
    await this.initialize();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const saved = await client.query("UPDATE update_policy SET policy=$1,revision=revision+1 WHERE singleton AND revision=$2 RETURNING revision,policy", [policy, revision]);
      if (!saved.rows.length) throw new UpdateError(409, "update_policy_conflict", "Settings changed in another window. Reload before saving.");
      await client.query("INSERT INTO audit_log(actor_user_id,action,metadata) VALUES($1,'updates.policy_saved',$2)", [actor, { revision: Number(saved.rows[0].revision), policy }]);
      await client.query("COMMIT");
      return { revision: Number(saved.rows[0].revision), policy: saved.rows[0].policy as UpdatePolicy };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async maintenance() {
    const row = (await this.pool.query("SELECT gate,active_job FROM update_runtime WHERE singleton")).rows[0];
    return { maintenance: row?.gate === true, jobId: row?.active_job ?? null };
  }
  async status() {
    const [{ revision, policy }, runtime, history] = await Promise.all([
      this.policy(), this.pool.query("SELECT * FROM update_runtime WHERE singleton"),
      this.pool.query("SELECT id,kind,phase,message,release_id,created_at,updated_at FROM update_jobs ORDER BY created_at DESC LIMIT 30"),
    ]);
    const r = runtime.rows[0];
    return { revision, policy, maintenance: r?.gate === true, available: r?.available ?? null, installed: r?.installed ?? null,
      codex: r?.codex ?? null, worker: { connected: !!r?.heartbeat && Date.now() - new Date(r.heartbeat).getTime() < 180_000,
        lastSeen: r?.heartbeat ?? null, lastCheck: r?.checked_at ?? null, error: r?.error ?? null }, jobs: history.rows };
  }
  async enqueue(kind: "check" | "install" | "automatic", actor: string | null) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const runtime = (await client.query("SELECT * FROM update_runtime WHERE singleton FOR UPDATE")).rows[0];
      if (runtime.gate) throw new UpdateError(409, "maintenance_active", "A deployment or recovery is already in progress.");
      if (kind !== "check" && (!runtime.available || runtime.available.manualRequired)) throw new UpdateError(409, "release_unavailable", "No compatible reviewed release is available.");
      if (kind !== "check" && (!runtime.heartbeat || Date.now() - new Date(runtime.heartbeat).getTime() > 180_000)) throw new UpdateError(503, "updater_offline", "The host updater is unavailable.");
      if (runtime.active_job) return await this.existing(client, runtime.active_job);
      if (kind === "automatic") {
        const failed = (await client.query("SELECT 1 FROM update_jobs WHERE release_id=$1 AND phase IN ('failed','restored','recovery_required') LIMIT 1", [runtime.available.id])).rows;
        if (failed.length) throw new UpdateError(409, "release_held", "This release previously failed and requires administrator review.");
      }
      const id = randomUUID();
      await client.query("INSERT INTO update_jobs(id,kind,phase,release_id,actor_id) VALUES($1,$2,'queued',$3,$4)", [id, kind, kind === "check" ? null : runtime.available.id, actor]);
      await client.query("UPDATE update_runtime SET active_job=$1 WHERE singleton", [id]);
      await client.query("INSERT INTO audit_log(actor_user_id,action,metadata) VALUES($1,'updates.requested',$2)", [actor, { id, kind }]);
      await client.query("COMMIT");
      return { id };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  private async existing(client: import("pg").PoolClient, id: string) { await client.query("COMMIT"); return { id }; }
  async workerState() {
    const state = await this.status();
    const job = (await this.pool.query("SELECT j.* FROM update_jobs j JOIN update_runtime r ON r.active_job=j.id WHERE r.singleton")).rows[0] ?? null;
    const busy = (await this.pool.query("SELECT count(*)::int AS count FROM team_agent_runs WHERE status IN ('queued','running')")).rows[0]?.count ?? 0;
    const sends = (await this.pool.query("SELECT count(*)::int AS count FROM notification_deliveries WHERE status='sending'")).rows[0]?.count ?? 0;
    return { ...state, job, teamRuns: busy, activeRequests: this.activeRequests, notificationSends: sends, protocol: 1 };
  }
  async report(report: z.infer<typeof workerReportSchema>) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const runtime = (await client.query("SELECT active_job FROM update_runtime WHERE singleton FOR UPDATE")).rows[0];
      await client.query("UPDATE update_runtime SET heartbeat=now() WHERE singleton");
      if (report.error !== undefined) await client.query("UPDATE update_runtime SET error=$1 WHERE singleton", [report.error]);
      if (report.available !== undefined) await client.query("UPDATE update_runtime SET available=$1,checked_at=now() WHERE singleton", [report.available]);
      if (report.installed) await client.query("UPDATE update_runtime SET installed=$1 WHERE singleton", [report.installed]);
      if (report.job) {
        if (runtime.active_job !== report.job.id) {
          const completed = (await client.query("SELECT phase FROM update_jobs WHERE id=$1", [report.job.id])).rows[0];
          if (!runtime.active_job && completed?.phase === report.job.phase && terminalPhases.includes(completed.phase)) {
            await client.query("COMMIT"); return;
          }
          throw new UpdateError(409, "stale_update", "Update job is no longer active.");
        }
        const job = (await client.query("SELECT phase,kind FROM update_jobs WHERE id=$1 FOR UPDATE", [report.job.id])).rows[0];
        if (report.job.phase === "maintenance" && job.kind === "automatic") {
          const saved = (await client.query("SELECT policy FROM update_policy WHERE singleton FOR SHARE")).rows[0];
          if (!saved?.policy?.openclawAutomatic) throw new UpdateError(409, "automatic_disabled", "Automatic updates were disabled before maintenance.");
        }
        if (!validUpdateTransition(job.phase, report.job.phase)) throw new UpdateError(409, "invalid_transition", "Invalid update transition.");
        await client.query("UPDATE update_jobs SET phase=$2,message=$3,updated_at=now() WHERE id=$1", [report.job.id, report.job.phase, report.job.message]);
        const gated = ["maintenance", "updating", "verifying", "committing", "restoring", "recovery_required"].includes(report.job.phase);
        await client.query("UPDATE update_runtime SET gate=$1,active_job=$2 WHERE singleton", [gated, terminalPhases.includes(report.job.phase) ? null : report.job.id]);
        if (job.phase !== report.job.phase) await client.query("INSERT INTO audit_log(action,metadata) VALUES('updates.phase_changed',$1)", [{ id: report.job.id, phase: report.job.phase }]);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async reportCodex(status: unknown) { await this.pool.query("UPDATE update_runtime SET codex=$1 WHERE singleton", [status]); }
}
