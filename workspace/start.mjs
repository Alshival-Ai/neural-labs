import { Deployments, hostingConfig } from './native/deployments.mjs';
import { createServer } from "node:http";
import { mkdir, access } from "node:fs/promises";
import path from "node:path";
import * as pty from "node-pty";
import { createWorkspaceHttpServer } from "./http-server.mjs";
import { WorkspaceTerminalManager } from "./terminal-manager.mjs";
import { createVoiceService } from "./voice.mjs";
import { NativeRuntime, controlPlaneAuthority } from "./native/runtime.mjs";
import { NativeInteractive, interactiveAuthority } from "./native/interactive.mjs";
import { NativeEditors } from "./native/editors.mjs";
import { NativeMaintenance, initializeNativeInstallation, nativePreservationReady } from "./native/maintenance.mjs";
import { NativeSources } from "./native/sources.mjs";
import { NativeTriggerLoop } from "./native/trigger-loop.mjs";
import { NativeBrowser } from "./native/browser.mjs";
import { NativeArtifacts } from "./native/artifacts.mjs";
import { browserFile, browserPreviews } from "./native/browser-files.mjs";
import { NativeTools } from "./native/tools.mjs";
import { NativeSkills } from "./native/skills.mjs";
import { createSkillsManager } from "./skills-manager.mjs";
import { createNativeLauncher, prepareNativeHome, NATIVE_HOME } from "./native/launcher.mjs";
import { CODEX_APP_SERVER } from "./native/codex.mjs";
import release from "./native/release.json" with { type: "json" };
import { ProviderRuntime } from "./mcp/dist/providerRuntime.js";
import { loadProviderConfig } from "./mcp/dist/providerConfig.js";
import { createProviderApplication } from "./mcp/dist/providerServer.js";

const root = path.resolve(process.env.NEURAL_LABS_NATIVE_STATE_ROOT || "/home/node/.local/state/neural-labs/native");
const workspaceRoot = path.resolve(process.env.NEURAL_LABS_WORKSPACE_ROOT || "/home/node/workspace");
const controlOrigin = process.env.NEURAL_LABS_CONTROL_PLANE_ORIGIN || "http://control-plane:4174";
const token = process.env.NEURAL_LABS_WORKSPACE_CONTROL_TOKEN?.trim();
if (!token || token.length < 32) throw new Error("A private workspace control token is required");
const publicUrl = new URL(process.env.NEURAL_LABS_PUBLIC_ORIGIN || "https://neural-labs.example.com");
if (publicUrl.pathname !== "/" || publicUrl.search || publicUrl.hash || publicUrl.username || publicUrl.password
    || publicUrl.protocol !== "https:" && !(publicUrl.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(publicUrl.hostname)))
  throw new Error("An HTTPS workspace origin is required");
