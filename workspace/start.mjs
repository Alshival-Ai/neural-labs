import { ProviderRuntime } from "/usr/local/lib/neural-labs/mcp/dist/providerRuntime.js";
import { loadProviderConfig } from "/usr/local/lib/neural-labs/mcp/dist/providerConfig.js";
import { installTerminalGuidance } from "/usr/local/lib/neural-labs/terminal-guidance.mjs";
import { execFile, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { copyFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { createWorkspaceHttpServer } from "/usr/local/lib/neural-labs/http-server.mjs";
import { browserConfigurationOperations } from "/usr/local/lib/neural-labs/browser-config.mjs";
import { createProviderAuthController } from "/usr/local/lib/neural-labs/provider-auth.mjs";
import { verifyCodexRuntime } from "/usr/local/lib/neural-labs/codex-runtime.mjs";
import { openclawRelease, verifyOpenClawRuntime, isOfficialSmsInstallation } from "/usr/local/lib/neural-labs/openclaw-runtime.mjs";
import { gatewayIsolationOperations } from "/usr/local/lib/neural-labs/gateway-isolation.mjs";
import { createGatewayAdminRequest, PersonalOpenAIManager } from "/usr/local/lib/neural-labs/personal-openai.mjs";
import { runTeamAgent } from "/usr/local/lib/neural-labs/team-agent.mjs";
import { createVoiceService } from "/usr/local/lib/neural-labs/voice.mjs";
import { ModelCatalog, modelCredentialSource } from "/usr/local/lib/neural-labs/model-catalog.mjs";
import { ModelPolicies } from "/usr/local/lib/neural-labs/model-policies.mjs";
import { TeamOpenAI } from "/usr/local/lib/neural-labs/team-openai.mjs";
import { agentEnvironment, retireWorkspaceApiKey } from "/usr/local/lib/neural-labs/provider-environment.mjs";

const openclawRuntime = await verifyOpenClawRuntime();
const gatewayPort = parsePort(process.env.OPENCLAW_GATEWAY_PORT, 18789);
const statusPort = parsePort(process.env.NEURAL_LABS_WORKSPACE_STATUS_PORT, 18790);
const mcpPort = parsePort(process.env.NEURAL_LABS_WORKSPACE_MCP_PORT, 8792);
const codeServerPort = parsePort(process.env.NEURAL_LABS_CODE_SERVER_PORT, 18881);
const codeServerOrigin = `http://127.0.0.1:${codeServerPort}`;
const publicOrigin = parsePublicOrigin(
  process.env.NEURAL_LABS_PUBLIC_ORIGIN ?? "https://neural-labs.example.com",
);
const trustedProxy = process.env.NEURAL_LABS_WORKSPACE_PROXY_IP?.trim() || "172.30.42.1";
const desktopRoot = "/usr/local/share/neural-labs/desktop";
const workspaceRoot = process.env.OPENCLAW_WORKSPACE_DIR ?? "/home/node/workspace";
const personalSkillsRoot = path.join(process.env.HOME || "/home/node", ".agents", "skills");
const builderDraftsRoot = path.join(process.env.HOME || "/home/node", ".local", "state", "neural-labs", "builder-drafts");
const maxUploadBytes = parsePositiveInteger(
  process.env.NEURAL_LABS_WORKSPACE_MAX_UPLOAD_BYTES,
  2 * 1024 * 1024 * 1024,
  "NEURAL_LABS_WORKSPACE_MAX_UPLOAD_BYTES",
);
const execFileAsync = promisify(execFile);
const providerStatusRefreshMs = 15_000;
const providerStatusCommandTimeoutMs = 120_000;
const workspaceControlToken = process.env.NEURAL_LABS_WORKSPACE_CONTROL_TOKEN?.trim();
if (!workspaceControlToken || workspaceControlToken.length < 32) {
  throw new Error("NEURAL_LABS_WORKSPACE_CONTROL_TOKEN must contain at least 32 characters");
}
const voiceService = createVoiceService({ safetySecret: workspaceControlToken });
const turnCredentialUrl = new URL(
  process.env.NEURAL_LABS_TURN_CREDENTIAL_URL ?? "http://control-plane:4174/internal/turn-credentials",
);
const teamChannelAccessUrl = new URL(
  process.env.NEURAL_LABS_TEAM_CHANNEL_ACCESS_URL ?? "http://control-plane:4174/internal/team-terminal/access",
);
const twilioConfigUrl = new URL(
  process.env.NEURAL_LABS_TWILIO_CONFIG_URL ?? "http://control-plane:4174/internal/plugins/twilio/config",
);
// OpenClaw resolves environment placeholders whenever it loads configuration.
// The always-on Gateway must therefore have a harmless value even though only
// an isolated Team Chat agent process receives a real, short-lived capability.
process.env.NEURAL_LABS_TEAM_CAPABILITY ||= "inactive-team-capability-not-authorized-00000000";
const internalGatewayPassword = randomBytes(48).toString("base64url");

function parsePort(value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error("Workspace ports must be integers between 1 and 65535");
  }
  return parsed;
}

function parsePositiveInteger(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parsePublicOrigin(value) {
  const url = new URL(value);
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new Error("NEURAL_LABS_PUBLIC_ORIGIN must contain only scheme, host, and optional port");
  }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("NEURAL_LABS_PUBLIC_ORIGIN must use HTTPS except for loopback development");
  }
  return url.origin;
}

