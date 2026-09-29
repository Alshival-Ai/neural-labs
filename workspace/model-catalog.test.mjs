import assert from "node:assert/strict";
import test from "node:test";
import { ModelCatalog, publicModelCatalog, modelCredentialSource, claudeModelCatalog } from "./model-catalog.mjs";

const payload = { models: [{ id: "new-model", provider: "openai", name: "New model", available: true, supportsTools: true, thinkingLevels: [{ id: "xhigh", label: "Extra high" }], apiKey: "must-not-leak" }] };
test("first Team catalog requests coalesce and wait for the dedicated agent without logging in", async () => {
  let ready = false;
  let provisions = 0;
  let requests = 0;
  let release;
  const provisioned = new Promise((resolve) => { release = resolve; });
  const catalog = new ModelCatalog({
    teamOpenAI: { agentId: "nl-teamneura", ensureProvisioned: async () => { provisions++; await provisioned; ready = true; }, start: () => { throw new Error("Must not start OAuth"); } },
    gatewayRequest: async (method, args) => {
      assert.equal(ready, true);
      if (method === "models.list") { assert.equal(args.agentId, "nl-teamneura"); requests++; }
      return payload;
    },
  });
  const first = catalog.list({ agentId: "nl-teamneura" });
  const second = catalog.list({ agentId: "nl-teamneura" });
  assert.equal(requests, 0);
  release();
  await Promise.all([first, second]);
  assert.equal(provisions, 1);
  assert.equal(requests, 1);
});

test("failed Team provisioning never queries an unknown agent and can be retried", async () => {
  let fail = true;
  let requests = 0;
  const catalog = new ModelCatalog({
    teamOpenAI: { agentId: "nl-teamneura", ensureProvisioned: async () => { if (fail) throw new Error("private failure"); } },
    gatewayRequest: async () => { requests++; return payload; },
  });
  await assert.rejects(catalog.list({ agentId: "nl-teamneura" }), /catalog is unavailable/);
  assert.equal(requests, 0);
  fail = false;
  assert.equal((await catalog.list({ agentId: "nl-teamneura" })).models.length, 1);
});
test("workspace status distinguishes environment keys from ChatGPT sign-in", () => {
  assert.equal(modelCredentialSource({ profiles: [] }, { auth: { providers: [{ provider: "openai", effective: { kind: "env" } }] } }), "environment-api-key");
  assert.equal(modelCredentialSource({ profiles: [{ provider: "openai", type: "oauth" }] }, {}), "chatgpt");
});

test("explicit refresh waits past a pending prepared read and returns the new catalog", async () => {
  let release;
  const requests = [];
  const catalog = new ModelCatalog({ runtime: { name: "Codex", version: "0.152.0" }, gatewayRequest: async (method, params) => {
    if (method !== "models.list") return {};
    requests.push(params);
    if (params.preparedOnly) await new Promise((resolve) => { release = resolve; });
    return { models: [{ id: params.refresh ? "gpt-6-astra" : "gpt-5.6-sol", provider: "openai", available: true }] };
  } });
  const initial = catalog.list();
  const refreshed = catalog.list({ refresh: true });
  release(); await initial;
  const result = await refreshed;
  assert.equal(requests.length, 2);
  assert.equal(requests[1].refresh, true);
  assert.equal(result.models[0].id, "openai/gpt-6-astra");
  assert.deepEqual(result.runtime, { name: "Codex", version: "0.152.0" });
});
test("catalog exposes runtime capabilities without credentials or guessed effort levels", () => {
  const [row] = publicModelCatalog(payload);
  assert.equal(row.id, "openai/new-model");
  assert.deepEqual(row.efforts, [{ id: "xhigh", label: "Extra high" }]);
  assert.equal(JSON.stringify(row).includes("must-not-leak"), false);
  assert.equal(publicModelCatalog({ models: [{ id: "unknown", provider: "p" }] })[0].available, false);
});
test("native legacy catalog rows remain tool-enabled unless explicitly opted out", () => {
  const rows = publicModelCatalog({ models: [
    { id: "gpt-6-astra", provider: "openai", available: true },
    { id: "no-tools", provider: "openai", available: true, supportsTools: false },
    { id: "unknown-auth", provider: "openai" },
  ] });
  assert.equal(rows[0].supportsTools, true);
  assert.equal(rows[1].supportsTools, false);
  assert.equal(rows[2].available, false);
});
test("catalog coalesces refreshes and retains a stale last-good result", async () => {
  let calls = 0;
  let fail = false;
  const catalog = new ModelCatalog({ gatewayRequest: async (method) => { if (method === "models.list") calls++; if (fail) throw new Error("secret"); return payload; } });
  await Promise.all([catalog.list(), catalog.list()]);
  assert.equal(calls, 1);
  fail = true;
  const stale = await catalog.list({ refresh: true });
  assert.equal(stale.stale, true);
  assert.equal(stale.models.length, 1);
  assert.equal(JSON.stringify(stale).includes("secret"), false);
});
test("personal catalogs bind the owner and do not offer inherited workspace credentials", async () => {
  let params;
  const catalog = new ModelCatalog({
    gatewayRequest: async (method, value) => { if (method === "models.list") params = value; return payload; },
    personalOpenAI: { ensureProvisioned: async () => ({ agentId: "nl-owner" }), snapshot: async () => ({ authenticated: false, paused: true }) },
  });
  const result = await catalog.list({ userId: "owner", agentId: "main" });
  assert.equal(params.agentId, "nl-owner");
  assert.equal(result.models[0].available, false);
});

