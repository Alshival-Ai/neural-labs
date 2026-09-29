// Host-only readiness probe. Uses an empty, disposable home: no credentials,
// inference, delivery, or writes to persistent workspace data.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { createNativeLauncher, prepareNativeHome, NATIVE_HOME, NATIVE_WORKSPACE } from "./launcher.mjs";
import { CODEX_APP_SERVER, StdioRpc, providerEnvironment } from "./codex.mjs";
import { readClaudeModels } from "./models.mjs";
import release from "./release.json" with { type: "json" };

let root, rpc;
try {
  for (const [key, expected] of [["RUNTIME", release.version], ["CODEX", release.codex], ["CLAUDE", release.claude]])
    assert.equal(process.env[`NEURAL_LABS_${key}_VERSION`], expected);
  const port = Number(process.env.NEURAL_LABS_WORKSPACE_STATUS_PORT || 18790);
  assert.ok(Number.isInteger(port) && port > 0 && port < 65536);
  const request = async endpoint => {
    const response = await fetch(`http://127.0.0.1:${port}${endpoint}`, { redirect: "error", signal: AbortSignal.timeout(5000),
      headers: { Authorization: `Bearer ${process.env.NEURAL_LABS_WORKSPACE_CONTROL_TOKEN}` } });
    assert.equal(response.status, 200); return response.json();
  };
  const health = await request("/healthz");
  assert.equal(health.runtime, "native"); assert.equal(health.protocol, release.protocol);
  assert.equal(health.runtimeReady, true); assert.equal(health.mcpReady, true);
  assert.equal(health.codexVersion, release.codex); assert.equal(health.claudeVersion, release.claude);
  const activity = await request("/internal/updates/activity");
  assert.equal(activity.protocol, 1); assert.equal(activity.eligible, true); assert.equal(activity.idle, true);
  assert.equal(activity.probation, process.env.NEURAL_LABS_UPDATE_PROBATION === "true");
  if (activity.probation) assert.equal(activity.gated, true);

  root = await mkdtemp("/tmp/neural-labs-update-probe-");
  const homeRoot = await prepareNativeHome(path.join(root, "home")), workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const launch = await createNativeLauncher({ homeRoot, workspaceRoot, readOnly: true });
  await launch.probe();
  for (const [command, expected] of [[CODEX_APP_SERVER, `codex-cli ${release.codex}`], ["/usr/local/bin/claude", `${release.claude} (Claude Code)`]]) {
    const result = await launch.exec(command, ["--version"], { env: { HOME: NATIVE_HOME, PATH: "/usr/local/bin:/usr/bin:/bin", DISABLE_AUTOUPDATER: "1" }, timeout: 10000 });
    assert.equal(result.stdout.trim(), expected);
  }
  const env = providerEnvironment({ provider: "codex", home: NATIVE_HOME, credentialHome: `${NATIVE_HOME}/.codex`, method: "subscription" });
  await launch.exec("/bin/sh", ["-c", "! command -v openclaw"], { env, timeout: 10000 });
  rpc = new StdioRpc(CODEX_APP_SERVER, ["app-server", "-c", 'forced_login_method="chatgpt"'],
    { cwd: NATIVE_WORKSPACE, env, spawnProcess: launch.spawn, requestTimeoutMs: 10000 });
  await rpc.request("initialize", { clientInfo: { name: "neural_labs_update_probe", version: "1" } });
  rpc.send({ method: "initialized" });
  assert.ok(Array.isArray((await rpc.request("thread/list", { limit: 1 })).data));
  await rpc.close(); rpc = null;
  const claudeEnv = providerEnvironment({ provider: "claude", home: NATIVE_HOME, credentialHome: `${NATIVE_HOME}/.claude`, method: "subscription" });
  assert.ok((await readClaudeModels({ launch, cwd: NATIVE_WORKSPACE }, claudeEnv)).length > 0);
  console.log("Native image pins, health, maintenance, isolation, and provider protocols verified; no inference");
} catch {
  console.error("Native workspace update verification failed"); process.exitCode = 1;
} finally {
  await rpc?.close();
  if (root) await rm(root, { recursive: true, force: true });
}
