import assert from "node:assert/strict";
import test from "node:test";
import { TeamOpenAI } from "./team-openai.mjs";

test("team access depends on its dedicated credential, not the summoner's account", async () => {
  const account = { agentId: "nl-teamneura", profileId: "openai:nl-teamneura", authenticated: false, modelReady: false };
  const owners = [];
  const manager = {
    account: (owner) => { owners.push(owner); return account; },
    ensureProvisioned: async (owner) => { owners.push(owner); },
    refresh: async (candidate) => { assert.equal(candidate, account); },
  };
  const team = new TeamOpenAI(manager);
  await assert.rejects(team.prepareRun(), /administrator must connect/);
  account.authenticated = true; account.modelReady = true;
  assert.equal(await team.prepareRun(), "nl-teamneura");
  assert.equal(owners.every((owner) => owner === "team-neura"), true);
});
