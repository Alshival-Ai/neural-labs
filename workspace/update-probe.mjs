import { verifyAppServer } from "./update-app-server-probe.mjs";
// Read-only candidate checks. Do not print configuration, auth state, or prompts.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { verifyOpenClawRuntime, openclawRelease } from "./openclaw-runtime.mjs";
import { verifyCodexRuntime } from "./codex-runtime.mjs";
const execute = promisify(execFile);
try {
  await verifyOpenClawRuntime();
  await verifyCodexRuntime(openclawRelease.codexVersion);
  const config = JSON.parse(await readFile(process.env.OPENCLAW_CONFIG_PATH, "utf8"));
  assert.equal(config.update.auto.enabled, false);
  assert.equal(config.gateway.auth.mode, "trusted-proxy");
  assert.equal(config.gateway.auth.trustedProxy.allowLoopback, false);
  assert.deepEqual(config.gateway.trustedProxies, [process.env.NEURAL_LABS_WORKSPACE_PROXY_IP]);
  assert.equal(config.gateway.roles.default, "unlinked");
  assert.equal(config.gateway.terminal.enabled, false);
  assert.equal(config.tools.agentToAgent.enabled, false);
  assert.equal(config.tools.swarm.enabled, false);
  const command = "/usr/local/lib/neural-labs/codex-app-server/node_modules/.bin/codex";
  assert.equal(config.plugins.entries.codex.config.appServer.command, command);
  await verifyAppServer(openclawRelease.appServerVersion, command);
  if (process.env.NEURAL_LABS_UPDATE_PROBATION === "true") {
    const { stdout: effective } = await execute("openclaw", ["config", "get", "agents", "--json"], { timeout: 30000, maxBuffer: 2**20 });
    const agents = JSON.parse(effective);
    assert.equal(agents.defaults.heartbeat.every, "0m");
    assert.ok(agents.entries && typeof agents.entries === "object");
    for (const agent of Object.values(agents.entries)) assert.equal(agent.heartbeat.every, "0m");
  }
  console.log("Workspace runtime, integration, probation, and isolation checks passed");
} catch {
  console.error("Workspace update verification failed");
  process.exitCode = 1;
}
