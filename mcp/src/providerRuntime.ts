import { z } from "zod";
import type { ProviderConfig } from "./providerConfig.js";
import { createKlipyClient } from "./klipyClient.js";

export const API_PROVIDERS = ["google-maps", "klipy", "pexels"] as const;
export type ApiProviderId = typeof API_PROVIDERS[number];
const fields = { "google-maps": "googleApiKey", klipy: "klipyApiKey", pexels: "pexelsApiKey" } as const;
const entrySchema = z.object({ revision: z.number().int().nonnegative(), mode: z.enum(["inherit", "settings", "disabled"]), apiKey: z.string().min(1).max(4096).optional() }).refine((value) => value.mode !== "settings" || Boolean(value.apiKey));
const configSchema = z.object({ providers: z.object({ "google-maps": entrySchema, klipy: entrySchema, pexels: entrySchema }) });
type RuntimeConfig = z.infer<typeof configSchema>;
export type ProviderRuntimeStatus = { revision: number | null; configured: boolean; source: "settings" | "environment" | null; available: boolean };

/** Memory-only, leased configuration. Environment keys never override a stored disconnect. */
export class ProviderRuntime {
  private current: RuntimeConfig | undefined;
  private refreshedAt = -Infinity;
  private timer: ReturnType<typeof setInterval> | undefined;
  private refreshing: Promise<void> | undefined;
  constructor(private readonly base: ProviderConfig, private readonly endpoint: string, private readonly token: string, private readonly fetchFn: typeof fetch = fetch, private readonly now = Date.now) {}

  async start() { await this.refresh(); this.timer = setInterval(() => void this.refresh(), 15_000); this.timer.unref?.(); }
  close() { if (this.timer) clearInterval(this.timer); }
  refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.fetchConfig().finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }
  private async fetchConfig() {
    try {
      const response = await this.fetchFn(this.endpoint, { headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(5000) });
      if (!response.ok) { await response.body?.cancel(); return; }
      const payload = await boundedJson(response, 131_072);
      this.current = configSchema.parse(payload);
      this.refreshedAt = this.now();
    } catch { /* Keep the last confirmed lease; never log credentials or URLs. */ }
  }
  snapshot(): ProviderConfig {
    const next = { ...this.base };
    for (const id of API_PROVIDERS) {
      const field = fields[id];
      delete next[field];
      if (!this.current || this.now() - this.refreshedAt >= 60_000) continue;
      const entry = this.current.providers[id];
      const key = entry.mode === "inherit" ? this.base[field] : entry.mode === "settings" ? entry.apiKey : undefined;
      if (key) next[field] = key;
    }
    return next;
  }
  status(): Record<ApiProviderId, ProviderRuntimeStatus> {
    const snapshot = this.snapshot();
    return Object.fromEntries(API_PROVIDERS.map((id) => {
      const entry = this.current?.providers[id];
      const available = Boolean(entry && this.now() - this.refreshedAt < 60_000);
      return [id, { revision: available ? entry!.revision : null, configured: Boolean(snapshot[fields[id]]), available,
        source: entry?.mode === "settings" ? "settings" : entry?.mode === "inherit" && this.base[fields[id]] ? "environment" : null }];
    })) as Record<ApiProviderId, ProviderRuntimeStatus>;
  }
  gifProvider(onChange: () => void) {
    const runtime = this;
    let previous: string | undefined;
    const client = () => {
      const state = runtime.status().klipy;
      const fingerprint = JSON.stringify([state.revision, state.available, state.source]);
      if (previous !== fingerprint) { previous = fingerprint; onChange(); }
      return createKlipyClient(runtime.snapshot().klipyApiKey, runtime.fetchFn);
    };
    return {
      get configured() { return client().configured; },
      get revision() { client(); return previous; },
      catalog: (query: string, pos?: string) => client().catalog(query, pos),
      share: (id: string, query: string) => client().share(id, query),
    };
  }
  async check(id: ApiProviderId, revision: number) {
    await this.refresh();
    const status = this.status()[id];
    if (!status.available || status.revision !== revision) throw new Error("Configuration has not been applied. Try again shortly.");
    const key = this.snapshot()[fields[id]];
    if (!key) throw new Error("Save an API key before checking the connection.");
    const requests: Array<[string, string, RequestInit?]> = id === "google-maps" ? [
      ["Places", "https://places.googleapis.com/v1/places:searchText", { method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": "places.id" }, body: JSON.stringify({ textQuery: "coffee", pageSize: 1 }) }],
      ["Geocoding", `https://maps.googleapis.com/maps/api/geocode/json?${new URLSearchParams({ address: "Mountain View, CA", key })}`],
    ] : id === "klipy" ? [["GIF search", `https://api.klipy.com/v2/search?${new URLSearchParams({ q: "hello", key, limit: "1", contentfilter: "off", media_filter: "gif", client_key: "neural-labs-workspace" })}`]]
      : [["Photo search", "https://api.pexels.com/v1/search?query=nature&per_page=1", { headers: { Authorization: key } }]];
    const capabilities = await Promise.all(requests.map(async ([name, url, init]) => {
      try {
        const response = await this.fetchFn(url, { ...init, redirect: "error", signal: AbortSignal.timeout(10_000) });
        if (!response.ok) {
          await response.body?.cancel();
          return { name, ok: false, message: [401, 403].includes(response.status) ? "Check the API key, permissions, and enabled APIs." : "Provider unavailable. Try again later." };
        }
        const payload = await boundedJson(response, 2 * 1024 * 1024) as { status?: string; error?: unknown };
        const ok = !payload.error && (!payload.status || ["OK", "ZERO_RESULTS"].includes(payload.status));
        return { name, ok, message: ok ? "Connection works" : "Check the API key, permissions, billing, and enabled APIs." };
      } catch { return { name, ok: false, message: "Provider unavailable or response interrupted. Try again later." }; }
    }));
    return { revision, capabilities };
  }
}

async function boundedJson(response: Response, limit: number): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty response");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error("Response too large");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { await reader.cancel().catch(() => {}); }
}