test("admin catalog caches cannot bypass personal connection filtering", async () => {
  const catalog = new ModelCatalog({ gatewayRequest: async () => payload, personalOpenAI: {
    ensureProvisioned: async () => ({ agentId: "nl-owner" }), snapshot: async () => ({ authenticated: false, paused: true }),
  } });
  assert.equal((await catalog.list({ agentId: "nl-owner" })).models[0].available, true);
  assert.equal((await catalog.list({ userId: "owner" })).models[0].available, false);
});

test("Claude availability is bound to the requested owner and never borrows background status", async () => {
  const owners = [];
  const catalog = new ModelCatalog({
    gatewayRequest: async () => ({ models: [
      { id: "claude-test", provider: "anthropic", available: false, unavailableReason: "missing-auth", supportsTools: true },
      { id: "denied-test", provider: "anthropic", available: false, unavailableReason: "auth-failed", supportsTools: true },
    ] }),
    personalOpenAI: { ensureProvisioned: async id => ({ agentId: `nl-${id}` }), snapshot: async () => ({ authenticated: false, paused: true }) },
    claudeAccounts: { snapshot: async owner => { owners.push(owner); return { modelReady: owner.userId === "alice" }; } },
  });
  assert.equal((await catalog.list({ userId: "alice" })).models[0].available, true);
  assert.equal((await catalog.list({ userId: "alice" })).models[1].available, false);
  assert.equal((await catalog.list({ userId: "bob" })).models[0].available, false);
  await catalog.list({ agentId: "other-agent" });
  assert.deepEqual(owners, [{ userId: "alice" }, { userId: "bob" }]);
});

test("Claude defaults appear without a session catalog but require the matching owner's connection", async () => {
  const catalog = new ModelCatalog({
    gatewayRequest: async (method, args) => method === "models.list" ? {
      models: args.provider === "anthropic" && args.view === "all"
        ? [{ id: "claude-test", provider: "anthropic", available: false, unavailableReason: "missing-auth" }]
        : payload.models,
    } : {},
    personalOpenAI: { ensureProvisioned: async id => ({ agentId: `nl-${id}` }), snapshot: async () => ({ authenticated: false }) },
    claudeAccounts: { snapshot: async ({ userId }) => ({ modelReady: userId === "alice" }) },
  });
  const alice = await catalog.list({ userId: "alice" });
  const bob = await catalog.list({ userId: "bob" });
  assert.equal(alice.models.find(row => row.provider === "anthropic").available, true);
  assert.equal(bob.models.find(row => row.provider === "anthropic").available, false);
});

