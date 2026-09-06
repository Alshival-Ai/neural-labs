import type { Pool } from "pg";
import { z } from "zod";
import { CredentialCipher } from "./crypto.js";

export const providerIdSchema = z.enum(["google-maps", "klipy", "pexels"]);
export type ProviderPluginId = z.infer<typeof providerIdSchema>;
export const providerSettingsSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), apiKey: z.string().trim().min(1).max(4096).refine((key) => !/[\r\n\0]/u.test(key)) }).strict(),
  z.object({ action: z.literal("inherit") }).strict(),
]);
const runtimeStateSchema = z.object({ revision: z.number().int().nonnegative().nullable(), configured: z.boolean(), source: z.enum(["settings", "environment"]).nullable(), available: z.boolean() });
export const providerRuntimeReportSchema = z.object({ providers: z.record(z.string(), runtimeStateSchema), mcp: z.record(z.string(), runtimeStateSchema) });
export type ProviderRuntimeReport = z.infer<typeof providerRuntimeReportSchema>;
export const providerCheckSchema = z.object({ revision: z.number().int().nonnegative(), capabilities: z.array(z.object({ name: z.string().max(80), ok: z.boolean(), message: z.string().max(200) })).min(1).max(2) });
const definitions = {
  "google-maps": { name: "Google Maps", description: "Find places and convert addresses to coordinates.", capabilities: ["Places", "Geocoding"] },
  klipy: { name: "KLIPY", description: "Search GIFs for Neura and Team Terminal reactions.", capabilities: ["GIF search"] },
  pexels: { name: "Pexels", description: "Find stock photos and videos for your projects.", capabilities: ["Photo search"] },
};
type Row = { plugin_id: string; enabled: boolean; public_config: { inherit?: boolean; check?: z.infer<typeof providerCheckSchema> }; encrypted_credentials: string | null; revision: string };
const rowId = (id: ProviderPluginId) => `provider-${id}`;

export class ProviderPluginService {
  constructor(private readonly pool: Pool, private readonly cipher: CredentialCipher) {}
  private async row(id: ProviderPluginId): Promise<Row | undefined> {
    return (await this.pool.query<Row>("SELECT plugin_id, enabled, public_config, encrypted_credentials, revision FROM plugin_connections WHERE plugin_id = $1", [rowId(id)])).rows[0];
  }
  async runtimeConfig() {
    const providers: Record<string, unknown> = {};
    for (const id of providerIdSchema.options) {
      const row = await this.row(id);
      const mode = !row || row.public_config.inherit ? "inherit" : !row.enabled ? "disabled" : "settings";
      const secret = mode === "settings" && row?.encrypted_credentials ? this.cipher.decrypt<{ apiKey: string }>(row.encrypted_credentials) : undefined;
      providers[id] = { revision: row ? Number(row.revision) : 0, mode, ...(secret ? { apiKey: secret.apiKey } : {}) };
    }
    return { providers };
  }
  async status(id: ProviderPluginId, editable: boolean, runtime?: ProviderRuntimeReport) {
    const row = await this.row(id);
    const revision = row ? Number(row.revision) : 0;
    const inherited = !row || row.public_config.inherit === true;
    const state = runtime?.mcp[id];
    const gifState = runtime?.providers.klipy;
    const applied = state?.available === true && state.revision === revision && (id !== "klipy" || gifState?.available === true && gifState.revision === revision);
    const configured = inherited ? state?.configured === true : row.enabled && Boolean(row.encrypted_credentials);
    const check = row?.public_config.check?.revision === revision ? row.public_config.check : null;
    const checked = check?.capabilities.every((capability) => capability.ok) ?? false;
    const source = inherited ? state?.source ?? null : configured ? "settings" as const : null;
    return { id, ...definitions[id], type: "api-provider" as const, scope: "global" as const, ownership: "workspace" as const, editable, configured, source,
      ready: applied && configured && checked, applied, revision, appliedRevision: state?.available ? state.revision : null,
      state: !runtime || !state?.available ? "unavailable" : !applied ? "applying" : !configured ? "disconnected" : !check ? "configured" : checked ? "connected" : "check-failed",
      deploymentOverride: Boolean(row && !row.public_config.inherit), check };
  }
  async catalog(editable: boolean, runtime?: ProviderRuntimeReport) { return Promise.all(providerIdSchema.options.map((id) => this.status(id, editable, runtime))); }
  async save(id: ProviderPluginId, input: z.infer<typeof providerSettingsSchema>) {
    const inherit = input.action === "inherit";
    const encrypted = input.action === "save" ? this.cipher.encrypt({ apiKey: input.apiKey }) : null;
    await this.pool.query(`INSERT INTO plugin_connections (plugin_id, enabled, public_config, encrypted_credentials, source)
      VALUES ($1, true, $2, $3, 'settings') ON CONFLICT (plugin_id) DO UPDATE SET enabled = true,
      public_config = EXCLUDED.public_config, encrypted_credentials = EXCLUDED.encrypted_credentials,
      revision = plugin_connections.revision + 1, applied_revision = NULL, apply_error = NULL, source = 'settings', updated_at = now()`,
    [rowId(id), inherit ? { inherit: true } : {}, encrypted]);
  }
  async disconnect(id: ProviderPluginId) {
    await this.pool.query(`INSERT INTO plugin_connections (plugin_id, enabled, public_config, encrypted_credentials, source)
      VALUES ($1, false, '{}'::jsonb, NULL, 'settings') ON CONFLICT (plugin_id) DO UPDATE SET enabled = false,
      public_config = '{}'::jsonb, encrypted_credentials = NULL, revision = plugin_connections.revision + 1,
      applied_revision = NULL, apply_error = NULL, source = 'settings', updated_at = now()`, [rowId(id)]);
  }
  async recordCheck(id: ProviderPluginId, check: z.infer<typeof providerCheckSchema>) {
    if (check.revision === 0) {
      const inserted = await this.pool.query(`INSERT INTO plugin_connections (plugin_id, enabled, public_config, source)
        VALUES ($1, true, $2, 'settings') ON CONFLICT (plugin_id) DO NOTHING`,
      [rowId(id), { inherit: true, check: { ...check, revision: 1 } }]);
      return inserted.rowCount === 1;
    }
    const result = await this.pool.query(`UPDATE plugin_connections SET public_config = public_config || jsonb_build_object('check', $2::jsonb)
      WHERE plugin_id = $1 AND revision = $3`, [rowId(id), check, check.revision]);
    return result.rowCount === 1;
  }
}
