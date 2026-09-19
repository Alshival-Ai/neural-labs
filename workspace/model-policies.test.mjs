import assert from "node:assert/strict";
import test from "node:test";
import { resolveModelPolicy, ModelPolicies } from "./model-policies.mjs";

const model = (id, efforts = ["high"]) => ({ id: `openai/${id}`, provider: "openai", available: true, supportsTools: true, efforts: efforts.map((id) => ({ id, label: id })), defaultEffort: "high" });
const catalog = { models: [model("gpt-5.6-sol", ["high", "ultra"]), model("gpt-6-astra")], fetchedAt: "2026-09-05T00:00:00Z", stale: false };
const policy = { mode: "latest", provider: "openai", effort: "" };
test("latest resolves an available recommendation and retains an incompatible explicit effort", () => {
  assert.equal(resolveModelPolicy(policy, catalog).model, "openai/gpt-6-astra");
  const held = resolveModelPolicy({ ...policy, effort: "ultra" }, catalog, { model: "openai/gpt-5.6-sol" });
  assert.equal(held.model, "openai/gpt-5.6-sol");
  assert.equal(held.held, true);
});
test("pins are strict and stale catalogs cannot change defaults", () => {
  assert.throws(() => resolveModelPolicy({ ...policy, mode: "pinned", model: "anthropic/claude" }, catalog));
  assert.throws(() => resolveModelPolicy(policy, { ...catalog, stale: true }));
  assert.throws(() => resolveModelPolicy({ ...policy, effort: "off" }, catalog));
});
test("atomic native defaults preserve unrelated settings and reject older revisions", async () => {
  const calls = [];
  const manager = new ModelPolicies({
    catalog: { list: async () => catalog },
    personalOpenAI: {
      ensureProvisioned: async () => ({ agentId: "nl-owner" }),
      queueMutation: async (fn) => fn(),
      execute: async (...args) => { calls.push(args); },
    },
  });
  await manager.apply({ userId: "owner", policy, revision: 2 });
  assert.match(calls[0][1][0], /native-config-batch\.mjs$/u);
  const operations = JSON.parse(calls[0][1][1]);
  assert.deepEqual(operations.map((op) => op.path), ["agents.entries.nl-owner.model", "agents.entries.nl-owner.thinkingDefault"]);
  assert.deepEqual(operations[0].value.fallbacks, []);
  await assert.rejects(manager.apply({ userId: "owner", policy, revision: 1 }), /newer/);
});

test("automatic reasoning works when the delegated runtime omits reasoning metadata", async () => {
  const native = { ...model("gpt-5.6-sol", []), defaultEffort: null };
  const nativeCatalog = { ...catalog, models: [native, { ...model("gpt-6-astra"), available: false }] };
  const resolved = resolveModelPolicy(policy, nativeCatalog);
  assert.equal(resolved.model, "openai/gpt-5.6-sol");
  assert.equal(resolved.effort, "");
  assert.throws(() => resolveModelPolicy({ ...policy, effort: "high" }, nativeCatalog));
  const calls = [];
  const manager = new ModelPolicies({
    catalog: { list: async () => nativeCatalog },
    personalOpenAI: {
      ensureProvisioned: async () => ({ agentId: "nl-owner" }),
      queueMutation: async fn => fn(),
      execute: async (...args) => calls.push(args),
    },
  });
  await manager.apply({ userId: "owner", policy, revision: 1 });
  assert.deepEqual(JSON.parse(calls[0][1][1]), [{ path: "agents.entries.nl-owner.model", value: { primary: native.id, fallbacks: [] } }]);
});

test("Claude policies require an active Claude owner and select its native runtime atomically", async () => {
  const operations = [];
  const row = { id: "anthropic/claude-test", provider: "anthropic", available: true, supportsTools: true, efforts: [{ id: "high" }], defaultEffort: "high" };
  const manager = { ensureProvisioned: async () => ({ agentId: "nl-alice" }), queueMutation: fn => fn(), execute: async (_command, args) => operations.push(JSON.parse(args[1])) };
  const { ModelPolicies } = await import("./model-policies.mjs");
  const policies = new ModelPolicies({ personalOpenAI: manager, claudeAccounts: { snapshot: async () => ({ modelReady: true }) }, catalog: { list: async () => ({ models: [row], fetchedAt: "test", stale: false }) } });
  await policies.apply({ userId: "alice", revision: 1, policy: { provider: "anthropic", mode: "pinned", model: row.id, effort: "high" } });
  assert.equal(operations[0][0].value.id, "neural-labs-claude");
  assert.deepEqual(operations[0][1].value, { primary: row.id, fallbacks: [] });
  assert.equal(operations[0][2].value, "high");
  policies.claudeAccounts.snapshot = async () => ({ modelReady: false });
  await assert.rejects(policies.apply({ userId: "alice", revision: 2, policy: { provider: "anthropic", mode: "pinned", model: row.id, effort: "high" } }));
});
