import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NativeAccounts } from "./native/accounts.mjs";
import { WorkspaceTerminalManager } from "./terminal-manager.mjs";

test("native sign-in revalidates immediately before spawn and keeps the owner's terminal private", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "native-login-"));
  const terminals = new WorkspaceTerminalManager({ workspaceRoot: root });
  const actor = { id: "member", label: "Fixture", role: "admin" };
  let valid = true, checks = 0, starts = 0;
  const exits = [];
  const accounts = new NativeAccounts({ terminals, resolveActor: async () => actor,
    spawnPty: () => { starts++; return { onData() {}, onExit(fn) { exits.push(fn); }, kill() { for (const fn of exits) fn({ exitCode: 1 }); } }; } });
  t.after(async () => { terminals.shutdown(); accounts.close(); await rm(root, { recursive: true, force: true }); });
  const grant = { actor: actor.id, connection: "shared-fixture", binding: { provider: "codex", method: "subscription" },
    revalidate: async () => { checks++; if (!valid) throw new Error("Membership revoked"); } };
  const launch = { invocation: (_command, args) => { assert.deepEqual(args, ["login", "--device-auth"]); return { file: "fixture", args, options: {} }; } };
  valid = false;
  await assert.rejects(accounts.login(grant, launch), /revoked/);
  assert.equal(starts, 0); assert.equal(accounts.logins.size, 0);
  valid = true;
  const result = await accounts.login(grant, launch);
  assert.equal(starts, 1); assert.ok(checks >= 2);
  assert.equal(await terminals.get({ ...actor, id: "another-admin" }, result.terminalId), null);
  await assert.rejects(terminals.setAgentMode(actor, result.terminalId, "shared"), { code: "terminal_private" });
  assert.equal((await accounts.login(grant, launch)).terminalId, result.terminalId);
  assert.equal(starts, 1);
  for (const exit of exits) exit({ exitCode: 0 });
  assert.equal(accounts.logins.size, 0);
});

test("OpenAI device code is exposed only to its owner and can be cancelled", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "native-device-"));
  const terminals = new WorkspaceTerminalManager({ workspaceRoot: root });
  const actor = { id: "member", label: "Fixture", role: "user" };
  const exits = [];
  const accounts = new NativeAccounts({ terminals, resolveActor: async id => ({ ...actor, id }),
    spawnPty: () => ({ onData() {}, onExit(fn) { exits.push(fn); }, kill() { for (const fn of exits) fn({ exitCode: 1 }); } }) });
  t.after(async () => { terminals.shutdown(); accounts.close(); await rm(root, { recursive: true, force: true }); });
  const grant = { actor: actor.id, connection: "personal-fixture", binding: { provider: "codex", method: "subscription" }, revalidate: async () => {} };
  const launch = { invocation: () => ({ file: "fixture", args: [], options: {} }), exec: async () => { throw new Error("Not signed in"); } };
  const { terminalId } = await accounts.login(grant, launch);
  const session = await terminals.get(actor, terminalId);
  terminals.recordOutput(session, "Open this URL: https://auth.openai.com/codex/device\r\nCode: ABCD-EFGH\r\n");
  const pending = await accounts.status(grant, launch);
  assert.equal(pending.pending, true);
  assert.deepEqual(pending.signIn, {
    verificationUrl: "https://auth.openai.com/codex/device", userCode: "ABCD-EFGH",
  });
  session.backlog = [];
  // The pinned Codex 0.155.1 CLI uses a numbered, ANSI-colored prompt,
  // rather than the old URL:/Code: labels. PTY frames can split the code.
  const prompt = "\r\nWelcome to Codex [v0.155.1]\r\n" +
    "\r\n1. Open this link in your browser and sign in to your account\r\n" +
    "   \x1b[34mhttps://auth.openai.com/codex/device\x1b[0m\r\n" +
    "\r\n2. Enter this one-time code \x1b[90m(expires in 15 minutes)\x1b[0m\r\n   \x1b[34mABCD-";
  terminals.recordOutput(session, prompt);
  assert.equal(await accounts.deviceSignIn(grant), null);
  terminals.recordOutput(session, "EFGH\x1b[0m\r\n\r\nContinue only if you started this login in Codex.\r\n");
  assert.deepEqual((await accounts.status(grant, launch)).signIn, pending.signIn);
  for (const unsafeUrl of ["https://attacker.example/codex/device", "https://auth.openai.com/codex/device?redirect=other"]) {
    session.backlog = [];
    terminals.recordOutput(session, prompt.replace("https://auth.openai.com/codex/device", unsafeUrl) + "EFGH\x1b[0m\r\n");
    assert.equal(await accounts.deviceSignIn(grant), null);
  }
  assert.equal(await accounts.deviceSignIn({ ...grant, actor: "other" }), null);
  assert.equal((await accounts.cancel(grant)).cancelled, true);
  assert.equal(await accounts.deviceSignIn(grant), null);
  assert.equal((await accounts.status(grant, launch)).pending, false);
});
