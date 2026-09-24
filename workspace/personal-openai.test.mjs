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
  manager.writeSelectedMethod = async (selected, method) => { selected.authMethod = method; };
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

test("personal OpenAI API key is stored in its own profile and selected without exposing it to CLI arguments", async () => {
  const { manager, account, calls } = fixture();
  let method = "chatgpt";
  account.controller.cancelAndWait = async () => calls.push(["cancel-login"]);
  manager.writeProviderPause = async (_userId, paused) => calls.push(["pause", paused]);
  manager.writeSelectedMethod = async (_account, next) => { method = next; account.authMethod = next; calls.push(["method", next]); };
  manager.readSelectedMethod = async () => method;
  manager.saveKey = async ({ agentDir, profileId, key }) => {
    assert.equal(agentDir, "/unused/agents/nl-alice/agent");
    assert.equal(profileId, "openai:nl-alice-api");
    assert.equal(key, "sk-test-personal");
    calls.push(["native-key-write"]);
  };
  manager.refresh = async () => { account.authenticated = true; account.modelReady = true; };
  const result = await manager.saveApiKey("alice", "sk-test-personal");
  assert.equal(result.authMethod, "api-key");
  assert.equal(result.authenticated, true);
  assert.equal(result.modelReady, true);
  assert.deepEqual(calls.slice(0, 5), [
    ["cancel-login"], ["pause", true], ["native-key-write"], ["method", "api-key"], ["pause", false],
  ]);
  assert.equal(JSON.stringify(calls).includes("sk-test-personal"), false);
});

test("selected key profile cannot fall back to an existing ChatGPT credential", async () => {
  const { manager, account } = fixture();
  manager.ensureProvisioned = async () => account;
  manager.readSelectedMethod = async () => "api-key";
  let profiles = [{ id: account.profileId, provider: "openai", type: "oauth" }];
  manager.openclawJson = async (args) => {
    if (args.includes("list")) return { authStatePath: "/state/agents/nl-alice/agent/openclaw-agent.sqlite", profiles };
    if (args.includes("get")) return { authStatePath: "/state/agents/nl-alice/agent/openclaw-agent.sqlite", order: [account.keyProfileId] };
    return { auth: { missingProvidersInUse: [], modelRouteIssues: [] } };
  };
  manager.gatewayRequest = async () => ({ providers: [{ provider: "openai", status: "ok", profiles: [{ profileId: account.keyProfileId, type: "api_key", status: "ok" }] }] });
  await manager.refreshOnce(account);
  assert.equal(account.authenticated, false);
  profiles = [...profiles, { id: account.keyProfileId, provider: "openai", type: "api_key" }];
  await manager.refreshOnce(account);
  assert.equal(account.authMethod, "api-key");
  assert.equal(account.authenticated, true);
  assert.equal(account.modelReady, true);
});

test("switching from a key to ChatGPT clears the key order before device sign-in", async () => {
  const { manager, account, calls } = fixture();
  account.authMethod = "api-key";
  manager.readSelectedMethod = async () => account.authMethod;
  manager.writeProviderPause = async (_userId, paused) => calls.push(["pause", paused]);
  manager.writeSelectedMethod = async (selected, method) => { calls.push(["method", method]); selected.authMethod = method; };
  manager.refresh = async () => { account.authenticated = false; account.modelReady = false; };
  account.controller.start = () => ({ provider: "openai", state: "starting", authenticated: false, modelReady: false });
  const result = await manager.start("alice");
  assert.equal(result.state, "starting");
  assert.equal(result.authMethod, "chatgpt");
  assert.deepEqual(calls, [["pause", true], ["method", "chatgpt"], ["pause", false], ["role", "alice", "unlinked"]]);
});

test("disconnect removes both saved billing methods from the owned store", async () => {
  const profiles = new Set(["openai:nl-alice", "openai:nl-alice-api"]);
  const calls = [];
  const manager = new PersonalOpenAIManager({ workspaceRoot: "/unused", stateRoot: "/unused", gatewayRequest: async () => ({}), execute: async (command, args) => {
    if (args.includes("logout")) { profiles.delete(args[3]); calls.push(args[3]); return { stdout: "" }; }
    return { stdout: JSON.stringify({ authStatePath: "/state/agents/nl-alice/agent/openclaw-agent.sqlite", profiles: [...profiles].map(id => ({ id, provider: "openai", type: id.endsWith("-api") ? "api_key" : "oauth" })) }) };
  } });
  const account = manager.account("alice"); account.provisioned = true; account.authenticated = true;
  manager.assignRole = async () => {};
  manager.writeSelectedMethod = async (selected, method) => { selected.authMethod = method; };
  const result = await manager.disconnect("alice");
  assert.equal(result.state, "disconnected");
  assert.deepEqual(calls, ["openai:nl-alice", "openai:nl-alice-api"]);
  assert.equal(profiles.size, 0);
});
