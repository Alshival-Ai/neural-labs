import { spawn, execFile } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { GatewayClient } from "@openclaw/gateway-client";
import { PROTOCOL_VERSION } from "@openclaw/gateway-protocol/version";

import { createProviderAuthController } from "./provider-auth.mjs";

const execFileAsync = promisify(execFile);
const USER_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u;
const USER_SCOPES = ["operator.read", "operator.write", "operator.approvals", "operator.questions"];

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function personalAgentId(userId) {
  const normalized = String(userId ?? "").trim().toLowerCase();
  if (!USER_ID_PATTERN.test(normalized)) throw new Error("The Neural Labs user id is invalid");
  return `nl-${normalized.replace(/[^a-z0-9]/gu, "")}`.slice(0, 63);
}

export function personalRoleId(userId) {
  return `personal-${personalAgentId(userId)}`;
}

export function personalProfileId(userId) {
  return `openai:${personalAgentId(userId)}`;
}

export function createGatewayAdminRequest({ url, password, timeoutMs = 15_000 }) {
  if (!url || !password) throw new Error("The internal Gateway URL and password are required");
  return (method, params) => new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.stop();
      if (error) reject(error);
      else resolve(value);
    };
    const client = new GatewayClient({
      url,
      password,
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      role: "operator",
      scopes: ["operator.admin"],
      clientDisplayName: "Neural Labs account controller",
      onHelloOk: () => void client.request(method, params).then(
        (value) => finish(undefined, value),
        (error) => finish(error),
      ),
      onConnectError: (error) => finish(error),
      onClose: (code, reason) => finish(new Error(`Gateway admin connection closed (${code} ${reason})`)),
    });
    timer = setTimeout(() => finish(new Error("Gateway admin request timed out")), timeoutMs);
    timer.unref?.();
    client.start();
  });
}

