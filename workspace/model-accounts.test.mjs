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
