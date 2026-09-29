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
