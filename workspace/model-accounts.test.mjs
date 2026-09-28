import assert from "node:assert/strict";
import test from "node:test";
import { ModelAccounts } from "./model-accounts.mjs";

test("default and explicit models choose the matching personal provider without fallback", async () => {
  const owner = { agentId: "nl-alice", roleId: "personal-nl-alice" };
  let claudeActive = true;
  const accounts = new ModelAccounts({
    openai: { account: () => owner, ensureProvisioned: async () => owner,
      openclawJson: async () => ({ entries: { "nl-alice": { model: { primary: "anthropic/test" } } } }),
      snapshot: async () => ({ ...owner, authenticated: true, modelReady: true, paused: false, provider: "openai" }),
    },
    claude: { snapshot: async ({ userId, workload }) => { assert.equal(userId, "alice"); assert.equal(workload, undefined); return { ...owner, authenticated: true, modelReady: claudeActive, paused: !claudeActive, provider: "anthropic" }; } },
  });
  assert.equal((await accounts.snapshot("alice")).provider, "anthropic");
  assert.deepEqual(await accounts.prepareExecution("alice"), { agentId: "nl-alice", model: "anthropic/test" });
  claudeActive = false;
  await assert.rejects(accounts.prepareRun("alice"), /Connect or resume/);
  assert.deepEqual(await accounts.prepareExecution("alice", "openai/test"), { agentId: "nl-alice", model: "openai/test" });
});
test("dedicated Team Claude runs never consult a member's personal account", async () => {
  const owners = [];
  const accounts = new ModelAccounts({ openai: {}, team: { prepareRun: async () => "team-openai" },
    claude: { snapshot: async owner => { owners.push(owner); return { modelReady: true, agentId: "nl-teamneura" }; } },
  });
  assert.equal(await accounts.prepareTeamRun("anthropic/test"), "nl-teamneura");
  assert.deepEqual(owners, [{ workload: "team" }]);
  assert.equal(await accounts.prepareTeamRun("openai/test"), "team-openai");
});


test("slow access discovery survives caller retries without repeating provider work", async () => {
  const accounts = new ModelAccounts({ openai: {}, claude: {} });
  const pending = new Map();
  let calls = 0;
  accounts.snapshotOnce = userId => { calls++; return new Promise((resolve, reject) => pending.set(userId, { resolve, reject })); };
  const first = accounts.snapshot("alice");
  const retry = accounts.snapshot("alice");
  assert.equal(first, retry);
  const other = accounts.snapshot("bob");
  assert.notEqual(first, other);
  assert.equal(calls, 2);
  pending.get("alice").resolve({ agentId: "nl-alice", authenticated: false });
  assert.deepEqual(await first, { agentId: "nl-alice", authenticated: false });
  assert.equal(accounts.snapshot("alice"), first);
  accounts.accessSnapshots.get("alice").expiresAt = Date.now() - 1;
  assert.notEqual(accounts.snapshot("alice"), first);
  pending.get("bob").reject(new Error("temporary failure"));
  await assert.rejects(other, /temporary failure/);
  const secondBob = accounts.snapshot("bob");
  assert.notEqual(secondBob, other);
  pending.get("bob").resolve({ agentId: "nl-bob" });
  pending.get("alice").resolve({ agentId: "nl-alice" });
  await secondBob;
});
