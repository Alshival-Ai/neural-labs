import { NativeScheduler } from "./schedules.mjs";
import { NativeJobs } from "./jobs.mjs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { canonical, identity, NativeState } from "./state.mjs";
import { NativeTurns } from "./turns.mjs";
import { NativeAccounts } from "./accounts.mjs";
import { nativeModelCatalog } from "./models.mjs";
import { NativeSkillHistory } from "./skill-history.mjs";
import { createNativeLauncher, prepareNativeHome, NATIVE_HOME, NATIVE_WORKSPACE } from "./launcher.mjs";

function session(row) {
  return { key: row.id, sessionId: row.id, title: row.title || "New conversation", updatedAt: row.updated_at || row.created_at,
    archived: Boolean(row.archived), active: Boolean(row.active), visibility: "draft", sharingRole: "owner", modelOverride: row.model || undefined, thinkingLevel: row.effort || undefined };
}
export function controlPlaneAuthority({ origin, token, request = fetch }) {
  return async lease => {
    const scheduled = typeof lease === "object" && lease?.job;
    const team = typeof lease === "object" && lease?.team;
    if (!scheduled && !team) identity(lease);
    const url = new URL(scheduled ? "/internal/native/background" : team ? "/internal/native/team" : "/internal/native/lease", origin);
    const response = await request(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(5000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(scheduled || team ? lease : { lease }) });
    if (!response.ok) throw new Error("Native execution authorization was revoked or is unavailable");
    return response.json();
  };
}

