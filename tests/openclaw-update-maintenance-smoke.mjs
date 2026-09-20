// Explicit operator/CI probe. The read-only container has only synthetic /tmp state.
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { UpdateMaintenance, prepareProbation } from "/usr/local/lib/neural-labs/update-maintenance.mjs";
import { createGatewayAdminRequest } from "/usr/local/lib/neural-labs/personal-openai.mjs";
const root = "/tmp/neural-update-probe";
let inferenceRequests = 0;
const inference = createServer(async (req, res) => {
  console.log("Synthetic model request", req.method, req.url);
  if (req.method === "GET") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ object: "list", data: [{ id: "synthetic", object: "model", owned_by: "synthetic" }] })); return; }
  if (req.headers.authorization !== "Bearer synthetic-test-only") { res.writeHead(401).end(); return; }
  for await (const _chunk of req) { /* synthetic prompts only */ }
  inferenceRequests++;
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  const chunk = { id: "synthetic", object: "chat.completion.chunk", created: 1, model: "synthetic", choices: [{ index: 0, delta: { role: "assistant", content: "UPDATER_SYNTHETIC_OK" }, finish_reason: null }] };
  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  res.write(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`);
  res.end("data: [DONE]\n\n");
});
await new Promise(resolve => inference.listen(0, "127.0.0.1", resolve));
inference.unref();
Object.assign(process.env, { HOME: root, OPENCLAW_HOME: root, OPENCLAW_STATE_DIR: root + "/.openclaw", OPENCLAW_CONFIG_PATH: root + "/.openclaw/openclaw.json",
  OPENCLAW_SKIP_CHANNELS: "1", OPENCLAW_SKIP_PROVIDERS: "1", OPENCLAW_SKIP_GMAIL_WATCHER: "1" });
await mkdir(root + "/.openclaw", { recursive: true });
const config = { logging: { consoleLevel: "info" }, gateway: { mode: "local", bind: "loopback", port: 18789, auth: { mode: "password", password: "synthetic-update-probe-password" } },
  models: { providers: { "nl-updater-test": { baseUrl: `http://127.0.0.1:${inference.address().port}/v1`, apiKey: "synthetic-test-only", api: "openai-completions", models: [{ id: "synthetic", name: "Synthetic test", contextWindow: 32768, maxTokens: 256 }] } } },
  agents: { ownership: "explicit", defaults: { model: { primary: "nl-updater-test/synthetic" }, heartbeat: { every: "1h" } }, list: [{ id: "main", workspace: root + "/workspace", heartbeat: { every: "2h" } }, { id: "other", workspace: root + "/workspace" }] } };
await writeFile(process.env.OPENCLAW_CONFIG_PATH, JSON.stringify(config));
const run = (args) => { const result = spawnSync("openclaw", args, { encoding: "utf8", timeout: 120000, maxBuffer: 2**22 }); if (result.status !== 0) console.error("Synthetic CLI failure", args, result.stderr, result.stdout, result.error?.message); return result; };
await prepareProbation({ root, probation: true, run });
const quiet = JSON.parse(run(["config", "get", "agents", "--json"]).stdout);
assert.equal(quiet.defaults.heartbeat.every, "0m");
assert.ok(Object.values(quiet.entries).every(a => a.heartbeat.every === "0m"));
await prepareProbation({ root, probation: false, activate: true, run });
const restored = JSON.parse(run(["config", "get", "agents", "--json"]).stdout);
assert.equal(restored.defaults.heartbeat.every, "1h");
assert.equal(restored.entries.main.heartbeat.every, "2h");
assert.equal(restored.entries.other.heartbeat, undefined);
await prepareProbation({ root, probation: true, run });
const gateway = spawn("openclaw", ["gateway", "run", "--port", "18789"], { stdio: ["ignore", "pipe", "pipe"] });
let log = ""; gateway.stdout.on("data", b => { log = (log + b).slice(-4000); }); gateway.stderr.on("data", b => { log = (log + b).slice(-4000); });
try {
  let ready = false;
  for (let i = 0; i < 240; i++) { try { if ((await fetch("http://127.0.0.1:18789/healthz")).ok) { ready = true; break; } } catch {} await new Promise(r => setTimeout(r, 500)); }
  assert.ok(ready, `Gateway exit=${gateway.exitCode}; synthetic requests=${inferenceRequests}; ${log}`);
  const request = createGatewayAdminRequest({ url: "ws://127.0.0.1:18789", password: "synthetic-update-probe-password" });
  // Readiness may precede completion of public RPC registration.
  for (let i = 0; ; i++) { try { await request("status", {}); break; } catch(e) { if (i >= 20) throw e; await new Promise(r => setTimeout(r, 1000)); } }
  await request("sessions.create", { key: "agent:main:neura:updater", agentId: "main", label: "synthetic-update", visibility: "draft" });
  const maintenance = new UpdateMaintenance({ root, request, configPath: process.env.OPENCLAW_CONFIG_PATH });
  assert.equal((await maintenance.activity()).idle, true);
  await request("chat.send", { sessionKey: "agent:main:neura:updater", message: "Reply with the synthetic test marker.", idempotencyKey: randomUUID() });
  let answered = false;
  for (let i = 0; i < 90; i++) {
    const history = await request("chat.history", { sessionKey: "agent:main:neura:updater", agentId: "main" });
    if (JSON.stringify(history).includes("UPDATER_SYNTHETIC_OK") && (await maintenance.activity()).idle) { answered = true; break; }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.ok(answered, "Synthetic model inference did not complete");
  assert.ok(inferenceRequests > 0);
  const job = await request("cron.add", { name: "synthetic-update-job", agentId: "main", enabled: true, schedule: { kind: "every", everyMs: 3600000 },
    sessionTarget: "isolated", wakeMode: "next-heartbeat", payload: { kind: "agentTurn", message: "Synthetic probe must never run" }, delivery: { mode: "none" } });
  await maintenance.pause();
  assert.equal((await maintenance.activity()).idle, true);
  const jobs = await request("cron.list", { includeDisabled: true });
  assert.equal(jobs.jobs.find(j => j.id === job.id).enabled, true);
  assert.equal((await request("cron.status", {})).enabled, false);
  await maintenance.resume();
  assert.equal((await request("cron.status", {})).enabled, true);
  assert.equal((await request("cron.list", { includeDisabled: true })).jobs.find(j => j.id === job.id).enabled, true);
  console.log("Synthetic inference, native heartbeat configuration, activity RPC, cron pause/resume and recovery ledger passed");
} finally {
  inference.close();
  gateway.kill("SIGTERM");
  await new Promise(resolve => { gateway.once("exit", resolve); setTimeout(() => { gateway.kill("SIGKILL"); resolve(); }, 10000).unref(); });
}
