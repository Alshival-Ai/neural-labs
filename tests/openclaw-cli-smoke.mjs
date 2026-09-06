// Operator-only smoke test: run in an isolated container without network or
// tenant volumes. It is deliberately not part of make validate.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { applyNativeConfigBatch } from "../workspace/native-config-batch.mjs";

const execute = promisify(execFile);
const directory = await mkdtemp(path.join(tmpdir(), "neural-openclaw-contract-"));
try {
  const state = path.join(directory, "state");
  await mkdir(state);
  const config = path.join(state, "openclaw.json");
  const original = { logging: { consoleLevel: "error" }, agents: { defaults: { model: { primary: "openai/gpt-5.6-sol" }, thinkingDefault: "medium" } } };
  await writeFile(config, JSON.stringify(original), { mode: 0o600 });
  const env = { PATH: process.env.PATH, HOME: directory, CODEX_HOME: path.join(directory, "codex"),
    OPENCLAW_HOME: directory, OPENCLAW_STATE_DIR: state, OPENCLAW_CONFIG_PATH: config, NO_COLOR: "1" };
  const run = (command, args, options) => execute(command, args, { ...options, env });
  const { stdout: version } = await run("openclaw", ["--version"], { encoding: "utf8", timeout: 10_000 });
  const operations = [{ path: "agents.defaults.model", value: { primary: "openai/gpt-5.6-sol", fallbacks: [] } },
    { path: "agents.defaults.thinkingDefault", value: "high" }];
  await run("openclaw", ["config", "set", "--batch-json", JSON.stringify(operations), "--dry-run"], { timeout: 110_000 });
  assert.deepEqual(JSON.parse(await readFile(config, "utf8")), original, "dry run must not modify configuration");
  await applyNativeConfigBatch(operations, run);
  const updated = JSON.parse(await readFile(config, "utf8"));
  assert.deepEqual(updated.agents.defaults.model, operations[0].value);
  assert.equal(updated.agents.defaults.thinkingDefault, "high");
  assert.equal(updated.logging.consoleLevel, "error");
  await assert.rejects(applyNativeConfigBatch([
    { path: "agents.defaults.model", value: { primary: "openai/gpt-5.6-terra" } },
    { path: "agents.defaults.thinkingDefault", value: "invalid-effort" },
  ], run));
  const rejected = JSON.parse(await readFile(config, "utf8"));
  assert.deepEqual(rejected.agents.defaults.model, updated.agents.defaults.model, "invalid second operation must not partially write the first");
  assert.equal(rejected.agents.defaults.thinkingDefault, "high");
  console.log(`${version.trim()}: public CLI dry run, atomic write, rejection and unrelated-setting preservation passed`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
