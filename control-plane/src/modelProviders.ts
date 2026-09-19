import type { Pool } from "pg";
import { z } from "zod";
import type { ControlPlaneConfig } from "./config.js";

export const modelPolicySchema = z.object({
  provider: z.enum(["openai", "anthropic"]),
  mode: z.enum(["latest", "pinned"]),
  model: z.string().max(200).default(""),
  effort: z.string().regex(/^[a-z]*$/).max(20).default(""),
}).strict().refine((value) => value.mode !== "pinned" || /^(openai|anthropic)\/[a-zA-Z0-9._/-]+$/.test(value.model) && value.model.startsWith(`${value.provider}/`), "Choose a provider-qualified model");
export type ModelPolicy = z.infer<typeof modelPolicySchema>;
export const voiceSettingsSchema = z.object({
  realtimeModel: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/),
  transcriptionModel: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/),
  realtimeVoice: z.string().regex(/^[a-z]{1,30}$/),
}).strict();
type VoiceSettings = z.infer<typeof voiceSettingsSchema>;
type VoiceRow = { revision: string; settings: VoiceSettings; applied_revision: string | null; apply_error: string | null };
const initialPolicy: ModelPolicy = { provider: "openai", mode: "latest", model: "", effort: "" };
type Resolution = { model: string; effort: string; agentId: string; revision: number; held?: boolean; explicitModel?: boolean; explicitEffort?: boolean };
type PolicyRow = { policy_key: string; user_id: string | null; revision: string; policy: ModelPolicy; resolved: Resolution | null; applied_revision: string | null; apply_error: string | null };

export class ModelProviderPolicies {
  private reconciling = false;
  constructor(private pool: Pool, private workspace: ControlPlaneConfig["workspace"], private fetchFn: typeof fetch = fetch) {}

