// Versioned fallback recommendations, used only within an already selected
// provider and workload. Account availability and capabilities still win.
import { CLAUDE_RUNTIME } from "./claude-runtime.mjs";
import { fileURLToPath } from "node:url";

export const RECOMMENDATIONS = Object.freeze({
  version: "2026-09-19.1",
  openai: ["openai/gpt-6-astra", "openai/gpt-5.6-sol"],
  anthropic: ["anthropic/claude-opus-5", "anthropic/claude-sonnet-5"],
});

export function resolveModelPolicy(policy, catalog, previous) {
  if (!policy || !["latest", "pinned"].includes(policy.mode) || typeof policy.effort !== "string") throw new Error("Invalid model policy");
  if (catalog.stale) throw new Error("Refresh the model catalog before changing defaults");
  const compatible = (model) => model?.available && model.supportsTools && (!policy.effort || model.efforts.some((effort) => effort.id === policy.effort));
  const byId = new Map(catalog.models.map((model) => [model.id, model]));
  let selected;
  let held = false;
  if (policy.mode === "pinned") {
    selected = byId.get(policy.model);
    if (!compatible(selected)) throw new Error("The pinned model or reasoning level is not available for this connection");
  } else {
    // Do not upgrade past an explicitly selected effort by silently changing it.
    const recommended = RECOMMENDATIONS[policy.provider]?.map((id) => byId.get(id)).find((model) => model?.available && model.supportsTools);
    if (compatible(recommended)) selected = recommended;
    else if (previous?.model?.startsWith(`${policy.provider}/`) && compatible(byId.get(previous.model))) {
      selected = byId.get(previous.model);
      held = true;
    } else throw new Error("No compatible recommendation is available. Choose an available model explicitly.");
  }
  if (selected.provider !== policy.provider) throw new Error("Changing provider requires a separate connection");
  // Delegated runtimes can offer a model without publishing reasoning
  // controls. An automatic policy must let that runtime choose its default.
  const effort = policy.effort || selected.defaultEffort || "";
  return { model: selected.id, effort, held, catalogFetchedAt: catalog.fetchedAt, registryVersion: RECOMMENDATIONS.version };
}

export class ModelPolicies {
  constructor({ personalOpenAI, catalog, teamOpenAI, claudeAccounts }) {
    this.personalOpenAI = personalOpenAI;
    this.catalog = catalog;
    this.teamOpenAI = teamOpenAI;
    this.claudeAccounts = claudeAccounts;
    this.applied = new Map();
  }

  async inspect(userId, workload = "background") {
    const agentId = userId ? (await this.personalOpenAI.ensureProvisioned(userId)).agentId : workload === "team" ? this.teamOpenAI.agentId : "main";
    const agents = await this.personalOpenAI.openclawJson(["config", "get", "agents", "--json"]);
    const entry = agents?.entries?.[agentId] ?? {};
    const model = entry.model ?? agents?.defaults?.model;
    return { agentId, model: typeof model === "string" ? model : model?.primary ?? null, effort: entry.thinkingDefault ?? agents?.defaults?.thinkingDefault ?? null, explicitModel: Boolean(entry.model), explicitEffort: Boolean(entry.thinkingDefault) };
  }

  async apply({ userId, policy, revision, previous, workload = "background" }) {
    if (!Number.isSafeInteger(revision) || revision < 1 || !["openai", "anthropic"].includes(policy?.provider)) throw new Error("Unsupported provider policy");
    const agentId = userId ? (await this.personalOpenAI.ensureProvisioned(userId)).agentId : workload === "team" ? policy.provider === "anthropic" ? await this.teamOpenAI.ensureProvisioned() : await this.teamOpenAI.prepareRun() : "main";
    if (policy.provider === "anthropic" && !(await this.claudeAccounts?.snapshot({ userId, workload }))?.modelReady) throw new Error("Connect or resume Claude before selecting it");
    const catalog = await this.catalog.list({ userId, agentId, refresh: true });
    const resolved = resolveModelPolicy(policy, catalog, previous);
    return this.personalOpenAI.queueMutation(async () => {
      const latest = this.applied.get(agentId);
      if (latest && latest.revision > revision) throw new Error("A newer model policy is already active");
      // Published fields update in one native config transaction. Utility models,
      // session pins, cron pins, credentials and tool policy are untouched.
      const operations = [
        ...(policy.provider === "anthropic" ? [{ path: `agents.entries.${agentId}.models["${resolved.model}"].agentRuntime`, value: { id: CLAUDE_RUNTIME } }] : []),
        { path: `agents.entries.${agentId}.model`, value: { primary: resolved.model, fallbacks: [] } },
        ...(resolved.effort ? [{ path: `agents.entries.${agentId}.thinkingDefault`, value: resolved.effort }] : []),
      ];
      await this.personalOpenAI.execute(process.execPath, [fileURLToPath(new URL("./native-config-batch.mjs", import.meta.url)), JSON.stringify(operations)], {
        encoding: "utf8", timeout: 120_000, maxBuffer: 1024 * 1024,
      });
      const result = { ...resolved, revision, agentId };
      this.applied.set(agentId, result);
      this.catalog.invalidate?.(userId);
      return result;
    });
  }
}