function personalLoginProcess(agentId, profileId) {
  const command = `openclaw models auth login --agent ${agentId} --provider openai --device-code --profile-id ${profileId}`;
  return spawn("script", ["-qefc", command, "/dev/null"], {
    detached: true,
    env: { ...process.env, NO_COLOR: "1", TERM: "dumb" },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function ownsPersonalAuthStore(payload, agentId) {
  const authStatePath = String(payload?.authStatePath ?? "").replaceAll("\\", "/");
  return authStatePath.endsWith(`/agents/${agentId}/agent/openclaw-agent.sqlite`);
}

function authenticationState(payload, account) {
  return ownsPersonalAuthStore(payload, account.agentId) &&
    Array.isArray(payload?.profiles) && payload.profiles.some(
      (profile) =>
        profile?.id === account.profileId &&
        profile?.provider === "openai" &&
        profile?.type === "oauth",
    );
}

function personalOrderState(payload, account) {
  return ownsPersonalAuthStore(payload, account.agentId) &&
    Array.isArray(payload?.order) &&
    payload.order.length === 1 &&
    payload.order[0] === account.profileId;
}

function modelState(payload) {
  return Array.isArray(payload?.auth?.missingProvidersInUse) &&
    payload.auth.missingProvidersInUse.length === 0 &&
    Array.isArray(payload?.auth?.modelRouteIssues) &&
    payload.auth.modelRouteIssues.length === 0;
}

function gatewayModelState(payload, account) {
  if (payload?.unavailable) return false;
  const provider = Array.isArray(payload?.providers)
    ? payload.providers.find((candidate) => candidate?.provider === "openai")
    : undefined;
  const usableStatuses = new Set(["ok", "expiring"]);
  return usableStatuses.has(provider?.status) &&
    Array.isArray(provider?.profiles) && provider.profiles.some(
      (profile) =>
        profile?.profileId === account.profileId &&
        profile?.type === "oauth" &&
        usableStatuses.has(profile?.status),
    );
}

export class PersonalOpenAIManager {
  constructor({
    workspaceRoot,
    stateRoot,
    gatewayRequest,
    execute = execFileAsync,
    spawnLogin = personalLoginProcess,
  }) {
    if (!workspaceRoot || !stateRoot || typeof gatewayRequest !== "function") {
      throw new Error("Personal OpenAI manager paths and Gateway client are required");
    }
    this.workspaceRoot = workspaceRoot;
    this.stateRoot = stateRoot;
    this.gatewayRequest = gatewayRequest;
    this.execute = execute;
    this.spawnLogin = spawnLogin;
    this.accounts = new Map();
    this.mutationTail = Promise.resolve();
  }

  queueMutation(operation) {
    const next = this.mutationTail.then(operation, operation);
    this.mutationTail = next.catch(() => undefined);
    return next;
  }

  async openclawJson(args) {
    const { stdout } = await this.execute("openclaw", args, {
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  }

  account(userId) {
    const id = personalAgentId(userId);
    let account = this.accounts.get(id);
    if (account) return account;
    account = {
      userId,
      agentId: id,
      roleId: personalRoleId(userId),
      profileId: personalProfileId(userId),
      authenticated: false,
      modelReady: false,
      provisioned: false,
      paused: true,
      refreshing: undefined,
    };
    account.controller = createProviderAuthController({
      providerAuthenticated: () => account.authenticated,
      modelReady: () => account.modelReady,
      refreshStatus: async () => {
        await this.refresh(account);
        if (account.authenticated) await this.assignRole(account.userId, account.roleId);
      },
      spawnLogin: () => this.spawnLogin(account.agentId, account.profileId),
    });
    this.accounts.set(id, account);
    return account;
  }

  async ensureProvisioned(userId) {
    const account = this.account(userId);
    if (account.provisioned) return account;
    await this.queueMutation(async () => {
      if (account.provisioned) return;
      const listed = await this.openclawJson(["agents", "list", "--json"]);
      const agents = Array.isArray(listed) ? listed : Array.isArray(listed?.agents) ? listed.agents : [];
      if (!agents.some((agent) => agent?.id === account.agentId)) {
        const agentDir = path.join(this.stateRoot, "agents", account.agentId, "agent");
        await mkdir(agentDir, { recursive: true });
        await this.openclawJson([
          "agents", "add", account.agentId,
          "--non-interactive",
          "--workspace", this.workspaceRoot,
          "--agent-dir", agentDir,
          "--json",
        ]);
      }
      await this.execute("openclaw", [
        "config", "set", `gateway.roles.definitions.${account.roleId}`,
        JSON.stringify({ sessions: { others: "none" }, agents: [account.agentId], scopes: USER_SCOPES }),
        "--strict-json",
      ], { encoding: "utf8", timeout: 120_000, maxBuffer: 1024 * 1024 });
      await this.waitForGatewayAgent(account.agentId);
      account.provisioned = true;
    });
    return account;
  }

  async waitForGatewayAgent(agentId) {
    let lastError;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const listed = await this.gatewayRequest("agents.list", {});
        const agents = Array.isArray(listed) ? listed : Array.isArray(listed?.agents) ? listed.agents : [];
        if (agents.some((agent) => agent?.id === agentId)) return;
        lastError = new Error(`OpenClaw Gateway has not loaded agent ${agentId}`);
      } catch (error) {
        lastError = error;
      }
      if (attempt < 19) await delay(250);
    }
    throw new Error("The personal Neura agent did not become available", { cause: lastError });
  }

  async refresh(account) {
    if (account.refreshing) return account.refreshing;
    const refreshing = this.refreshOnce(account);
    account.refreshing = refreshing;
    try {
      await refreshing;
    } finally {
      if (account.refreshing === refreshing) account.refreshing = undefined;
    }
  }

  async refreshOnce(account) {
    await this.ensureProvisioned(account.userId);
    const authentication = await this.openclawJson([
      "models", "auth", "list", "--agent", account.agentId, "--provider", "openai", "--json",
    ]).catch(() => undefined);
    const hasPersonalCredential = authenticationState(authentication, account);
    account.authenticated = false;
    account.modelReady = false;
    if (!hasPersonalCredential) return;

    let order = await this.openclawJson([
      "models", "auth", "order", "get", "--agent", account.agentId, "--provider", "openai", "--json",
    ]).catch(() => undefined);
    if (!personalOrderState(order, account)) {
      await this.queueMutation(async () => {
        order = await this.openclawJson([
          "models", "auth", "order", "get", "--agent", account.agentId, "--provider", "openai", "--json",
        ]).catch(() => undefined);
        if (personalOrderState(order, account)) return;
        await this.execute("openclaw", [
          "models", "auth", "order", "set",
          "--agent", account.agentId,
          "--provider", "openai",
          account.profileId,
        ], { encoding: "utf8", timeout: 120_000, maxBuffer: 1024 * 1024 });
      });
    }

    account.authenticated = true;
    const models = await this.openclawJson([
      "models", "status", "--agent", account.agentId, "--json",
    ]).catch(() => undefined);
    if (!modelState(models)) return;

    let runtime = await this.gatewayRequest("models.authStatus", {
      agentId: account.agentId,
    }).catch(() => undefined);
    if (!gatewayModelState(runtime, account)) {
      runtime = await this.queueMutation(async () => {
        const current = await this.gatewayRequest("models.authStatus", {
          agentId: account.agentId,
        }).catch(() => undefined);
        if (gatewayModelState(current, account)) return current;
        return this.gatewayRequest("models.authStatus", {
          agentId: account.agentId,
          refresh: true,
        });
      }).catch(() => undefined);
    }
    account.modelReady = gatewayModelState(runtime, account);
  }

  async findProfile(userId) {
    const listed = await this.gatewayRequest("users.list", {});
    return listed?.profiles?.find((profile) =>
      Array.isArray(profile?.emails) && profile.emails.some((email) => email === userId.toLowerCase()),
    );
  }

  async assignRole(userId, role) {
    let lastError;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const profile = await this.findProfile(userId);
        if (!profile?.id) throw new Error("The personal Neura profile is still starting");
        if (profile.role !== role) await this.gatewayRequest("users.setRole", { profileId: profile.id, role });
        return;
      } catch (error) {
        lastError = error;
        if (attempt < 7) await delay(250);
      }
    }
    throw new Error("Open Neura once before connecting your OpenAI account", { cause: lastError });
  }

  async snapshot(userId) {
    const account = await this.ensureProvisioned(userId);
    if (!["starting", "awaiting_user"].includes(account.controller.snapshot().state)) {
      await this.refresh(account);
    }
    const snapshot = account.controller.snapshot();
    const profile = await this.findProfile(userId).catch(() => undefined);
    account.paused = profile?.role !== account.roleId;
    return { ...snapshot, agentId: account.agentId, paused: account.paused };
  }

  async start(userId) {
    const account = await this.ensureProvisioned(userId);
    await this.refresh(account);
    if (account.authenticated) await this.assignRole(userId, account.roleId);
    account.paused = false;
    return { ...account.controller.start(), agentId: account.agentId, paused: false };
  }

  async cancel(userId) {
    const account = this.account(userId);
    return { ...account.controller.cancel(), agentId: account.agentId, paused: account.paused };
  }

  async pause(userId) {
    const account = await this.ensureProvisioned(userId);
    account.controller.cancel();
    await this.assignRole(userId, "unlinked");
    account.paused = true;
    return { ...account.controller.snapshot(), agentId: account.agentId, paused: true };
  }

  async resume(userId) {
    const account = await this.ensureProvisioned(userId);
    await this.refresh(account);
    if (!account.authenticated) throw new Error("Connect an OpenAI account before resuming Neura");
    await this.assignRole(userId, account.roleId);
    account.paused = false;
    return { ...account.controller.snapshot(), agentId: account.agentId, paused: false };
  }

  async prepareRun(userId) {
    const snapshot = await this.snapshot(userId);
    if (snapshot.paused || !snapshot.authenticated || !snapshot.modelReady) {
      const error = new Error("The message author must connect their OpenAI account in Personalization");
      error.code = "personal_openai_required";
      throw error;
    }
    return snapshot.agentId;
  }

  async restrictKnownProfiles() {
    const listed = await this.gatewayRequest("users.list", {});
    for (const profile of listed?.profiles ?? []) {
      const neuralLabsIdentity = profile?.emails?.find((email) => USER_ID_PATTERN.test(email));
      if (
        !neuralLabsIdentity ||
        neuralLabsIdentity === "neural-labs-automations-admin" ||
        profile.role === "unlinked" ||
        profile.role?.startsWith("personal-nl-")
      ) continue;
      await this.gatewayRequest("users.setRole", { profileId: profile.id, role: "unlinked" });
    }
  }

  async purgeLegacyNeuraSessions(markerPath = path.join(this.stateRoot, ".personal-neura-migrated")) {
    if (this.legacySessionsPurged) return;
    try {
      await access(markerPath);
      this.legacySessionsPurged = true;
      return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    try {
      const listed = await this.gatewayRequest("sessions.list", { agentId: "main", archived: "all", limit: 500 });
      const sessions = Array.isArray(listed?.sessions) ? listed.sessions : [];
      for (const session of sessions) {
        if (session?.category !== "neura-private" || typeof session?.key !== "string") continue;
        await this.gatewayRequest("sessions.delete", { key: session.key, agentId: "main", deleteTranscript: true });
      }
      await writeFile(markerPath, `${new Date().toISOString()}\n`, { flag: "wx" }).catch((error) => {
        if (error?.code !== "EEXIST") throw error;
      });
      this.legacySessionsPurged = true;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
}