const publicOrigin = publicUrl.origin;
function port(value, fallback) { const parsed = Number(value ?? fallback); if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error("Invalid runtime port"); return parsed; }
const statusPort = port(process.env.NEURAL_LABS_WORKSPACE_STATUS_PORT, 18790);
const toolsPort = port(process.env.NEURAL_LABS_WORKSPACE_MCP_PORT, 8792);
const probation = process.env.NEURAL_LABS_UPDATE_PROBATION === "true";
await mkdir(workspaceRoot, { recursive: true, mode: 0o755 });
await mkdir(root, { recursive: true, mode: 0o700 });
// entrypoint.sh holds the exclusive filesystem lock for this entire process.
const probeHome = await prepareNativeHome(path.join(root, "probe-home"));
const probe = await createNativeLauncher({ workspaceRoot, homeRoot: probeHome, readOnly: true });
await probe.probe();
for (const [command, expected] of [[CODEX_APP_SERVER, `codex-cli ${release.codex}`], ["/usr/local/bin/claude", `${release.claude} (Claude Code)`]]) {
  const result = await probe.exec(command, ["--version"], { env: { HOME: NATIVE_HOME, PATH: "/usr/local/bin:/usr/bin:/bin", DISABLE_AUTOUPDATER: "1" }, timeout: 20000, maxBuffer: 65536 });
  if (result.stdout.trim() !== expected) throw new Error("The installed provider executable does not match the native release");
}
async function control(endpoint, body) {
  const response = await fetch(new URL(endpoint, controlOrigin), { method: "POST", redirect: "error",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("Workspace authorization is unavailable"); return response.json();
}
const resolveActor = async actorId => (await control("/internal/terminal-actor", { actorId })).actor;
const terminals = new WorkspaceTerminalManager({ workspaceRoot,
  turnCredentialProvider: async actor => (await control("/internal/turn-credentials", { actorId: actor.id })).iceServers || [],
  teamChannelAuthorizer: (actor, channelId) => control("/internal/team-terminal/access", { actorId: actor.id, channelId }),
});
const providers = new ProviderRuntime(loadProviderConfig(process.env), new URL("/internal/plugins/providers/config", controlOrigin).href, token);
await providers.start();
const tools = new NativeTools({ origin: `http://127.0.0.1:${toolsPort}`, teamOrigin: controlOrigin,
  createApplication: createProviderApplication, configuration: () => providers.snapshot(),
  communications: (actor, input) => control("/internal/connectors/tool", { actor, ...input }),
  projectRead: (actorId, input) => control("/internal/projects/read", { ...input, actorId }) });
const skills = new NativeSkills({ root: "/run/neural-labs/skills", manager: createSkillsManager({
  personalRoot: path.join(path.dirname(workspaceRoot), ".agents", "skills"), teamRoot: path.join(workspaceRoot, "skills"),
  libraryRoots: ["/usr/local/share/neural-labs/skills", path.join(root, "installed-skills")],
}) });
const runtime = new NativeRuntime({ stateRoot: root, workspaceRoot, authorize: controlPlaneAuthority({ origin: controlOrigin, token }),
  tools, skills, terminals, spawnPty: pty.spawn, resolveActor });
runtime.state.recoverInterrupted();
const artifacts = new NativeArtifacts({ root: path.join(root, 'artifacts'), state: runtime.state,
  authorize: async (actor, channel) => { if (!await resolveActor(actor)) throw new Error('Workspace access revoked'); if (channel && !(await control('/internal/team-terminal/access', { actorId: actor, channelId: channel })).allowed) throw new Error('Channel access revoked'); } });
const browser = new NativeBrowser({ root: '/run/neural-labs/browser', artifacts,
  maxSessions: Number(process.env.NEURAL_LABS_BROWSER_MAX_SESSIONS || 2), maxTabs: Number(process.env.NEURAL_LABS_BROWSER_MAX_TABS || 4),
  readWorkspaceFile: relative => browserFile(workspaceRoot, relative), preview: browserPreviews(workspaceRoot),
  deniedHosts: (process.env.NEURAL_LABS_BROWSER_DENIED_HOSTS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean),
});
await artifacts.reconcile();
tools.browser = browser; runtime.artifacts = artifacts;
const interactive = new NativeInteractive({ runtime, authorize: interactiveAuthority({ origin: controlOrigin, token }), resolveActor, spawnPty: pty.spawn });
terminals.prepareProcess = input => interactive.prepareTerminal(input);
const editors = new NativeEditors({ interactive });
let legacyState = false;
for (const filename of [path.join(path.dirname(workspaceRoot), ".openclaw"),
  path.join(path.dirname(workspaceRoot), ".config", "openclaw"), "/migration/openclaw/state", "/migration/openclaw/auth"]) {
  try { await access(filename); legacyState = true; }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
initializeNativeInstallation(runtime.state, { legacyState });
const preservationReady = () => nativePreservationReady(runtime.state, { legacyState });
const maintenance = new NativeMaintenance({ runtime, probation, readiness: async () => preservationReady() });
if (probation || !preservationReady()) await maintenance.pause();
else if (!maintenance.gated) runtime.turns.gated = false;
const deployments = new Deployments({ root: path.join(root, 'deployments'), workspaceRoot, state: runtime.state,
  configuration: hostingConfig(process.env), hosting: () => control('/internal/deployment-hosting', {}), gated: () => maintenance.gated });
runtime.deployments = deployments; tools.deployments = deployments;
await deployments.host();
const hostingRefresh = setInterval(() => { void deployments.host(); }, 10000);
await deployments.restore();
await deployments.localListeners();
const triggers = new NativeTriggerLoop({ state: runtime.state, scheduler: runtime.scheduler, root: "/run/neural-labs/scheduler" });
runtime.sources = new NativeSources({ state: runtime.state, scheduler: runtime.scheduler, workspaceRoot: runtime.workspaceRoot, root: `${runtime.root}/source-homes` });
triggers.sources = runtime.sources;
runtime.triggers = triggers;
await triggers.start();
const mcpServer = createServer((request, response) => { void tools.handle(request, response).catch(() => response.destroy()); });
await new Promise((resolve, reject) => { mcpServer.once("error", reject); mcpServer.listen(toolsPort, "127.0.0.1", resolve); });
const mcpStatus = async () => ({ ready: mcpServer.listening, mode: "workspace-local", endpoint: `http://127.0.0.1:${toolsPort}/mcp`,
  transport: "streamable-http", agentServerName: "neural-labs", agentScope: "authenticated-execution", publicAccess: false,
  providerConfiguration: providers.status(), providers: { googlePlaces: providers.status()["google-maps"].available,
    googleGeocoding: providers.status()["google-maps"].available, klipy: providers.status().klipy.available, pexels: providers.status().pexels.available }, tools: ["browser", "deployments"] });
const server = createWorkspaceHttpServer({ desktopRoot: "/usr/local/share/neural-labs/desktop", workspaceRoot, publicOrigin,
  nativeArtifacts: artifacts, deployments, deploymentAuthorize: input => control('/internal/deployment-access', input), nativeRuntime: runtime, requireSignedRequests: true, nativeEditors: editors, updateMaintenance: maintenance,
  skillLibraryRoots: ["/usr/local/share/neural-labs/skills", path.join(root, "installed-skills")],
  runtimeReady: async () => !stopping && triggers.status().ready, mcpStatus, apiProviderRuntime: providers, terminalManager: terminals,
  terminalActorResolver: resolveActor, workspaceControlToken: token, codexVersion: release.codex, claudeVersion: release.claude,
  runTeamAgent: input => runtime.runTeam({ run: input.runId, channel: input.channelId,
    actor: input.userId, capability: input.capability, prompt: input.prompt, trigger: input.trigger, signal: input.signal }),
  voiceService: createVoiceService({ safetySecret: token }),
  maxUploadBytes: Number(process.env.NEURAL_LABS_WORKSPACE_MAX_UPLOAD_BYTES || 2 * 1024 ** 3),
});
let stopping = false;
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(statusPort, "0.0.0.0", resolve); });
console.log(`Neural Labs native runtime listening on ${statusPort}`);
async function stop() {
  if (stopping) return; stopping = true;
  runtime.turns.gated = true; runtime.scheduler.closed = true;
  clearInterval(hostingRefresh); server.close(); providers.close();
  await deployments.close(); await triggers.close(); await editors.close(); await runtime.close(); await tools.close(); artifacts.close();
  mcpServer.close();
}
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
