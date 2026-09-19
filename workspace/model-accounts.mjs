import { fileURLToPath } from "node:url";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { CLAUDE_RUNTIME } from "./claude-runtime.mjs";
import { randomUUID } from "node:crypto";

// Public account access is independent of the provider that originally
// provisioned the Neura agent. Credentials stay with their native managers.
export class ModelAccounts {
  constructor({ openai, claude, team, catalog }) {
    this.openai = openai; this.claude = claude; this.team = team; this.catalog = catalog;
    claude.onChange = owner => this.changed(owner);
    openai.otherProviderReady = async userId => (await claude.snapshot({ userId })).modelReady;
    openai.readProviderPause = userId => this.openAIPaused(userId);
    openai.writeProviderPause = (userId, paused) => this.saveOpenAIPause(userId, paused);
  }
  async openAIPaused(userId) {
    const id = this.openai.account(userId).agentId;
    try { const state = JSON.parse(await readFile(path.join(this.openai.stateRoot, "agents", id, "agent", "neural-labs-openai.json"), "utf8")); if (typeof state.paused !== "boolean") throw new Error("Invalid pause state"); return state.paused; }
    catch (error) { if (error.code === "ENOENT") return undefined; throw new Error("OpenAI connection state is unreadable"); }
  }
  async saveOpenAIPause(userId, paused) {
    const id = this.openai.account(userId).agentId;
    const dir = path.join(this.openai.stateRoot, "agents", id, "agent"); await mkdir(dir, { recursive: true });
    const target = path.join(dir, "neural-labs-openai.json"), temp = `${target}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify({ paused }), { mode: 0o600 }); await rename(temp, target);
    if (paused) {
      await this.openai.execute(process.execPath, [fileURLToPath(new URL("./native-provider-order.mjs", import.meta.url)), dir, "openai", "paused"], { timeout: 30_000 });
      await this.openai.gatewayRequest("models.authStatus", { agentId: id, refresh: true });
    }
  }
  async changed(owner) {
    this.catalog?.invalidate(owner.userId);
    const id = await this.claude.owner(owner);
    const caStatus = await this.claude.snapshot(owner);
    // Bind every discoverable Claude model so explicit conversation/job picks
    // use the same owner-scoped runtime as the default model.
    if (caStatus.authenticated && !caStatus.paused) await this.openai.queueMutation(async () => {
      const [agents, listed] = await Promise.all([
        this.openai.openclawJson(["config", "get", "agents", "--json"]),
        this.openai.gatewayRequest("models.list", { agentId: id, view: "all", includeProviderCapabilities: true, refresh: true }),
      ]);
      const models = { ...agents.entries?.[id]?.models };
      for (const row of listed.models ?? []) if (row.provider === "anthropic") {
        const ref = row.id.startsWith("anthropic/") ? row.id : `anthropic/${row.id}`;
        models[ref] = { ...models[ref], agentRuntime: { id: CLAUDE_RUNTIME } };
      }
      if (!Object.values(models).some(row => row.agentRuntime?.id === CLAUDE_RUNTIME)) throw new Error("The Claude model catalog is unavailable");
      await this.openai.execute("openclaw", ["config", "set", `agents.entries.${id}.models`, JSON.stringify(models), "--strict-json"], { timeout: 30_000 });
    });
    if (caStatus.paused) {
      const listed = await this.openai.gatewayRequest("sessions.list", { agentId: id, limit: 500 });
      for (const session of listed.sessions ?? []) if (session.modelProvider === "anthropic" || session.model?.startsWith("anthropic/")) {
        await this.openai.gatewayRequest("chat.abort", { sessionKey: session.key });
      }
    }
    if (!owner.userId) return;
    const account = await this.openai.ensureProvisioned(owner.userId);
    const oa = await this.openai.snapshot(owner.userId), ca = await this.claude.snapshot(owner);
    await this.openai.assignRole(owner.userId, (!oa.paused && oa.authenticated) || ca.modelReady ? account.roleId : "unlinked");
  }
  async selectedModel(userId) {
    const account = await this.openai.ensureProvisioned(userId);
    const agents = await this.openai.openclawJson(["config", "get", "agents", "--json"]);
    const model = agents.entries?.[account.agentId]?.model ?? agents.defaults?.model;
    return typeof model === "string" ? model : model?.primary;
  }
  async snapshot(userId) {
    const model = await this.selectedModel(userId);
    const result = model?.startsWith("anthropic/") ? await this.claude.snapshot({ userId }) : await this.openai.snapshot(userId);
    return { ...result, selectedModel: model ?? null };
  }
  async prepareExecution(userId, model) {
    model ||= await this.selectedModel(userId);
    const status = model?.startsWith("anthropic/") ? await this.claude.snapshot({ userId }) : await this.openai.snapshot(userId);
    if (status.paused || !status.authenticated || !status.modelReady) {
      const error = new Error("Connect or resume the selected model provider in Settings → Model Provider"); error.code = "personal_openai_required"; throw error;
    }
    return { agentId: status.agentId, model };
  }
  async prepareRun(userId, model) { return (await this.prepareExecution(userId, model)).agentId; }
  async prepareTeamRun(model) {
    if (!model?.startsWith("anthropic/")) return this.team.prepareRun();
    const status = await this.claude.snapshot({ workload: "team" });
    if (!status.modelReady) throw new Error("Connect or resume Team Neura's Claude connection in Workspace settings");
    return status.agentId;
  }
}
