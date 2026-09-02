import { execFile, spawn, spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { copyFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { createWorkspaceHttpServer } from "/usr/local/lib/neural-labs/http-server.mjs";
import { createProviderAuthController } from "/usr/local/lib/neural-labs/provider-auth.mjs";
import { runTeamAgent } from "/usr/local/lib/neural-labs/team-agent.mjs";

const gatewayPort = parsePort(process.env.OPENCLAW_GATEWAY_PORT, 18789);
const statusPort = parsePort(process.env.NEURAL_LABS_WORKSPACE_STATUS_PORT, 18790);
const mcpPort = parsePort(process.env.NEURAL_LABS_WORKSPACE_MCP_PORT, 8792);
const publicOrigin = parsePublicOrigin(
  process.env.NEURAL_LABS_PUBLIC_ORIGIN ?? "https://neural-labs.example.com",
);
const trustedProxy = process.env.NEURAL_LABS_WORKSPACE_PROXY_IP?.trim() || "172.30.42.1";
const desktopRoot = "/usr/local/share/neural-labs/desktop";
const workspaceRoot = process.env.OPENCLAW_WORKSPACE_DIR ?? "/home/node/workspace";
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
// OpenClaw resolves environment placeholders whenever it loads configuration.
// The always-on Gateway must therefore have a harmless value even though only
// an isolated Team Chat agent process receives a real, short-lived capability.
process.env.NEURAL_LABS_TEAM_CAPABILITY ||= "inactive-team-capability-not-authorized-00000000";

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
  });
  if (result.error) throw result.error;
  return result;
}

function configureGateway() {
  // Trusted-proxy mode rejects mixed shared-token configuration. Unset old
  // values when a persistent volume is reused from another deployment mode.
  runOpenClaw(["config", "unset", "gateway.auth.token"], { quiet: true });
  runOpenClaw(["config", "unset", "gateway.auth.password"], { quiet: true });
  runOpenClaw(["config", "unset", "gateway.controlUi.basePath"], { quiet: true });

  const operations = [
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
    { path: "gateway.roles.default", value: "maintainer" },
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
};
let providerStatusRefresh;

async function openclawJson(args) {
  const { stdout } = await execFileAsync("openclaw", args, {
    encoding: "utf8",
    timeout: providerStatusCommandTimeoutMs,
    maxBuffer: 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function refreshProviderStatus() {
  if (providerStatusRefresh) return providerStatusRefresh;

  providerStatusRefresh = (async () => {
    const [authentication, models] = await Promise.allSettled([
      openclawJson(["models", "auth", "list", "--provider", "openai", "--json"]),
      openclawJson(["models", "status", "--json"]),
    ]);
    const authenticationStatus =
      authentication.status === "fulfilled" ? authentication.value : null;
    const modelStatus = models.status === "fulfilled" ? models.value : null;
    providerStatus = {
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
      providers: status?.providers ?? unavailableMcpStatus().providers,
      tools: Array.isArray(status?.tools) ? status.tools : [],
    };
  } catch {
    return unavailableMcpStatus();
  }
}

await seedShellProfiles();
configureGateway();
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
  { stdio: "inherit" },
);
const workspaceMcp = spawn(
  process.execPath,
  ["/usr/local/lib/neural-labs/mcp/dist/local.js"],
  { stdio: "inherit" },
);

const workspaceServer = createWorkspaceHttpServer({
  desktopRoot,
  workspaceRoot,
  publicOrigin,
  gatewayReady,
  mcpStatus,
  providerAuthenticated,
  openclawModelReady,
  providerAuth,
  workspaceControlToken,
  openclawVersion: process.env.NEURAL_LABS_OPENCLAW_VERSION ?? "unknown",
  codexVersion: process.env.NEURAL_LABS_CODEX_VERSION ?? "unknown",
  maxUploadBytes,
  runTeamAgent: (input) => runTeamAgent({ ...input, workspaceRoot }),
});

workspaceServer.listen(statusPort, "0.0.0.0", () => {
  console.log(`Neural Labs desktop and status listening on 0.0.0.0:${statusPort}`);
});

let stopping = false;
function stop(signal) {
  if (stopping) return;
  stopping = true;
  clearInterval(providerStatusTimer);
  providerAuth.cancel();
  workspaceServer.close();
  gateway.kill(signal);
  workspaceMcp.kill(signal);
  setTimeout(() => gateway.kill("SIGKILL"), 10_000).unref();
  setTimeout(() => workspaceMcp.kill("SIGKILL"), 10_000).unref();
}

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));

gateway.once("error", (error) => {
  console.error("OpenClaw Gateway failed to start", error);
  process.exitCode = 1;
  workspaceServer.close();
});

workspaceMcp.once("error", (error) => {
  console.error("Workspace MCP failed to start", error);
  process.exitCode = 1;
  gateway.kill("SIGTERM");
  workspaceServer.close();
});

workspaceMcp.once("exit", (code, signal) => {
  if (stopping) return;
  console.error(
    "Workspace MCP exited unexpectedly" +
      (signal ? " after " + signal : " with code " + String(code)),
  );
  gateway.kill("SIGTERM");
  workspaceServer.close(() => process.exit(code ?? 1));
});

gateway.once("exit", (code, signal) => {
  workspaceServer.close(() => {
    if (!stopping && signal) console.error(`OpenClaw Gateway exited after ${signal}`);
    process.exit(code ?? (stopping ? 0 : 1));
  });
});
