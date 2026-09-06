import assert from "node:assert/strict";
import test from "node:test";
import { PersonalOpenAIManager } from "./personal-openai.mjs";

function fixture({ fail = false, wrongOwner = false } = {}) {
  const calls = [];
  let present = true;
  const manager = new PersonalOpenAIManager({ workspaceRoot: "/unused", stateRoot: "/unused", gatewayRequest: async () => ({}), execute: async (command, args) => {
    calls.push([command, ...args]);
    if (args.includes("logout")) {
      if (fail) throw new Error("secret native output");
      present = false;
      return { stdout: "" };
    }
    return { stdout: JSON.stringify({ authStatePath: `/state/agents/${wrongOwner ? "main" : "nl-alice"}/agent/openclaw-agent.sqlite`, profiles: present ? [{ id: "openai:nl-alice", provider: "openai", type: "oauth" }] : [] }) };
  } });
  const account = manager.account("alice");
  account.provisioned = true; account.authenticated = true; account.modelReady = true;
  manager.assignRole = async (userId, role) => calls.push(["role", userId, role]);
  return { manager, account, calls };
}

test("disconnect removes only the owned profile, revokes access, and is retryable", async () => {
  const { manager, account, calls } = fixture();
  const other = manager.account("bob"); other.authenticated = true;
  const result = await manager.disconnect("alice");
  assert.equal(result.authenticated, false);
  assert.equal(result.paused, true);
  assert.equal(result.state, "disconnected");
  assert.equal(other.authenticated, true);
  assert.equal(account.modelReady, false);
  assert.deepEqual(calls.find((call) => call.includes("logout")), ["openclaw", "models", "auth", "logout", "openai:nl-alice", "--agent", "nl-alice", "--yes"]);
  assert.deepEqual(calls[0], ["role", "alice", "unlinked"]);
  await manager.disconnect("alice");
  assert.equal(calls.filter((call) => call.includes("logout")).length, 1);
});

test("failed disconnect retains credential status and never leaks native output", async () => {
  const { manager, account } = fixture({ fail: true });
  await assert.rejects(manager.disconnect("alice"), /^Error: Disconnect could not be completed/);
  assert.equal(account.authenticated, true);
  assert.equal(account.paused, true);
  assert.equal(account.disconnecting, false);
});

test("disconnect refuses a credential store belonging to another agent", async () => {
  const { manager, calls } = fixture({ wrongOwner: true });
  await assert.rejects(manager.disconnect("alice"));
  assert.equal(calls.some((call) => call.includes("logout")), false);
});

test("disconnect waits for login shutdown and serializes account actions", async () => {
  const { manager, account, calls } = fixture();
  let finish;
  account.controller.cancelAndWait = () => new Promise((resolve) => { finish = resolve; });
  const disconnect = manager.disconnect("alice");
  await new Promise((resolve) => setImmediate(resolve));
  let resumed = false;
  manager.resumeOnce = async () => { resumed = true; };
  const resume = manager.resume("alice");
  assert.equal(calls.length, 0);
  assert.equal(resumed, false);
  finish(); await disconnect; await resume;
  assert.equal(resumed, true);
});
