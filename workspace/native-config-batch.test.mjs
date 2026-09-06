import assert from "node:assert/strict";
import test from "node:test";
import { applyNativeConfigBatch } from "./native-config-batch.mjs";

const operations = [{ path: "agents.entries.main.model", value: { primary: "openai/gpt-6-astra", fallbacks: [] } }, { path: "agents.entries.main.thinkingDefault", value: "high" }];
test("model and effort are sent as one public CLI transaction without a shell", async () => {
  let completed = false;
  await applyNativeConfigBatch(operations, async (command, args, options) => {
    assert.equal(command, "openclaw");
    assert.deepEqual(args.slice(0, 3), ["config", "set", "--batch-json"]);
    assert.deepEqual(JSON.parse(args[3]), operations);
    assert.equal(options.shell, undefined);
    assert.ok(options.timeout < 120_000);
    await Promise.resolve();
    completed = true;
    return { stdout: "private configuration", stderr: "private warning" };
  });
  assert.equal(completed, true);
});
test("CLI rejection and timeouts fail without disclosing provider output", async () => {
  for (const cause of [new Error("private credential"), Object.assign(new Error("private output"), { killed: true })]) {
    await assert.rejects(applyNativeConfigBatch(operations, async () => { throw cause; }), (error) => {
      assert.equal(error.message.includes("private"), false);
      assert.equal(error.cause, undefined);
      return /inspect the current settings/.test(error.message);
    });
  }
  await assert.rejects(applyNativeConfigBatch([], () => assert.fail("must not execute")));
  await assert.rejects(applyNativeConfigBatch([{}, {}], () => assert.fail("must not execute")));
});