export class NativeRuntime {
  constructor({ stateRoot, workspaceRoot, authorize, state, providers, tools, skills, launcher = createNativeLauncher, accounts, terminals, spawnPty, resolveActor }) {
    if (typeof authorize !== "function") throw new Error("Native authority is required");
    this.root = stateRoot; this.workspaceRoot = workspaceRoot; this.authorize = authorize; this.launcher = launcher;
    this.skills = skills;
    this.state = state || new NativeState(path.join(stateRoot, "runtime.sqlite"));
    this.skillHistory = new NativeSkillHistory(this.state);
    this.accounts = accounts || new NativeAccounts({ terminals, spawnPty, resolveActor });
    this.executionGrants = new Map();
    this.teamExecutions = new Map();
    this.jobs = new NativeJobs({ state: this.state, changed: async () => this.triggers?.refresh(),
      authorizeReview: async (actorGrant, definition) => {
        const selected = definition.connection;
        const grant = await this.execution(definition.actor, { job: definition.id, actor: definition.actor,
          connection: selected.owner, generation: selected.generation, provider: selected.provider, method: selected.method,
          model: definition.model, policy: definition.executionPolicy }, "scheduled-run", definition.executionPolicy);
        if (!grant.background) throw new Error("Separate background authorization is required");
        return async () => {
          if (this.turns.gated) throw new Error("Native runtime admission is closed");
          await actorGrant.revalidate(); await grant.revalidate();
        };
      } });
    this.turns = new NativeTurns({ state: this.state, providers, tools,
      resolveExecution: ({ actor, selection, purpose }) => this.execution(actor, selection, purpose) });
    this.scheduler = new NativeScheduler({ state: this.state,
      authorize: async ({ job, actor, connection, manual }) => {
        const definition = job.definition, selected = definition.connection;
        if (definition.payload?.kind !== "agentTurn" || typeof definition.payload.message !== "string"
            || !["read-only", "workspace-write"].includes(definition.executionPolicy?.sandbox)
            || definition.executionPolicy?.approval !== "on-request") throw new Error("Saved automation policy requires review");
        const selection = manual ? connection : { job: job.id, actor: definition.actor, connection: selected?.owner,
          generation: selected?.generation, provider: selected?.provider, method: selected?.method,
          model: definition.model, policy: definition.executionPolicy };
        const grant = await this.execution(manual ? actor : definition.actor, selection, "scheduled-run", definition.executionPolicy);
        if (!manual && !grant.background || manual && grant.background) throw new Error("Automation execution authority mismatch");
        return { ...grant, selection, connection: grant.binding, effort: definition.payload.thinking || null,
          ...(definition.payload.timeoutSeconds ? { timeoutMs: definition.payload.timeoutSeconds * 1000 } : {}) };
      },
      execute: async ({ id, job, binding }) => {
        binding = { ...binding, jobId: job.id, occurrenceId: id };
        // This unforgeable in-process selection carries the already authorized
        // saved policy. Browsers cannot encode a Symbol or choose filesystem paths.
        const selection = Symbol(id); this.executionGrants.set(selection, binding);
        try {
          const { id: conversation } = await this.turns.create(binding.actor, selection);
          this.state.updateConversation(conversation, binding.actor, binding.binding, { title: `Automation: ${job.definition.name || job.id}`.slice(0, 200), archived: true, model: binding.model });
          const turn = await this.turns.start(binding.actor, selection, { conversation, requestId: id,
            input: [{ type: "text", text: job.definition.payload.message }] });
          const outcome = await this.turns.active.get(turn.id)?.done;
          const row = this.state.db.prepare("SELECT status FROM turns WHERE id=?").get(turn.id);
          return { status: outcome?.status || row?.status || "unknown", result: { conversation, turn: turn.id } };
        } finally { this.executionGrants.delete(selection); }
      },
    });
  }
  async execution(actor, lease, purpose, savedPolicy) {
    if (typeof lease === "symbol") {
      const grant = this.executionGrants.get(lease);
      if (!grant || grant.actor !== actor) throw new Error("Native execution selection is unavailable");
      await grant.revalidate(); return grant;
    }
    const original = await this.authorize(lease);
    if (!original || original.actor !== actor || typeof original.background !== "boolean") throw new Error("Native actor binding failed");
    identity(original.connection); identity(original.binding?.owner);
    if (original.binding.owner !== original.connection) throw new Error("Native credential owner binding failed");
    const binding = canonical(original.binding);
    const homeRoot = path.join(this.root, "accounts", original.connection);
    await prepareNativeHome(homeRoot);
    const policy = { ...original.policy,
      sandbox: savedPolicy?.sandbox === "read-only" ? "read-only" : original.policy?.sandbox };
    const launch = await this.launcher({ workspaceRoot: this.workspaceRoot, homeRoot,
      readOnly: policy.sandbox === "read-only" });
    const revalidate = async () => {
      const current = await this.authorize(lease);
      if (current.actor !== actor || current.actorRole !== original.actorRole || current.scope !== original.scope
          || current.connection !== original.connection || canonical(current.binding) !== binding
          || current.model !== original.model || current.background !== original.background || current.authorityGeneration !== original.authorityGeneration
          || canonical(current.team ?? null) !== canonical(original.team ?? null) || canonical(current.policy) !== canonical(original.policy)) {
        throw new Error("Native execution binding changed");
      }
    };
    this.accounts.watch?.(original.connection, homeRoot);
    const grant = { ...original, policy, revalidate, launch, home: NATIVE_HOME, cwd: NATIVE_WORKSPACE,
      deliveryEnabled: () => this.state.metadata("delivery") === "enabled",
      credentialHome: `${NATIVE_HOME}/${original.binding.provider === "codex" ? ".codex" : ".claude"}` };
    if (this.skills) grant.prepareLaunch = async input => {
      await revalidate();
      const prepared = await this.skills.prepare({ actor, input, provider: original.binding.provider,
        ...(grant.team ? { requestedSkillText: grant.teamTrigger, scope: "team" } : {}) });
      try {
        const launch = await this.launcher({ workspaceRoot: this.workspaceRoot, homeRoot,
          readOnly: policy.sandbox === "read-only", extraReadOnly: prepared.mounts, skillDiscoveryRoot: prepared.discovery });
        await revalidate();
        return { ...prepared, launch };
      } catch (error) { await prepared.release(); throw error; }
    };
    if (["turn-start", "scheduled-run"].includes(purpose)) {
      const status = await this.accounts.status(grant, launch);
      if (!status.ready) throw new Error("The selected account requires native sign-in");
    }
    return grant;
  }
  async runTeam({ run, channel, actor, capability, prompt, trigger, signal }) {
    identity(run); identity(channel); identity(actor);
    if (typeof capability !== "string" || capability.length < 32 || typeof prompt !== "string" || !prompt.trim()
        || typeof trigger !== "string" || Buffer.byteLength(trigger) > 128 * 1024
        || Buffer.byteLength(prompt) > 2 * 1024 * 1024) throw new Error("Invalid Team Chat run");
    if (this.turns.gated) throw new Error("Native runtime admission is closed");
    const lease = { team: true, run, channel, actor, capability };
    let grant;
    try { grant = await this.execution(actor, lease, "team-run"); }
    catch {
      throw Object.assign(new Error("Ask an administrator to check the Team AI connection in Settings → Model Provider."),
        { code: "team_connection_required" });
    }
    if (grant.purpose !== "team-run" || grant.scope !== "team" || grant.team?.run !== run
        || grant.team?.channel !== channel || grant.team?.capability !== capability)
      throw new Error("Team Chat execution binding failed");
    grant.teamTrigger = trigger;
    if (!(await this.accounts.status(grant, grant.launch)).ready)
      throw Object.assign(new Error("The Team AI account needs sign-in in Settings → Model Provider."),
        { code: "team_connection_required" });
    const selection = Symbol(run);
    this.executionGrants.set(selection, grant);
    let turnId;
    const abort = () => { if (turnId) void this.turns.cancel(actor, selection, turnId).catch(() => {}); };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      if (signal?.aborted) throw new Error("Team Chat run was cancelled");
      const conversation = (await this.turns.create(actor, selection)).id;
      this.state.updateConversation(conversation, actor, grant.binding,
        { title: `Team Chat ${channel}`, archived: true, model: grant.model });
      const turn = await this.turns.start(actor, selection, { conversation, requestId: run,
        input: [{ type: "text", text: prompt }] });
      turnId = turn.id;
      this.teamExecutions.set(run, { actor, selection, turn: turn.id, grant });
      if (signal?.aborted) abort();
      const outcome = await this.turns.active.get(turn.id)?.done;
      if (outcome?.status !== "succeeded") throw new Error("Team Chat native turn did not complete");
      await grant.revalidate();
      const events = this.state.events(conversation, actor, grant.binding, 0);
      const reply = events.filter(event => event.type === "output" && typeof event.payload?.text === "string")
        .map(event => event.payload.text).join("").trim();
      if (!reply) throw new Error("Team Chat native turn produced no reply");
      return { reply };
    } finally { signal?.removeEventListener("abort", abort); this.teamExecutions.delete(run); this.executionGrants.delete(selection); }
  }
  async teamApprovals(run) {
    identity(run);
    const active = this.teamExecutions.get(run);
    if (!active) return { approvals: [] };
    await active.grant.revalidate();
    return { approvals: [...this.turns.approvals.entries()]
      .filter(([, pending]) => pending.execution.id === active.turn)
      .map(([id, pending]) => ({ id, request: pending.request })) };
  }
  async resolveTeamApproval(run, approval, decision) {
    identity(run); identity(approval);
    if (!["accept", "decline", "cancel"].includes(decision)) throw new Error("Invalid Team Chat approval decision");
    const active = this.teamExecutions.get(run);
    if (!active) throw new Error("Team Chat run is no longer active");
    await active.grant.revalidate();
    const pending = this.turns.approvals.get(approval);
    if (!pending || pending.execution.id !== active.turn) throw new Error("Team Chat approval is unavailable");
    if (pending.request.method === "item/tool/requestUserInput") {
      if (decision === "accept") throw new Error("This Team Chat request needs an answer, not permission");
      await this.turns.cancel(active.actor, active.selection, active.turn);
      return { ok: true };
    }
    await this.turns.approve(active.actor, active.selection, approval,
      pending.request.method === "mcpServer/elicitation/request" ? { action: decision } : { decision });
    return { ok: true };
  }
  async handle({ actor, lease, operation, params = {} }) {
    identity(actor); identity(lease);
    const authorization = await this.authorize(lease);
    if (authorization.actor !== actor || authorization.purpose !== operation) throw new Error("Native request authority mismatch");
    if (!params || Array.isArray(params) || typeof params !== "object") throw new Error("Invalid native request parameters");
    if (operation === "models.list") {
      if (this.turns.gated) throw new Error("Native runtime admission is closed");
      const grant = await this.execution(actor, lease, operation);
      return nativeModelCatalog(grant, await this.accounts.status(grant, grant.launch));
    }
    if (operation === "jobs.snapshot") return this.jobs.snapshot(authorization);
    if (operation === "jobs.review") {
      if (this.turns.gated) throw new Error("Native runtime admission is closed");
      const grant = await this.execution(actor, lease, operation);
      return this.jobs.review(grant, params);
    }
    if (["jobs.create", "jobs.update", "jobs.remove"].includes(operation)) {
      if (this.turns.gated) throw new Error("Native runtime admission is closed");
      return this.jobs[operation.split(".")[1]](authorization, params);
    }
    if (operation === "conversations.create") {
      const created = await this.turns.create(actor, lease);
      this.state.updateConversation(created.id, actor, authorization.binding, { model: authorization.model });
      return { session: session(this.state.listConversations(actor, authorization.binding).find(row => row.id === created.id)) };
    }
    if (operation === "conversations.list") return { sessions: this.state.listConversations(actor, authorization.binding).map(session) };
    if (["conversations.update", "conversations.delete"].includes(operation)) {
      if (this.turns.gated) throw new Error("Native runtime admission is closed");
      this.state.updateConversation(params.conversation, actor, authorization.binding,
        operation.endsWith("delete") ? { deleted: true } : params.patch);
      return { ok: true };
    }
    if (operation === "jobs.run") {
      identity(params.job); identity(params.requestId);
      return this.scheduler.launch(params.job, `manual:${params.requestId}`, { actor, connection: lease, manual: true, mode: params.mode ?? "force", requestId: params.requestId });
    }
    if (operation === "turns.start") {
      this.state.conversation(params.conversation, actor, authorization.binding);
      const profile = this.state.db.prepare("SELECT model,effort FROM conversation_profiles WHERE conversation=?").get(params.conversation);
      if (profile?.model && profile.model !== authorization.model) throw new Error("The selected model does not match this conversation");
      const attachments = params.attachments ?? [];
      if (!Array.isArray(attachments) || attachments.length > 100) throw new Error("Invalid attachments");
      const workspace = await realpath(this.workspaceRoot);
      for (const item of attachments) {
        if (!item || typeof item.path !== "string" || item.path.startsWith("/") || item.path.split("/").some(part => !part || [".", ".."].includes(part))) throw new Error("Invalid attachment path");
        const source = await realpath(path.join(workspace, item.path));
        if (!source.startsWith(`${workspace}/`) || !(await stat(source)).isFile()) throw new Error("Attachment is outside the workspace");
      }
      return this.turns.start(actor, lease, { ...params, attachments, effort: profile?.effort });
    }
    if (operation === "turns.cancel") { await this.turns.cancel(actor, lease, params.turn); return { ok: true }; }
    if (operation === "approvals.resolve") { await this.turns.approve(actor, lease, params.approval, params.decision); return { ok: true }; }
    if (operation === "events.read") {
      let events = await this.turns.events(actor, lease, params.conversation, params.after ?? 0);
      if (!Number.isInteger(params.waitMs ?? 0) || (params.waitMs ?? 0) < 0 || (params.waitMs ?? 0) > 15000) throw new Error("Invalid event wait");
      if (!events.length && params.waitMs) {
        await new Promise(resolve => {
          let batchTimer;
          const changed = event => {
            if (event.conversation === params.conversation && !batchTimer) batchTimer = setTimeout(finish, 25);
          };
          const finish = () => { clearTimeout(timer); clearTimeout(batchTimer); this.turns.off("event", changed); resolve(); };
          const timer = setTimeout(finish, params.waitMs);
          this.turns.on("event", changed);
          // Subscribe before checking again so completion between the first
          // read and listener registration cannot be missed.
          if (this.state.events(params.conversation, actor, authorization.binding, params.after ?? 0).length) changed({ conversation: params.conversation });
        });
        events = await this.turns.events(actor, lease, params.conversation, params.after ?? 0);
      }
      return { events, cursor: events.at(-1)?.id ?? params.after ?? 0 };
    }
    if (["account.status", "account.refresh", "account.login", "account.cancel"].includes(operation)) {
      if (this.turns.gated) throw new Error("Native runtime admission is closed");
      const grant = await this.execution(actor, lease, operation);
      return operation === "account.login" ? this.accounts.login(grant, grant.launch)
        : operation === "account.cancel" ? this.accounts.cancel(grant) : this.accounts.status(grant, grant.launch);
    }
    throw new Error("Unsupported native runtime operation");
  }
  async close() {
    // Closing admission is process-local. A graceful restart must preserve the
    // operator's activation decision and each job's intended enabled state.
    this.scheduler.closed = true; this.turns.gated = true;
    await this.scheduler.drain(); await this.turns.drain(); this.accounts.close?.(); this.state.close();
  }
  async revoke(actor) {
    identity(actor); this.turns.revoke(actor);
    for (const row of this.state.db.prepare("SELECT id FROM jobs").all()) {
      const job = this.state.job(row.id);
      if (job.definition.actor === actor && !job.hold) this.state.db.prepare("UPDATE jobs SET hold='membership-revoked' WHERE id=?").run(job.id);
    }
    await this.triggers?.refresh(); return { revoked: true };
  }
}
