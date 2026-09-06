import assert from "node:assert/strict";
import test from "node:test";
import { applyNativeConfigBatch, isNativeConfigBundle } from "./native-config-batch.mjs";

const operations = [{ path: "agents.entries.main.model", value: { primary: "openai/gpt-6-astra", fallbacks: [] } }, { path: "agents.entries.main.thinkingDefault", value: "high" }];
test("native bundle discovery excludes the separate config path helper", () => {
  assert.equal(isNativeConfigBundle("config-cli-o6rIOjl9.js"), true);
  assert.equal(isNativeConfigBundle("config-cli-path-C1m43Nmz.js"), false);
});
test("native batch adapter awaits the validated mutation and suppresses private output", async () => {
  let completed = false;
  await applyNativeConfigBatch(operations, async () => ({ runConfigSet: async ({ cliOptions, runtime }) => {
    assert.deepEqual(JSON.parse(cliOptions.batchJson), operations);
    runtime.log("private configuration");
    await Promise.resolve();
    completed = true;
  } }));
  assert.equal(completed, true);
});
test("native batch adapter never treats an error or incompatible runtime as success", async () => {
  await assert.rejects(applyNativeConfigBatch(operations, async () => ({ runConfigSet: async ({ runtime }) => runtime.error("private error") })));
  await assert.rejects(applyNativeConfigBatch(operations, async () => ({})));
  await assert.rejects(applyNativeConfigBatch([], async () => ({})));
});
