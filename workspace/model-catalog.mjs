// Public, credential-free catalog shared by every Neural Labs model picker.
// Availability and reasoning options come from the selected agent's runtime,
// not from an API model list that may describe a different subscription.
export function modelCredentialSource(authentication, models) {
  const provider = models?.auth?.providers?.find((row) => row?.provider === "openai");
  if (provider?.effective?.kind === "env") return "environment-api-key";
  if (authentication?.profiles?.some((row) => row?.provider === "openai" && row?.type === "oauth")) return "chatgpt";
  if (provider?.effective?.kind === "profiles") return "stored-credential";
  return "unconfigured";
}

export function publicModelCatalog(payload) {
  const rows = Array.isArray(payload?.models) ? payload.models : [];
  return rows.flatMap((row) => {
    if (typeof row?.id !== "string" || typeof row?.provider !== "string") return [];
    const id = row.id.startsWith(`${row.provider}/`) ? row.id : `${row.provider}/${row.id}`;
    const efforts = Array.isArray(row.thinkingLevels)
      ? row.thinkingLevels.filter((level) => typeof level?.id === "string" && typeof level?.label === "string")
        .map(({ id, label }) => ({ id, label }))
      : [];
    return [{
      id, provider: row.provider, name: typeof row.name === "string" ? row.name : row.id,
      available: row.available === true,
      unavailableReason: row.available === true ? null : ["missing-auth", "auth-failed", "cooldown"].includes(row.unavailableReason)
        ? row.unavailableReason : "Availability has not been verified",
      efforts, defaultEffort: typeof row.thinkingDefault === "string" ? row.thinkingDefault : null,
      // OpenClaw's native supportsModelTools defaults legacy catalog entries
      // to tool-enabled. Only an explicit false opts out; missing auth still
      // remains unavailable above.
      supportsTools: row.supportsTools !== false,
      input: Array.isArray(row.input) ? row.input.filter((value) => ["text", "image", "audio", "video", "document"].includes(value)) : [],
    }];
  });
}

export class ModelCatalog {
  constructor({ gatewayRequest, personalOpenAI, teamOpenAI, claudeAccounts, runtime, now = Date.now, ttlMs = 3_600_000 }) {
    this.gatewayRequest = gatewayRequest;
    this.personalOpenAI = personalOpenAI;
    this.teamOpenAI = teamOpenAI;
    this.claudeAccounts = claudeAccounts;
    this.runtime = runtime;
    this.now = now;
    this.ttlMs = ttlMs;
    this.cache = new Map();
    this.pending = new Map();
    this.refreshing = new Set();
  }

  async list({ userId, agentId, refresh = false } = {}) {
    // An untrusted browser must never be able to choose another user's agent.
    if (userId) agentId = (await this.personalOpenAI.ensureProvisioned(userId)).agentId;
    else agentId ||= "main";
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/u.test(agentId)) throw new Error("Invalid agent");
    const cacheKey = `${userId ? "personal" : "workspace"}:${agentId}`;
    const cached = this.cache.get(cacheKey);
    if (!refresh && cached && this.now() - cached.fetchedAtMs < this.ttlMs) return cached;
    if (this.pending.has(cacheKey)) {
      if (refresh && !this.refreshing.has(cacheKey)) {
        await this.pending.get(cacheKey).catch(() => undefined);
        return this.list({ userId, agentId, refresh: true });
      }
      return this.pending.get(cacheKey);
    }
    if (refresh) this.refreshing.add(cacheKey);
    const task = (async () => {
      try {
        // Settings loads the connection and catalog concurrently. Provision
        // the dedicated owner before asking Gateway for its models; this does
        // not start OAuth, assign a user to Team, or activate a Team policy.
        if (!userId && this.teamOpenAI && agentId === this.teamOpenAI.agentId) {
          await this.teamOpenAI.ensureProvisioned();
        }
        const payload = await this.gatewayRequest("models.list", {
          agentId, view: "default", includeProviderCapabilities: true,
          ...(refresh || cached ? { refresh: true } : { preparedOnly: true }),
        });
        const roster = await this.gatewayRequest("agents.list", {}).catch(() => undefined);
        const agent = roster?.agents?.find((row) => row.id === agentId);
        const defaultModel = typeof agent?.model?.primary === "string" ? agent.model.primary : null;
        let models = publicModelCatalog(payload);
        // Personal access uses only explicitly supported owner-bound adapters.
        // Do not expose a workspace environment-key route as a personal option.
        if (userId) {
          const account = await this.personalOpenAI.snapshot(userId);
          models = models.filter((model) => model.provider === "openai").map((model) => ({
            ...model, available: model.available && account.authenticated && !account.paused,
            unavailableReason: !account.authenticated || account.paused ? "Connect or resume your personal account" : model.unavailableReason,
          }));
        }
        if (this.claudeAccounts && (userId || agentId === "main" || agentId === this.teamOpenAI?.agentId)) {
          const claude = await this.claudeAccounts.snapshot(userId ? { userId } : { workload: agentId === this.teamOpenAI?.agentId ? "team" : "background" });
          // Native CLI login is private to this owner. Gateway's ambient auth
          // probe cannot attest it; only supplement missing-auth catalog rows.
          const nativeRows = publicModelCatalog(payload).filter(row => row.provider === "anthropic");
          models = models.filter(row => row.provider !== "anthropic").concat(nativeRows.map(row => ({ ...row,
            available: claude.modelReady && (row.available || row.unavailableReason === "missing-auth"),
            unavailableReason: !claude.modelReady ? "Connect or resume this Claude connection" : row.unavailableReason === "missing-auth" ? null : row.unavailableReason,
          })));
        }
        const fetchedAtMs = this.now();
        const result = { agentId, defaultModel, models, ...(this.runtime ? { runtime: this.runtime } : {}), fetchedAt: new Date(fetchedAtMs).toISOString(), fetchedAtMs, stale: false };
        this.cache.set(cacheKey, result);
        return result;
      } catch {
        if (cached) return { ...cached, stale: true, message: "Refresh failed. Showing the last known catalog; availability must be checked again before running." };
        throw new Error("The model catalog is unavailable. Check the provider connection and runtime status.");
      } finally {
        this.pending.delete(cacheKey);
        this.refreshing.delete(cacheKey);
      }
    })();
    this.pending.set(cacheKey, task);
    return task;
  }

  invalidate(userId) {
    if (userId) {
      const agentId = this.personalOpenAI.account(userId).agentId;
      this.cache.delete(`personal:${agentId}`);
      this.cache.delete(`workspace:${agentId}`);
    }
    else this.cache.clear();
  }
}
