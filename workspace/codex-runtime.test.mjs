import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { managedCodexCommand, verifyCodexRuntime } from "./codex-runtime.mjs";

test("checks both managed and shell commands against the release pin without API keys", async () => {
  const calls = [];
  const result = await verifyCodexRuntime("0.152.0", async (command, args, options) => {
    calls.push(command);
    assert.deepEqual(args, ["--version"]);
    assert.equal(options.env.OPENAI_API_KEY, undefined);
    assert.equal(options.timeout, 10_000);
    return { stdout: "codex-cli 0.152.0\n" };
  });
  assert.deepEqual(calls, [managedCodexCommand, "/app/node_modules/.bin/codex", "/usr/local/bin/codex"]);
  assert.deepEqual(result, { name: "Codex", version: "0.152.0" });
});

test("refuses a stale managed runtime and a missing version pin", async () => {
  await assert.rejects(verifyCodexRuntime("0.152.0", async () => ({ stdout: "codex-cli 0.151.0" })), /must match/);
  await assert.rejects(verifyCodexRuntime(undefined), /pinned/);
});

test("the image installs a managed launcher without disabling managed features", async () => {
  const container = await readFile(new URL("./Containerfile", import.meta.url), "utf8");
  assert.ok(container.includes(`ln -sfn /usr/local/lib/node_modules/@openai/codex/bin/codex.js ${managedCodexCommand}`));
  assert.ok(container.includes("NEURAL_LABS_CODEX_VERSION=${CODEX_VERSION}"));
  assert.ok(!container.includes("OPENCLAW_CODEX_APP_SERVER_BIN="));
});