async function seedShellProfiles() {
  const workspaceHome = process.env.HOME || "/home/node";
  const profiles = [
    ["zshrc", ".zshrc"],
    ["inputrc", ".inputrc"],
  ];
  for (const [sourceName, destinationName] of profiles) {
    try {
      await copyFile(
        path.join("/usr/local/share/neural-labs/shell", sourceName),
        path.join(workspaceHome, destinationName),
        constants.COPYFILE_EXCL,
      );
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
}

function runOpenClaw(args, options = {}) {
  const result = spawnSync("openclaw", args, {
    encoding: "utf8",
    stdio: options.quiet ? "pipe" : "inherit",
    timeout: 120_000,
  });
  if (result.error) throw result.error;
  return result;
}

function ensureOfficialSmsPlugin() {
  // OpenClaw rejects world-writable plugin artifacts. Docker may inherit a
  // permissive umask; use normal package permissions for native installation.
  const previousUmask = process.umask(0o022);
  try {
    const pathsResult = runOpenClaw(["config", "get", "plugins.load.paths", "--json"], { quiet: true });
    if (pathsResult.status === 0) {
      const paths = JSON.parse(pathsResult.stdout);
      if (Array.isArray(paths) && paths.includes("/usr/local/lib/neural-labs/node_modules/@openclaw/sms")) {
        const cleaned = paths.filter((entry) => entry !== "/usr/local/lib/neural-labs/node_modules/@openclaw/sms");
        const result = runOpenClaw(["config", "set", "plugins.load.paths", JSON.stringify(cleaned)], { quiet: true });
        if (result.status !== 0) throw new Error("Could not retire the legacy SMS plugin load path");
      }
    }
    const inspected = runOpenClaw(["plugins", "inspect", "sms", "--json"], { quiet: true });
    if (inspected.status === 0 && isOfficialSmsInstallation(JSON.parse(inspected.stdout))) return;
    const installed = runOpenClaw(["plugins", "install", `@openclaw/sms@${openclawRelease.version}`, "--pin", "--force", "--accept-capabilities"], { quiet: true });
    if (installed.status !== 0) throw new Error("Official SMS plugin installation failed");
  } finally { process.umask(previousUmask); }
}

function personalSmsAgentId(userId) {
  return `nl-${String(userId).toLowerCase().replace(/[^a-z0-9]/gu, "")}`.slice(0, 63);
}

async function fetchTwilioConfig() {
  try {
    const response = await fetch(twilioConfigUrl, {
      headers: { Authorization: `Bearer ${workspaceControlToken}`, Accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn("Twilio channel configuration is unavailable; SMS remains disabled", error instanceof Error ? error.message : error);
    return { enabled: false, revision: 0, users: [] };
  }
}

function existingNonSmsBindings() {
  const result = runOpenClaw(["config", "get", "bindings", "--json"], { quiet: true });
  if (result.status !== 0 || !result.stdout?.trim()) return [];
  try {
    const bindings = JSON.parse(result.stdout);
    return Array.isArray(bindings)
      ? bindings.filter((binding) => binding?.match?.channel !== "sms")
      : [];
  } catch { return []; }
}

function twilioOperations(config) {
  const users = Array.isArray(config?.users) ? config.users : [];
  const enabled = config?.enabled === true && typeof config?.authToken === "string";
  return [
    { path: "plugins.entries.sms.enabled", value: enabled },
    {
      path: "channels.sms",
      value: enabled ? {
        enabled: true,
        configWrites: false,
        accountSid: config.accountSid,
        authToken: { source: "env", provider: "default", id: "NEURAL_LABS_TWILIO_AUTH_TOKEN" },
        fromNumber: config.fromNumber,
        publicWebhookUrl: config.webhookUrl,
        webhookPath: "/webhooks/twilio/sms",
        dangerouslyDisableSignatureValidation: false,
        dmPolicy: "allowlist",
        allowFrom: users.map((user) => user.phoneNumber),
      } : { enabled: false, configWrites: false, dmPolicy: "disabled", allowFrom: [] },
    },
    {
      path: "bindings",
      value: [
        ...existingNonSmsBindings(),
        ...(enabled ? users.map((user) => ({
          agentId: personalSmsAgentId(user.userId),
          match: { channel: "sms", accountId: "default", peer: { kind: "direct", id: user.phoneNumber } },
        })) : []),
      ],
    },
  ];
}

function configureGateway(twilioConfig) {
  // Public traffic continues to use trusted-proxy auth. A random password,
  // regenerated on every container start, is passed only to the Gateway child
  // and this process's loopback role-management client. It is not persisted in
  // config or exposed to a browser, shell, or agent-run child process.
  runOpenClaw(["config", "unset", "gateway.auth.token"], { quiet: true });
  runOpenClaw(["config", "unset", "gateway.auth.password"], { quiet: true });
  runOpenClaw(["config", "unset", "gateway.controlUi.basePath"], { quiet: true });

  const operations = [
    ...gatewayIsolationOperations(),
    { path: "gateway.mode", value: "local" },
    { path: "gateway.bind", value: "lan" },
    { path: "gateway.port", value: gatewayPort },
    { path: "gateway.publicOrigin", value: publicOrigin },
    { path: "gateway.trustedProxies", value: [trustedProxy] },
    { path: "gateway.allowRealIpFallback", value: false },
    { path: "gateway.auth.mode", value: "trusted-proxy" },
    { path: "gateway.auth.trustedProxy.userHeader", value: "x-forwarded-user" },
    {
      path: "gateway.auth.trustedProxy.requiredHeaders",
      value: ["x-forwarded-proto", "x-forwarded-host"],
    },
    { path: "gateway.auth.trustedProxy.allowUsers", value: [] },
    { path: "gateway.auth.trustedProxy.allowLoopback", value: false },
    { path: "gateway.auth.trustedProxy.deviceAutoApprove.enabled", value: true },
    {
      path: "gateway.auth.trustedProxy.deviceAutoApprove.scopes",
      value: ["operator.read", "operator.write", "operator.approvals", "operator.questions"],
    },
    {
      // This service identity is asserted only by the separately admin-gated
      // Automations proxy route. The grant is connection-only and never lands
      // in a browser device's persistent pairing record.
      path: "gateway.auth.identityScopes",
      value: {
        "neural-labs-automations-admin": ["operator.read", "operator.admin"],
      },
    },
    { path: "gateway.controlUi.enabled", value: false },
    { path: "plugins.entries.codex.enabled", value: true },
    ...twilioOperations(twilioConfig),
    ...browserConfigurationOperations(),
    {
      path: "mcp.servers.neural-labs-team",
      value: {
        transport: "streamable-http",
        url: "http://control-plane:4174/internal/team-mcp",
        headers: { authorization: "Bearer ${NEURAL_LABS_TEAM_CAPABILITY}" },
      },
    },
    {
      path: "mcp.servers.neural-labs-tools",
      value: {
        transport: "streamable-http",
        url: "http://127.0.0.1:" + String(mcpPort) + "/mcp",
      },
    },
    { path: "gateway.controlUi.allowedOrigins", value: [publicOrigin] },
    { path: "gateway.controlUi.dangerouslyAllowHostHeaderOriginFallback", value: false },
    { path: "gateway.terminal.enabled", value: false },
    { path: "gateway.roles.default", value: "unlinked" },
    {
      path: "gateway.roles.definitions.unlinked",
      value: {
        sessions: { others: "none" },
        agents: [],
        scopes: ["operator.read", "operator.write", "operator.approvals", "operator.questions", "operator.admin"],
      },
    },
    {
      path: "gateway.roles.definitions.maintainer",
      value: {
        // Private-by-default: collaboration is granted per Team Chat instead
        // of exposing every creator's agent transcript to every developer.
        sessions: { others: "none" },
        agents: ["main"],
        // A role is a ceiling, not a grant. Keeping admin in the ceiling lets
        // the separately admin-gated service identity retain its explicit
        // identityScope while ordinary Neura connections remain capped below.
        scopes: ["operator.read", "operator.write", "operator.approvals", "operator.questions", "operator.admin"],
      },
    },
  ];
  const result = runOpenClaw(["config", "set", "--batch-json", JSON.stringify(operations)]);
  if (result.status !== 0) throw new Error(`OpenClaw configuration failed with exit code ${result.status}`);

  const identityResult = runOpenClaw(["agents", "set-identity", "--agent", "main", "--name", "Neura"]);
  if (identityResult.status !== 0) {
    throw new Error(`OpenClaw agent identity configuration failed with exit code ${identityResult.status}`);
  }
}

let providerStatus = {
  authenticated: false,
  modelReady: false,
  credentialSource: "unconfigured",
};
let providerStatusRefresh;

async function openclawJson(args) {
  const { stdout } = await execFileAsync("openclaw", args, {
    encoding: "utf8",
    env: agentEnvironment(process.env),
    timeout: providerStatusCommandTimeoutMs,
    maxBuffer: 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function refreshProviderStatus() {
  if (providerStatusRefresh) return providerStatusRefresh;

  providerStatusRefresh = (async () => {
    const [authentication, models] = await Promise.allSettled([
      openclawJson(["models", "auth", "list", "--agent", "main", "--provider", "openai", "--json"]),
      openclawJson(["models", "status", "--agent", "main", "--json"]),
    ]);
    const authenticationStatus =
      authentication.status === "fulfilled" ? authentication.value : null;
    const modelStatus = models.status === "fulfilled" ? models.value : null;
    providerStatus = {
      credentialSource: modelCredentialSource(authenticationStatus, modelStatus),
      authenticated:
        Array.isArray(authenticationStatus?.profiles) &&
        authenticationStatus.profiles.some(
          (profile) => profile?.provider === "openai" && profile?.type === "oauth",
        ),
      modelReady:
        Array.isArray(modelStatus?.auth?.missingProvidersInUse) &&
        modelStatus.auth.missingProvidersInUse.length === 0 &&
        Array.isArray(modelStatus?.auth?.modelRouteIssues) &&
        modelStatus.auth.modelRouteIssues.length === 0,
    };
  })().finally(() => {
    providerStatusRefresh = undefined;
  });

  return providerStatusRefresh;
}

async function refreshProviderStatusAfterLogin() {
  if (providerStatusRefresh) await providerStatusRefresh;
  await refreshProviderStatus();
}

function providerAuthenticated() {
  return providerStatus.authenticated;
}

function openclawModelReady() {
  return providerStatus.modelReady;
}

async function gatewayReady() {
  try {
    const response = await fetch(`http://127.0.0.1:${gatewayPort}/healthz`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function codeServerReady() {
  try {
    const response = await fetch(`${codeServerOrigin}/`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

const unavailableMcpStatus = () => ({
  ready: false,
  mode: "workspace-local",
  endpoint: "http://127.0.0.1:" + String(mcpPort) + "/mcp",
  transport: "streamable-http",
  agentServerName: "neural-labs-tools",
  agentScope: "shared-workspace",
  publicAccess: false,
  providers: {
    googlePlaces: false,
    googleGeocoding: false,
    klipy: false,
    pexels: false,
  },
  tools: [],
});

async function mcpStatus() {
  try {
    const response = await fetch(
      "http://127.0.0.1:" + String(mcpPort) + "/healthz",
      { signal: AbortSignal.timeout(1500) },
    );
    if (!response.ok) return unavailableMcpStatus();
    const status = await response.json();
    return {
      ...unavailableMcpStatus(),
      ready: status?.status === "ok",
      providerConfiguration: status?.providerConfiguration,
      providers: status?.providers ?? unavailableMcpStatus().providers,
      tools: Array.isArray(status?.tools) ? status.tools : [],
    };
  } catch {
    return unavailableMcpStatus();
  }
}

await seedShellProfiles();
await installTerminalGuidance(workspaceRoot);
ensureOfficialSmsPlugin();
let twilioRuntimeConfig = await fetchTwilioConfig();
configureGateway(twilioRuntimeConfig);
// Fail before starting the text Gateway if a legacy audio-key fallback cannot
// be retired. The voice service retains its server-only API environment.
retireWorkspaceApiKey();
await refreshProviderStatus();
const providerStatusTimer = setInterval(() => {
  void refreshProviderStatus();
}, providerStatusRefreshMs);
providerStatusTimer.unref();

const providerAuth = createProviderAuthController({
  providerAuthenticated,
  modelReady: openclawModelReady,
  refreshStatus: refreshProviderStatusAfterLogin,
});

const gateway = spawn(
  "openclaw",
  ["gateway", "run", "--bind", "lan", "--port", String(gatewayPort)],
  {
    stdio: "inherit",
    env: {
      ...agentEnvironment(process.env),
      ...(twilioRuntimeConfig?.enabled && twilioRuntimeConfig?.authToken
        ? { NEURAL_LABS_TWILIO_AUTH_TOKEN: twilioRuntimeConfig.authToken }
        : {}),
      OPENCLAW_GATEWAY_PASSWORD: internalGatewayPassword,
    },
  },
);
const gatewayAdminRequest = createGatewayAdminRequest({
  url: `ws://127.0.0.1:${gatewayPort}`,
  password: internalGatewayPassword,
});
const personalOpenAI = new PersonalOpenAIManager({
  workspaceRoot,
  stateRoot: process.env.OPENCLAW_STATE_DIR ?? "/home/node/.openclaw",
  gatewayRequest: gatewayAdminRequest,
});
const teamOpenAI = new TeamOpenAI(personalOpenAI);
await verifyCodexRuntime(process.env.NEURAL_LABS_CODEX_VERSION);
const modelCatalog = new ModelCatalog({ gatewayRequest: gatewayAdminRequest, personalOpenAI, teamOpenAI, runtime: { name: "OpenClaw", version: openclawRuntime.version } });
const modelPolicies = new ModelPolicies({ personalOpenAI, catalog: modelCatalog, teamOpenAI });
const workspaceMcp = spawn(
  process.execPath,
  ["/usr/local/lib/neural-labs/mcp/dist/local.js"],
  { stdio: "inherit", env: agentEnvironment(process.env) },
);
const codeServer = spawn(
  "code-server",
  [
    "--bind-addr", `127.0.0.1:${codeServerPort}`,
    "--auth", "none",
    "--disable-telemetry",
    "--disable-update-check",
    "--user-data-dir", "/home/node/.local/share/code-server",
    "--extensions-dir", "/home/node/.local/share/code-server/extensions",
    "--app-name", "VS Code · Neural Labs",
    workspaceRoot,
  ],
  { stdio: "inherit", env: agentEnvironment(process.env) },
);

const apiProviderRuntime = new ProviderRuntime(loadProviderConfig(process.env), process.env.NEURAL_LABS_PROVIDER_CONFIG_URL ?? "http://control-plane:4174/internal/plugins/providers/config", workspaceControlToken);
await apiProviderRuntime.start();
const workspaceServer = createWorkspaceHttpServer({
  desktopRoot,
  workspaceRoot,
  publicOrigin,
  gatewayReady,
  gatewayMediaOrigin: `http://127.0.0.1:${gatewayPort}`,
  codeServerOrigin,
  codeServerReady,
  mcpStatus,
  apiProviderRuntime,
  providerAuthenticated,
  credentialSource: () => providerStatus.credentialSource,
  openclawModelReady,
  providerAuth,
  personalOpenAI,
  gatewayAdminRequest,
  modelCatalog,
  modelPolicies,
  teamOpenAI,
  voiceService,
  workspaceControlToken,
  openclawVersion: openclawRuntime.version,
  codexVersion: process.env.NEURAL_LABS_CODEX_VERSION ?? "unknown",
  maxUploadBytes,
  personalSkillsRoot,
  builderDraftsRoot,
  turnCredentialProvider: async (actor) => {
    const response = await fetch(turnCredentialUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${workspaceControlToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ actorId: actor.id }),
    });
    if (!response.ok) throw new Error(`TURN credential service returned HTTP ${response.status}`);
    const result = await response.json();
    return Array.isArray(result?.iceServers) ? result.iceServers : [];
  },
  teamChannelAuthorizer: async (actor, channelId) => {
    const response = await fetch(teamChannelAccessUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${workspaceControlToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ actorId: actor.id, channelId }),
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) throw new Error(`Team Chat access service returned HTTP ${response.status}`);
    return response.json();
  },
  terminalActorResolver: async (actorId) => {
    const response = await fetch("http://control-plane:4174/internal/terminal-actor", {
      method: "POST", headers: { Authorization: `Bearer ${workspaceControlToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ actorId }), signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    return (await response.json()).actor;
  },
  runTeamAgent: async (input) => {
    const agentId = input.modelSettings ? await teamOpenAI.prepareRun() : await personalOpenAI.prepareRun(input.userId);
    return runTeamAgent({ ...input, agentId, workspaceRoot });
  },
});

workspaceServer.listen(statusPort, "0.0.0.0", () => {
  console.log(`Neural Labs desktop and status listening on 0.0.0.0:${statusPort}`);
});

async function reconcilePersonalAccess() {
  try {
    for (const user of Array.isArray(twilioRuntimeConfig?.users) ? twilioRuntimeConfig.users : []) {
      await personalOpenAI.ensureProvisioned(user.userId);
    }
    await personalOpenAI.restrictKnownProfiles();
    await personalOpenAI.assignRole("neural-labs-automations-admin", "maintainer").catch(() => undefined);
    await personalOpenAI.purgeLegacyNeuraSessions();
  } catch (error) {
    console.warn("Personal Neura access reconciliation is waiting for the Gateway", error instanceof Error ? error.message : error);
  }
}
setTimeout(() => void reconcilePersonalAccess(), 2_000).unref();
const personalAccessTimer = setInterval(() => void reconcilePersonalAccess(), 30_000);
personalAccessTimer.unref();

const twilioConfigTimer = setInterval(() => {
  void (async () => {
    const next = await fetchTwilioConfig();
    const currentFingerprint = JSON.stringify({ revision: twilioRuntimeConfig?.revision, users: twilioRuntimeConfig?.users?.map((user) => [user.userId, user.phoneNumber]) });
    const nextFingerprint = JSON.stringify({ revision: next?.revision, users: next?.users?.map((user) => [user.userId, user.phoneNumber]) });
    if (currentFingerprint === nextFingerprint) return;
    const result = runOpenClaw(["config", "set", "--batch-json", JSON.stringify(twilioOperations(next))]);
    if (result.status === 0) {
      twilioRuntimeConfig = next;
      // Gateway environment secrets are immutable. Let the container's
      // restart policy perform a clean, bounded restart after any connection
      // or verified-member allowlist change.
      gateway.kill("SIGTERM");
    }
    else console.warn("OpenClaw rejected an updated Twilio channel configuration");
  })();
}, 30_000);
twilioConfigTimer.unref();

let stopping = false;
function stop(signal) {
  if (stopping) return;
  stopping = true;
  clearInterval(providerStatusTimer);
  clearInterval(personalAccessTimer);
  clearInterval(twilioConfigTimer);
  providerAuth.cancel();
  teamOpenAI.cancel();
  workspaceServer.close();
  gateway.kill(signal);
  apiProviderRuntime.close();
  workspaceMcp.kill(signal);
  codeServer.kill(signal);
  setTimeout(() => gateway.kill("SIGKILL"), 10_000).unref();
  setTimeout(() => workspaceMcp.kill("SIGKILL"), 10_000).unref();
  setTimeout(() => codeServer.kill("SIGKILL"), 10_000).unref();
}

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));

gateway.once("error", (error) => {
  console.error("OpenClaw Gateway failed to start", error);
  process.exitCode = 1;
  codeServer.kill("SIGTERM");
  workspaceMcp.kill("SIGTERM");
  workspaceServer.close();
});

workspaceMcp.once("error", (error) => {
  console.error("Workspace MCP failed to start", error);
  process.exitCode = 1;
  gateway.kill("SIGTERM");
  codeServer.kill("SIGTERM");
  workspaceServer.close();
});

codeServer.once("error", (error) => {
  console.error("VS Code failed to start", error);
  process.exitCode = 1;
  gateway.kill("SIGTERM");
  workspaceMcp.kill("SIGTERM");
  workspaceServer.close();
});

workspaceMcp.once("exit", (code, signal) => {
  if (stopping) return;
  console.error(
    "Workspace MCP exited unexpectedly" +
      (signal ? " after " + signal : " with code " + String(code)),
  );
  gateway.kill("SIGTERM");
  codeServer.kill("SIGTERM");
  workspaceServer.close(() => process.exit(code ?? 1));
});

codeServer.once("exit", (code, signal) => {
  if (stopping) return;
  console.error(
    "VS Code exited unexpectedly" +
      (signal ? " after " + signal : " with code " + String(code)),
  );
  gateway.kill("SIGTERM");
  workspaceMcp.kill("SIGTERM");
  workspaceServer.close(() => process.exit(code ?? 1));
});

gateway.once("exit", (code, signal) => {
  if (!stopping) {
    workspaceMcp.kill("SIGTERM");
    codeServer.kill("SIGTERM");
  }
  workspaceServer.close(() => {
    if (!stopping && signal) console.error(`OpenClaw Gateway exited after ${signal}`);
    process.exit(code ?? (stopping ? 0 : 1));
  });
});