  private async runtime(userId: string | undefined, body?: unknown, workload = "background") {
    const url = new URL("/internal/model-providers/preferences", this.workspace.controlUrl);
    if (userId) url.searchParams.set("userId", userId);
    else url.searchParams.set("workload", workload);
    const response = await this.fetchFn(url, {
      method: body ? "POST" : "GET",
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${this.workspace.controlToken}` },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(150_000),
    });
    if (!response.ok) throw new Error("Model settings could not be applied. Check account availability, model capabilities, and runtime health.");
    return response.json() as Promise<Resolution>;
  }

  private key(userId?: string, workload = "background") { return userId ? `user:${userId}` : `workspace:${workload}`; }
  private async row(userId?: string, workload = "background") {
    const result = await this.pool.query<PolicyRow>("SELECT * FROM model_provider_policies WHERE policy_key = $1", [this.key(userId, workload)]);
    return result.rows[0];
  }
  private publicRow(row: PolicyRow) {
    return { policy: row.policy, revision: Number(row.revision), resolved: row.resolved, pending: row.applied_revision !== row.revision, error: row.apply_error };
  }
  async get(userId?: string, workload = "background") {
    const row = await this.row(userId, workload);
    if (row) return this.publicRow(row);
    const current = await this.runtime(userId, undefined, workload);
    return { policy: initialPolicy, revision: 0, resolved: current, pending: false, error: null };
  }

  async save(userId: string | undefined, revision: number, policy: ModelPolicy, workload = "background") {
    const parsed = modelPolicySchema.parse(policy);
    // Desired state commits before runtime mutation. A failed apply is visible
    // and retryable, never misreported as an applied configuration.
    const result = revision === 0
      ? await this.pool.query<PolicyRow>(`INSERT INTO model_provider_policies(policy_key, user_id, policy)
          VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING *`, [this.key(userId, workload), userId ?? null, parsed])
      : await this.pool.query<PolicyRow>(`UPDATE model_provider_policies SET policy = $3, revision = revision + 1,
          apply_error = NULL, updated_at = now() WHERE policy_key = $1 AND revision = $2 RETURNING *`, [this.key(userId, workload), revision, parsed]);
    if (!result.rows[0]) throw Object.assign(new Error("Model settings changed in another window. Reload before saving."), { status: 409 });
    await this.apply(result.rows[0]);
    return this.get(userId, workload);
  }

  private async apply(row: PolicyRow) {
    try {
      const resolved = await this.runtime(row.user_id ?? undefined, { policy: row.policy, revision: Number(row.revision), previous: row.resolved }, row.policy_key === "workspace:team" ? "team" : "background");
      await this.pool.query(`UPDATE model_provider_policies SET resolved = $3, applied_revision = revision, apply_error = NULL
        WHERE policy_key = $1 AND revision = $2`, [row.policy_key, row.revision, resolved]);
    } catch {
      await this.pool.query(`UPDATE model_provider_policies SET apply_error = $3 WHERE policy_key = $1 AND revision = $2`,
        [row.policy_key, row.revision, "Defaults are saved but not active. Check the connection and model/effort compatibility, then retry."]);
    }
  }

  private async voiceRuntime(body?: unknown, refresh = false) {
    const url = new URL(`/internal/model-providers/voice${refresh ? "/refresh" : ""}`, this.workspace.controlUrl);
    const result = await this.fetchFn(url, { method: body || refresh ? "POST" : "GET", headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${this.workspace.controlToken}` }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20_000) });
    if (!result.ok) throw new Error("Voice settings are unavailable");
    return result.json() as Promise<Record<string, unknown>>;
  }
  async getVoice(refresh = false) {
    const runtime = await this.voiceRuntime(undefined, refresh);
    const row = (await this.pool.query<VoiceRow>("SELECT * FROM model_provider_voice WHERE singleton = true")).rows[0];
    return { ...runtime, ...(row?.settings ?? {}), revision: row ? Number(row.revision) : 0, pending: row ? row.revision !== row.applied_revision : false, error: row?.apply_error ?? null };
  }
  private async applyVoice(row: VoiceRow) {
    try {
      await this.voiceRuntime({ ...row.settings, revision: Number(row.revision) });
      await this.pool.query("UPDATE model_provider_voice SET applied_revision = revision, apply_error = NULL WHERE singleton = true AND revision = $1", [row.revision]);
    } catch {
      await this.pool.query("UPDATE model_provider_voice SET apply_error = $2 WHERE singleton = true AND revision = $1", [row.revision, "Voice settings are saved but not active. Check model compatibility and retry."]);
    }
  }
  async saveVoice(revision: number, settings: VoiceSettings) {
    const parsed = voiceSettingsSchema.parse(settings);
    const result = revision === 0
      ? await this.pool.query<VoiceRow>("INSERT INTO model_provider_voice(settings) VALUES ($1) ON CONFLICT DO NOTHING RETURNING *", [parsed])
      : await this.pool.query<VoiceRow>("UPDATE model_provider_voice SET settings = $2, revision = revision + 1, apply_error = NULL, updated_at = now() WHERE singleton = true AND revision = $1 RETURNING *", [revision, parsed]);
    if (!result.rows[0]) throw Object.assign(new Error("Voice settings changed. Reload before saving."), { status: 409 });
    await this.applyVoice(result.rows[0]);
    return this.getVoice();
  }

  async reconcile() {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      const missing = await this.pool.query<{ id: string }>(`SELECT u.id FROM users u LEFT JOIN model_provider_policies p ON p.user_id = u.id
        WHERE u.status = 'active' AND p.policy_key IS NULL ORDER BY u.created_at`);
      const candidates: Array<string | undefined> = missing.rows.map((row) => row.id);
      if (!await this.row()) candidates.unshift(undefined);
      for (const userId of candidates) {
        try {
          const current = await this.runtime(userId);
          if (!current.model?.startsWith("openai/")) continue;
          // Only inherited flagship defaults follow the flagship registry.
          // Explicit/lower-cost routes retain their role and exact model.
          const follow = !current.explicitModel && ["openai/gpt-5.6-sol", "openai/gpt-6-astra"].includes(current.model);
          await this.save(userId, 0, { provider: "openai", mode: follow ? "latest" : "pinned", model: follow ? "" : current.model, effort: current.explicitEffort ? current.effort || "" : "" });
        } catch { /* Unavailable or concurrently imported owners retry later. */ }
      }
      const voice = (await this.pool.query<VoiceRow>("SELECT * FROM model_provider_voice WHERE singleton = true")).rows[0];
      if (voice) await this.applyVoice(voice);
      const rows = await this.pool.query<PolicyRow>(`SELECT p.* FROM model_provider_policies p LEFT JOIN users u ON u.id = p.user_id
        WHERE (p.user_id IS NULL OR u.status = 'active') ORDER BY p.updated_at`);
      for (const row of rows.rows) await this.apply(row);
    } finally { this.reconciling = false; }
  }
}
