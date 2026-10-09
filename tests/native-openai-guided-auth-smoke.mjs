// Operator-only acceptance in an isolated candidate with an empty fixture home.
// Starts and cancels device login; never completes consent or prints the code.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { NativeAccounts } from "/usr/local/lib/neural-labs/native/accounts.mjs";
import { WorkspaceTerminalManager } from "/usr/local/lib/neural-labs/terminal-manager.mjs";
import { createNativeLauncher, prepareNativeHome } from "/usr/local/lib/neural-labs/native/launcher.mjs";
const require = createRequire("/usr/local/lib/neural-labs/package.json");
const pty = require("node-pty");
const root = await mkdtemp("/tmp/openai-guided-auth-fixture-");
const actor = { id: "fixture", label: "Fixture", role: "user" };
const terminals = new WorkspaceTerminalManager({ workspaceRoot: root });
const accounts = new NativeAccounts({ terminals, spawnPty: pty.spawn, resolveActor: async () => actor });
const grant = { actor: actor.id, connection: "fixture", binding: { provider: "codex", method: "subscription" }, revalidate: async () => {} };
try {
  await mkdir(root + "/workspace");
  const home = await prepareNativeHome(root + "/account");
  const launch = await createNativeLauncher({ workspaceRoot: root + "/workspace", homeRoot: home });
  await accounts.login(grant, launch);
  let codeReady = false;
  for (let n = 0; n < 45; n++) {
    const status = await accounts.status(grant, launch);
    if (status.signIn?.verificationUrl === "https://auth.openai.com/codex/device"
        && /^[A-Z0-9][A-Z0-9-]{2,30}[A-Z0-9]$/.test(status.signIn?.userCode || "")) {
      codeReady = true;
      break;
    }
    if (!status.pending) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.ok(codeReady, "Pinned Codex device prompt must reach its owner's status response");
  assert.equal(await accounts.deviceSignIn({ ...grant, actor: "another-user" }), null);
  assert.equal((await accounts.cancel(grant)).cancelled, true);
  assert.equal(await accounts.deviceSignIn(grant), null);
  console.log("Pinned Codex device-code extraction, owner isolation, and cancellation passed; no credentials or inference");
} finally {
  terminals.shutdown(); accounts.close();
  await new Promise(resolve => setTimeout(resolve, 100));
  await rm(root, { recursive: true, force: true });
}
