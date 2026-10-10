import test from "node:test";
import assert from "node:assert/strict";
import { nativeModelCatalog, readCodexModels, readOpenAIModels } from "./native/models.mjs";
import { CODEX_PROTOCOL_VERSION } from "./native/codex.mjs";

test("Codex catalog paginates under the selected lease, starts no turns, and always releases its process", async () => {
  let closed = false, checks = 0; const calls = [];
  const rpc = { request: async (method, params) => {
    calls.push(method); if (method === "initialize") return {};
    return { data: [{ id: params.cursor || "first" }], nextCursor: params.cursor ? null : "second" };
  }, send: () => {}, close: async () => { closed = true; } };
  const grant = { binding: { method: "subscription" }, launch: { spawn() {} }, revalidate: async () => { checks++; } };
  assert.equal((await readCodexModels(grant, {}, () => rpc)).length, 2);
  assert.deepEqual(calls, ["initialize", "model/list", "model/list"]);
  assert.equal(checks, 2); assert.equal(closed, true);
  closed = false; grant.revalidate = async () => { throw new Error("revoked"); };
  await assert.rejects(readCodexModels(grant, {}, () => rpc), /revoked/); assert.equal(closed, true);
});
test("native catalogs project model identities and effort levels without exposing account metadata", async () => {
  const grant = { connection: "selected", binding: { provider: "codex", method: "subscription" }, home: "/home/node", credentialHome: "/home/node/.codex",
    launch: { exec: async () => ({ stdout: `codex-cli ${CODEX_PROTOCOL_VERSION}` }) }, revalidate: async () => {} };
  const catalog = await nativeModelCatalog(grant, { ready: true, readers: { codex: async () => [{ id: "display-id", model: "model-exact", displayName: "Fixture", isDefault: true,
    supportedReasoningEfforts: [{ reasoningEffort: "high" }], defaultReasoningEffort: "high", account: { secret: "not-for-browser" } }] } });
  assert.equal(catalog.defaultModel, "model-exact"); assert.equal(catalog.models[0].available, true);
  assert.deepEqual(catalog.models[0].efforts, [{ id: "high", label: "high" }]);
  assert.ok(!JSON.stringify(catalog).includes("not-for-browser"));
  grant.launch.exec = async () => ({ stdout: "2.1.226 (Claude Code)" }); grant.binding.provider = "claude"; grant.credentialHome = "/home/node/.claude";
  const claude = await nativeModelCatalog(grant, { ready: false, readers: { claude: async () => [
    { value: "default", resolvedModel: "exact-claude", supportedEffortLevels: ["low", "high"] }, { value: "alias", resolvedModel: "exact-claude" },
  ] } });
  assert.equal(claude.models.length, 1); assert.equal(claude.defaultModel, "exact-claude");
  assert.equal(claude.models[0].available, false);
});

test("API inventory is owner-bound, filters non-agent models, and revalidates after retrieval", async () => {
  let checks = 0;
  const grant = { apiKey: "fixture-only", revalidate: async () => { checks++; } };
  const rows = await readOpenAIModels(grant, async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/models");
    assert.equal(options.headers.Authorization, "Bearer fixture-only");
    assert.equal(options.redirect, "error");
    return Response.json({ data: ["gpt-6.1-sol", "gpt-6-astra", "gpt-5.4-mini", "gpt-image-2", "gpt-realtime", "text-embedding-3-small", "codex-auto-review", "gpt-daybreak-blue-latest"].map(id => ({ id })) });
  });
  assert.deepEqual(rows.map(row => row.model), ["gpt-6.1-sol", "gpt-6-astra", "gpt-5.4-mini"]);
  assert.equal(checks, 2);
  grant.revalidate = async () => { throw new Error("revoked"); };
  await assert.rejects(readOpenAIModels(grant, () => { throw new Error("must not fetch"); }), /revoked/);
});
test("API catalogs add new available models, preserve known efforts and remove unavailable models", async () => {
  const grant = { connection: "api-selected", binding: { provider: "codex", method: "api-key" }, apiKey: "fixture-only", home: "/tmp/home", credentialHome: "/tmp/home/.codex",
    launch: { exec: async () => ({ stdout: `codex-cli ${CODEX_PROTOCOL_VERSION}` }) }, revalidate: async () => {} };
  const catalog = await nativeModelCatalog(grant, { ready: true, readers: {
    codex: async () => [{ model: "gpt-6-astra", supportedReasoningEfforts: [{reasoningEffort: "high"}] }, {model: "gpt-5.5", isDefault: true}],
    openai: async () => [{ model: "gpt-6-astra" }, {model: "gpt-6.1-sol", inputModalities: ["text"]}],
  } });
  assert.deepEqual(catalog.models.map(row => row.id), ["gpt-6-astra", "gpt-6.1-sol"]);
  assert.deepEqual(catalog.models[0].efforts, [{id: "high", label: "high"}]);
  assert.deepEqual(catalog.models[1].efforts, []);
  assert.equal(catalog.defaultModel, null);
});
