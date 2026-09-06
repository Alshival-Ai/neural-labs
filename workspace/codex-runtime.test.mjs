import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { verifyCodexRuntime } from "./codex-runtime.mjs";

test("checks only the separate terminal CLI without provider keys", async () => {
  const calls = [];
  const result = await verifyCodexRuntime("0.152.0", async (command, args, options) => {
    calls.push(command);
    assert.deepEqual(args, ["--version"]);
    assert.equal(options.env.OPENAI_API_KEY, undefined);
    assert.equal(options.timeout, 10_000);
    return { stdout: "codex-cli 0.152.0\n" };
  });
  assert.deepEqual(calls, ["/usr/local/bin/codex"]);
  assert.deepEqual(result, { name: "Codex CLI", version: "0.152.0" });
});

test("refuses a stale terminal CLI and a missing version pin", async () => {
  await assert.rejects(verifyCodexRuntime("0.152.0", async () => ({ stdout: "codex-cli 0.151.0" })), /does not match/);
  await assert.rejects(verifyCodexRuntime(undefined), /pinned/);
});

test("the image leaves upstream-managed launchers and application files untouched", async () => {
  const container = await readFile(new URL("./Containerfile", import.meta.url), "utf8");
  assert.ok(!container.includes("ln -sfn /usr/local/lib/node_modules/@openai/codex"));
  assert.ok(!container.includes("OPENCLAW_CODEX_APP_SERVER_BIN="));
  assert.ok(!container.includes("planning-build"));
  assert.ok(!container.includes("COPY --from=planning"));
});
