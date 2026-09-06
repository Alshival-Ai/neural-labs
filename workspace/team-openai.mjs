import { createProviderAuthController } from "./provider-auth.mjs";

// The dedicated team agent owns its OAuth refresh state. Never copy a human's
// credentials or borrow the main agent's OAuth store for an isolated exec run.
export class TeamOpenAI {
  constructor(personalOpenAI) {
    this.manager = personalOpenAI;
    this.owner = "team-neura";
    this.account = personalOpenAI.account(this.owner);
    this.agentId = this.account.agentId;
    this.controller = createProviderAuthController({
      providerAuthenticated: () => this.account.authenticated,
      modelReady: () => this.account.modelReady,
      refreshStatus: () => this.manager.refresh(this.account),
      spawnLogin: () => this.manager.spawnLogin(this.agentId, this.account.profileId),
    });
  }
  async ensureProvisioned() {
    await this.manager.ensureProvisioned(this.owner);
  }
  async snapshot() {
    await this.ensureProvisioned();
    if (!["starting", "awaiting_user"].includes(this.controller.snapshot().state)) await this.manager.refresh(this.account);
    return { ...this.controller.snapshot(), agentId: this.agentId, paused: false };
  }
  async start() {
    await this.ensureProvisioned();
    await this.manager.refresh(this.account);
    return { ...this.controller.start(), agentId: this.agentId, paused: false };
  }
  cancel() { return { ...this.controller.cancel(), agentId: this.agentId, paused: false }; }
  async prepareRun() {
    const status = await this.snapshot();
    if (!status.authenticated || !status.modelReady) throw new Error("An administrator must connect the Team Neura ChatGPT account in Workspace settings");
    return this.agentId;
  }
}
