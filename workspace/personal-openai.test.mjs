import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { PersonalOpenAIManager, personalAgentId, personalProfileId, personalRoleId } from "./personal-openai.mjs";

const userId = "11111111-1111-4111-8111-111111111111";
const agentId = "nl-11111111111141118111111111111111";
const profileId = `openai:${agentId}`;

function personalAuthStatePath(id = agentId) {
  return `/home/node/.openclaw/agents/${id}/agent/openclaw-agent.sqlite`;
}

function gatewayAuthStatus(id = agentId, status = "ok") {
  return {
    providers: [{
      provider: "openai",
      status,
      profiles: [{ profileId: `openai:${id}`, type: "oauth", status }],
    }],
  };
}

test("derives stable non-secret personal agent and role ids", () => {
  assert.equal(personalAgentId(userId), agentId);
  assert.equal(personalRoleId(userId), `personal-${agentId}`);
  assert.equal(personalProfileId(userId), profileId);
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
    if (args[0] === "models" && args[1] === "auth" && args[2] === "list") {
      return { stdout: JSON.stringify({ authStatePath: personalAuthStatePath(), profiles: [{ id: profileId, provider: "openai", type: "oauth" }] }) };
    }
    if (args[0] === "models" && args[1] === "auth" && args[2] === "order" && args[3] === "get") {
      return { stdout: JSON.stringify({ authStatePath: personalAuthStatePath(), order: [profileId] }) };
    }
    if (args[0] === "models" && args[1] === "status") return { stdout: JSON.stringify({ auth: { missingProvidersInUse: [], modelRouteIssues: [] } }) };
    return { stdout: "" };
  };
  const gatewayRequest = async (method, params) => {
    gatewayCalls.push([method, params]);
    if (method === "agents.list") return { agents: [{ id: agentId }] };
    if (method === "models.authStatus") return gatewayAuthStatus();
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
    if (args[0] === "models" && args[1] === "auth" && args[2] === "list") {
      return { stdout: JSON.stringify({ authStatePath: "/home/node/.openclaw/state/openclaw.sqlite", profiles: [{ id: "openai:somebody-else", provider: "openai", type: "oauth" }] }) };
    }
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
    spawnLogin: (spawnedAgentId, spawnedProfileId) => {
      assert.equal(spawnedAgentId, agentId);
      assert.equal(spawnedProfileId, profileId);
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

test("rejects inherited OpenAI auth and pins a local credential to its personal agent", async () => {
  let local = false;
  let ordered = false;
  const executeCalls = [];
  const execute = async (_command, args) => {
    executeCalls.push(args);
    if (args[0] === "agents" && args[1] === "list") return { stdout: JSON.stringify({ agents: [{ id: agentId }] }) };
    if (args[0] === "models" && args[1] === "auth" && args[2] === "list") {
      return { stdout: JSON.stringify(local
        ? { authStatePath: personalAuthStatePath(), profiles: [{ id: profileId, provider: "openai", type: "oauth" }] }
        : { authStatePath: "/home/node/.openclaw/state/openclaw.sqlite", profiles: [{ id: "openai:shared-owner", provider: "openai", type: "oauth" }] }) };
    }
    if (args[0] === "models" && args[1] === "auth" && args[2] === "order" && args[3] === "get") {
      return { stdout: JSON.stringify({ authStatePath: personalAuthStatePath(), order: ordered ? [profileId] : null }) };
    }
    if (args[0] === "models" && args[1] === "auth" && args[2] === "order" && args[3] === "set") {
      ordered = true;
      return { stdout: "" };
    }
    if (args[0] === "models" && args[1] === "status") {
      return { stdout: JSON.stringify({ auth: { missingProvidersInUse: [], modelRouteIssues: [] } }) };
    }
    return { stdout: "" };
  };
  const manager = new PersonalOpenAIManager({
    workspaceRoot: "/workspace",
    stateRoot: "/state",
    execute,
    gatewayRequest: async (method) => method === "agents.list"
      ? { agents: [{ id: agentId }] }
      : method === "models.authStatus"
        ? gatewayAuthStatus()
        : { profiles: [{ id: "profile-user", emails: [userId], role: `personal-${agentId}` }] },
  });

  const inherited = await manager.snapshot(userId);
  assert.equal(inherited.authenticated, false);
  assert.equal(inherited.modelReady, false);

  local = true;
  const isolated = await manager.snapshot(userId);
  assert.equal(isolated.authenticated, true);
  assert.equal(isolated.modelReady, true);
  assert.equal(ordered, true);
  assert.equal(executeCalls.some((args) => args.join(" ") === `models auth order set --agent ${agentId} --provider openai ${profileId}`), true);
});

test("keeps two developers on distinct local profiles and personal agents", async () => {
  const secondUserId = "22222222-2222-4222-8222-222222222222";
  const secondAgentId = personalAgentId(secondUserId);
  const roleByUser = new Map([
    [userId, personalRoleId(userId)],
    [secondUserId, personalRoleId(secondUserId)],
  ]);
  const execute = async (_command, args) => {
    const selectedAgentId = args[args.indexOf("--agent") + 1];
    const selectedProfileId = `openai:${selectedAgentId}`;
    if (args[0] === "agents" && args[1] === "list") {
      return { stdout: JSON.stringify({ agents: [{ id: agentId }, { id: secondAgentId }] }) };
    }
    if (args[0] === "models" && args[1] === "auth" && args[2] === "list") {
      return { stdout: JSON.stringify({
        authStatePath: personalAuthStatePath(selectedAgentId),
        profiles: [{ id: selectedProfileId, provider: "openai", type: "oauth" }],
      }) };
    }
    if (args[0] === "models" && args[1] === "auth" && args[2] === "order" && args[3] === "get") {
      return { stdout: JSON.stringify({
        authStatePath: personalAuthStatePath(selectedAgentId),
        order: [selectedProfileId],
      }) };
    }
    if (args[0] === "models" && args[1] === "status") {
      return { stdout: JSON.stringify({ auth: { missingProvidersInUse: [], modelRouteIssues: [] } }) };
    }
    return { stdout: "" };
  };
  const manager = new PersonalOpenAIManager({
    workspaceRoot: "/workspace",
    stateRoot: "/state",
    execute,
    gatewayRequest: async (method, params) => method === "agents.list"
      ? { agents: [{ id: agentId }, { id: secondAgentId }] }
      : method === "models.authStatus"
        ? gatewayAuthStatus(params.agentId)
        : { profiles: [...roleByUser].map(([id, role], index) => ({ id: `profile-${index}`, emails: [id], role })) },
  });

  const first = await manager.snapshot(userId);
  const second = await manager.snapshot(secondUserId);
  assert.equal(first.authenticated, true);
  assert.equal(second.authenticated, true);
  assert.notEqual(first.agentId, second.agentId);
  assert.equal(await manager.prepareRun(userId), agentId);
  assert.equal(await manager.prepareRun(secondUserId), secondAgentId);
  assert.notEqual(personalProfileId(userId), personalProfileId(secondUserId));
});

test("refreshes stale Gateway auth before marking a saved personal profile ready", async () => {
  const gatewayCalls = [];
  const execute = async (_command, args) => {
    if (args[0] === "agents" && args[1] === "list") return { stdout: JSON.stringify({ agents: [{ id: agentId }] }) };
    if (args[0] === "models" && args[1] === "auth" && args[2] === "list") {
      return { stdout: JSON.stringify({ authStatePath: personalAuthStatePath(), profiles: [{ id: profileId, provider: "openai", type: "oauth" }] }) };
    }
    if (args[0] === "models" && args[1] === "auth" && args[2] === "order" && args[3] === "get") {
      return { stdout: JSON.stringify({ authStatePath: personalAuthStatePath(), order: [profileId] }) };
    }
    if (args[0] === "models" && args[1] === "status") {
      return { stdout: JSON.stringify({ auth: { missingProvidersInUse: [], modelRouteIssues: [] } }) };
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
      if (method === "models.authStatus") return params.refresh ? gatewayAuthStatus() : { providers: [] };
      if (method === "users.list") return { profiles: [{ id: "profile-user", emails: [userId], role: `personal-${agentId}` }] };
      return {};
    },
  });

  const snapshot = await manager.snapshot(userId);

  assert.equal(snapshot.authenticated, true);
  assert.equal(snapshot.modelReady, true);
  assert.equal(gatewayCalls.some(([method, params]) => method === "models.authStatus" && params.agentId === agentId && params.refresh === true), true);
});

test("fails closed when the Gateway cannot activate the exact personal profile", async () => {
  const execute = async (_command, args) => {
    if (args[0] === "agents" && args[1] === "list") return { stdout: JSON.stringify({ agents: [{ id: agentId }] }) };
    if (args[0] === "models" && args[1] === "auth" && args[2] === "list") {
      return { stdout: JSON.stringify({ authStatePath: personalAuthStatePath(), profiles: [{ id: profileId, provider: "openai", type: "oauth" }] }) };
    }
    if (args[0] === "models" && args[1] === "auth" && args[2] === "order" && args[3] === "get") {
      return { stdout: JSON.stringify({ authStatePath: personalAuthStatePath(), order: [profileId] }) };
    }
    if (args[0] === "models" && args[1] === "status") {
      return { stdout: JSON.stringify({ auth: { missingProvidersInUse: [], modelRouteIssues: [] } }) };
    }
    return { stdout: "" };
  };
  const manager = new PersonalOpenAIManager({
    workspaceRoot: "/workspace",
    stateRoot: "/state",
    execute,
    gatewayRequest: async (method) => method === "agents.list"
      ? { agents: [{ id: agentId }] }
      : method === "models.authStatus"
        ? gatewayAuthStatus("nl-somebodyelse")
        : { profiles: [{ id: "profile-user", emails: [userId], role: `personal-${agentId}` }] },
  });

  const snapshot = await manager.snapshot(userId);

  assert.equal(snapshot.authenticated, true);
  assert.equal(snapshot.modelReady, false);
  await assert.rejects(() => manager.prepareRun(userId), /connect their OpenAI account/);
});

test("coalesces concurrent status refreshes so account flags come from one snapshot", async () => {
  let authListCalls = 0;
  let releaseAuthList;
  const authListGate = new Promise((resolve) => { releaseAuthList = resolve; });
  const execute = async (_command, args) => {
    if (args[0] === "agents" && args[1] === "list") return { stdout: JSON.stringify({ agents: [{ id: agentId }] }) };
    if (args[0] === "models" && args[1] === "auth" && args[2] === "list") {
      authListCalls += 1;
      await authListGate;
      return { stdout: JSON.stringify({ authStatePath: personalAuthStatePath(), profiles: [{ id: profileId, provider: "openai", type: "oauth" }] }) };
    }
    if (args[0] === "models" && args[1] === "auth" && args[2] === "order" && args[3] === "get") {
      return { stdout: JSON.stringify({ authStatePath: personalAuthStatePath(), order: [profileId] }) };
    }
    if (args[0] === "models" && args[1] === "status") {
      return { stdout: JSON.stringify({ auth: { missingProvidersInUse: [], modelRouteIssues: [] } }) };
    }
    return { stdout: "" };
  };
  const manager = new PersonalOpenAIManager({
    workspaceRoot: "/workspace",
    stateRoot: "/state",
    execute,
    gatewayRequest: async (method) => method === "agents.list"
      ? { agents: [{ id: agentId }] }
      : method === "models.authStatus"
        ? gatewayAuthStatus()
        : { profiles: [{ id: "profile-user", emails: [userId], role: `personal-${agentId}` }] },
  });

  const first = manager.snapshot(userId);
  const second = manager.snapshot(userId);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(authListCalls, 1);
  releaseAuthList();
  const snapshots = await Promise.all([first, second]);

  assert.equal(authListCalls, 1);
  assert.deepEqual(snapshots.map(({ authenticated, modelReady }) => ({ authenticated, modelReady })), [
    { authenticated: true, modelReady: true },
    { authenticated: true, modelReady: true },
  ]);
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
