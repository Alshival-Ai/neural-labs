// CI image check on a native-architecture runner. Empty generated homes, no
// provider sign-in, inference, network access, or tenant state.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { StdioRpc, CODEX_APP_SERVER } from "/usr/local/lib/neural-labs/native/codex.mjs";

assert.equal(process.arch, process.env.EXPECTED_ARCH);
const root = await mkdtemp("/tmp/native-release-probe-");
const env = { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: root, CODEX_HOME: path.join(root, "codex") };
let rpc;
try {
  assert.equal(execFileSync(CODEX_APP_SERVER, ["--version"], { env, encoding: "utf8", timeout: 10000 }).trim(),
    "codex-cli 0.155.1");
  rpc = new StdioRpc(CODEX_APP_SERVER, ["app-server", "-c", 'forced_login_method="chatgpt"'],
    { cwd: root, env, requestTimeoutMs: 10000 });
  assert.ok(await rpc.request("initialize", { clientInfo: { name: "neural_labs_release_probe", version: "1" } }));
  rpc.send({ method: "initialized" });
  assert.ok(Array.isArray((await rpc.request("thread/list", { limit: 1 })).data));
  console.log(JSON.stringify({ architecture: process.arch, codex: "initialized", inference: false }));
} finally {
  await rpc?.close();
  await rm(root, { recursive: true, force: true });
}
