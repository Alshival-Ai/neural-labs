import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { PersonalOpenAIManager, personalAgentId, personalRoleId } from "./personal-openai.mjs";

const userId = "11111111-1111-4111-8111-111111111111";
const agentId = "nl-11111111111141118111111111111111";

test("derives stable non-secret personal agent and role ids", () => {
  assert.equal(personalAgentId(userId), agentId);
  assert.equal(personalRoleId(userId), `personal-${agentId}`);
  assert.throws(() => personalAgentId("person@example.org"), /invalid/);
});

test("provisions isolated auth, assigns only the matching profile, and preserves it while paused", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "neural-labs-personal-openai-"));
  const executeCalls = [];
  const gatewayCalls = [];
  let role = `personal-${agentId}`;
  const execute = async (_command, args) => {
    executeCalls.push(args);
    if (args[0] === "agents" && args[1] === "list") return { stdout: JSON.stringify({ agents: [] }) };
    if (args[0] === "agents" && args[1] === "add") return { stdout: JSON.stringify({ id: agentId }) };
    if (args[0] === "models" && args[1] === "auth") return { stdout: JSON.stringify({ profiles: [{ provider: "openai", type: "oauth" }] }) };
    if (args[0] === "models" && args[1] === "status") return { stdout: JSON.stringify({ auth: { missingProvidersInUse: [], modelRouteIssues: [] } }) };
    return { stdout: "" };
  };
  const gatewayRequest = async (method, params) => {
    gatewayCalls.push([method, params]);
    if (method === "agents.list") return { agents: [{ id: agentId }] };
    if (method === "users.list") return { profiles: [{ id: "profile-user", emails: [userId], role }] };
    if (method === "users.setRole") { role = params.role; return {}; }
    return {};
  };
  const manager = new PersonalOpenAIManager({ workspaceRoot: "/workspace", stateRoot, execute, gatewayRequest });
  try {
    const snapshot = await manager.snapshot(userId);
    assert.equal(snapshot.authenticated, true);
    assert.equal(snapshot.modelReady, true);
    assert.equal(snapshot.paused, false);
    assert.equal(snapshot.agentId, agentId);
    assert.equal(executeCalls.some((args) => args.includes(path.join(stateRoot, "agents", agentId, "agent"))), true);
    assert.equal(executeCalls.some((args) => args[0] === "config" && args.includes(`gateway.roles.definitions.personal-${agentId}`)), true);
    assert.equal(executeCalls.some((args) => args[0] === "config" && args.includes("--strict-json")), true);
    assert.equal(executeCalls.some((args) => args.includes("--json-strict")), false);

    const paused = await manager.pause(userId);
    assert.equal(paused.paused, true);
    assert.equal(role, "unlinked");
    const resumed = await manager.resume(userId);
    assert.equal(resumed.paused, false);
    assert.equal(role, `personal-${agentId}`);
    assert.equal(await manager.prepareRun(userId), agentId);
    assert.equal(gatewayCalls.some(([method, params]) => method === "users.setRole" && params.role === "unlinked"), true);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});

test("starts personal ChatGPT login before a Gateway browser profile exists", async () => {
  const child = new EventEmitter();
  child.pid = 98765;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  let loginStarts = 0;
  const gatewayCalls = [];
  const execute = async (_command, args) => {
    if (args[0] === "agents" && args[1] === "list") return { stdout: JSON.stringify({ agents: [{ id: agentId }] }) };
    if (args[0] === "models" && args[1] === "auth") return { stdout: JSON.stringify({ profiles: [] }) };
    if (args[0] === "models" && args[1] === "status") {
      return { stdout: JSON.stringify({ auth: { missingProvidersInUse: ["openai"], modelRouteIssues: [] } }) };
    }
    return { stdout: "" };
  };
  const manager = new PersonalOpenAIManager({
    workspaceRoot: "/workspace",
    stateRoot: "/state",
    execute,
    gatewayRequest: async (method, params) => {
      gatewayCalls.push([method, params]);
      if (method === "agents.list") return { agents: [{ id: agentId }] };
      if (method === "users.list") return { profiles: [] };
      return {};
    },
    spawnLogin: () => {
      loginStarts += 1;
      return child;
    },
  });

  const started = await manager.start(userId);

  assert.equal(started.state, "starting");
  assert.equal(started.agentId, agentId);
  assert.equal(started.paused, false);
  assert.equal(loginStarts, 1);
  assert.equal(gatewayCalls.some(([method]) => method === "users.setRole"), false);
});

test("reconciliation leaves service and personal profiles intact while restricting unknown Neural users", async () => {
  const changed = [];
  const manager = new PersonalOpenAIManager({
    workspaceRoot: "/workspace",
    stateRoot: "/state",
    execute: async () => ({ stdout: "[]" }),
    gatewayRequest: async (method, params) => {
      if (method === "users.list") return { profiles: [
        { id: "unknown", emails: ["22222222-2222-4222-8222-222222222222"], role: "operator" },
        { id: "already-restricted", emails: ["33333333-3333-4333-8333-333333333333"], role: "unlinked" },
        { id: "personal", emails: [userId], role: `personal-${agentId}` },
        { id: "service", emails: ["neural-labs-automations-admin"], role: "maintainer" },
      ] };
      if (method === "users.setRole") changed.push(params);
      return {};
    },
  });
  await manager.restrictKnownProfiles();
  assert.deepEqual(changed, [{ profileId: "unknown", role: "unlinked" }]);
});

test("legacy Neura session cleanup is one-time", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "neural-labs-personal-cleanup-"));
  const deleted = [];
  let listed = 0;
  const manager = new PersonalOpenAIManager({
    workspaceRoot: "/workspace", stateRoot,
    execute: async () => ({ stdout: "[]" }),
    gatewayRequest: async (method, params) => {
      if (method === "sessions.list") { listed += 1; return { sessions: [{ key: "agent:main:old", category: "neura-private" }, { key: "agent:main:keep", category: "other" }] }; }
      if (method === "sessions.delete") deleted.push(params.key);
      return {};
    },
  });
  try {
    await manager.purgeLegacyNeuraSessions();
    await manager.purgeLegacyNeuraSessions();
    assert.equal(listed, 1);
    assert.deepEqual(deleted, ["agent:main:old"]);
  } finally {
    await rm(stateRoot, { recursive: true, force: true });
  }
});