test("a fresh Claude owner initializes discovery when no prepared catalog exists", async () => {
  const calls = [];
  const result = await claudeModelCatalog(async (method, args) => {
    calls.push(args);
    assert.equal(method, "models.list");
    assert.equal(args.agentId, "nl-new");
    return { models: args.preparedOnly ? [] : [{ id: "claude-test", provider: "anthropic" }] };
  }, "nl-new");
  assert.equal(result.models.length, 1);
  assert.equal(calls[0].preparedOnly, true);
  assert.equal(calls[1].refresh, true);
  assert.equal(calls[1].preparedOnly, undefined);
});

test("pending Claude discovery completes without repeatedly restarting its generation", async () => {
  let clock = 0, refreshes = 0, calls = 0;
  const result = await claudeModelCatalog(async (_method, args) => {
    calls++; if (args.refresh) refreshes++;
    return calls < 4 ? { models: [], pendingProviders: ["anthropic"] }
      : { models: [{ provider: "anthropic", id: "claude-test" }] };
  }, "nl-new", { now: () => clock, wait: async ms => { clock += ms; } });
  assert.equal(result.models.length, 1);
  assert.equal(refreshes, 1);
  const unavailable = await claudeModelCatalog(async () => ({ models: [], pendingProviders: ["anthropic"] }),
    "nl-new", { now: () => clock, wait: async ms => { clock += ms; } });
  assert.deepEqual(unavailable.models, []);
  assert.equal(clock, 31_000);
});

test("inventory alone refreshes native runtime readiness before explicit model selection", async () => {
  const calls = [];
  const result = await claudeModelCatalog(async (_method, args) => {
    calls.push(args);
    return { models: [{ id: "claude-test", provider: "anthropic", available: !!args.refresh,
      agentRuntime: { id: "neural-labs-claude" } }] };
  }, "nl-alice");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].refresh, true);
  assert.equal(result.models[0].available, true);
  const reused = await claudeModelCatalog(async (_method, args) => {
    assert.equal(args.preparedOnly, true);
    return result;
  }, "nl-alice");
  assert.equal(reused, result);
});

test("Claude-only catalogs do not inspect an unused OpenAI connection", async () => {
  let checks = 0;
  const catalog = new ModelCatalog({
    personalOpenAI: { ensureProvisioned: async () => ({ agentId: "nl-alice" }),
      snapshot: async () => { checks++; throw new Error("Unused OpenAI status must not be requested"); } },
    claudeAccounts: { snapshot: async () => ({ modelReady: true }) },
    gatewayRequest: async (method, args) => method === "models.list"
      ? { models: args.provider === "anthropic" ? [{ id: "claude-test", provider: "anthropic", unavailableReason: "missing-auth" }] : [] }
      : { agents: [{ id: "nl-alice", model: { primary: "anthropic/claude-test" } }] },
  });
  const result = await catalog.list({ userId: "alice" });
  assert.equal(checks, 0);
  assert.equal(result.models.length, 1);
  assert.equal(result.models[0].available, true);
  assert.equal(result.defaultModel, "anthropic/claude-test");
});

test("an OpenAI status failure cannot hide a ready Claude model", async () => {
  const catalog = new ModelCatalog({
    personalOpenAI: { ensureProvisioned: async () => ({ agentId: "nl-alice" }), snapshot: async () => { throw Error("unavailable"); } },
    claudeAccounts: { snapshot: async () => ({ modelReady: true }) },
    gatewayRequest: async (method, args) => method === "models.list"
      ? args.provider === "anthropic" ? { models: [{ id: "claude-test", provider: "anthropic", unavailableReason: "missing-auth" }] } : payload : {},
  });
  const result = await catalog.list({ userId: "alice" });
  assert.equal(result.models.find(m => m.provider === "openai").available, false);
  assert.equal(result.models.find(m => m.provider === "anthropic").available, true);
});

test("skipping unused OpenAI status does not expose workspace-only provider credentials", async () => {
  const catalog = new ModelCatalog({
    gatewayRequest: async () => ({ models: [{ id: "shared", provider: "other", available: true }] }),
    personalOpenAI: { ensureProvisioned: async () => ({ agentId: "nl-alice" }),
      snapshot: async () => { throw new Error("No personal OpenAI models need a status check"); } },
  });
  assert.deepEqual((await catalog.list({ userId: "alice" })).models, []);
});
