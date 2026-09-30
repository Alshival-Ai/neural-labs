import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { CODEX_PROTOCOL_VERSION, providerEnvironment, runCodexTurn } from "./native/codex.mjs";

class FakeRpc extends EventEmitter {
  constructor(onStart) { super(); this.calls = []; this.sent = []; this.onStart = onStart; }
  async request(method, params) {
    this.calls.push({ method, params });
    if (method === "initialize") return { userAgent: "fixture" };
    if (method === "thread/start" || method === "thread/resume") return { thread: { id: params.threadId || "thread-1" } };
    if (method === "turn/start") {
      setImmediate(() => this.onStart(this));
      return { turn: { id: "turn-1" } };
    }
    return {};
  }
  send(value) { this.sent.push(value); this.emit("response", value); }
  async close() { this.closed = true; }
  event(method, params = {}) { this.emit("message", { method, params: { threadId: "thread-1", turnId: "turn-1", ...params } }); }
  complete(status = "completed") { this.event("turn/completed", { turn: { id: "turn-1", status } }); }
  approval() { this.emit("message", { id: 5, method: "item/commandExecution/requestApproval", params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", command: "pwd" } }); }
}
function context(rpc, overrides = {}) {
  return { cwd: "/workspace", env: { HOME: "/home/fixture", CODEX_HOME: "/home/fixture/.codex" },
    model: "fixture-model", input: [{ type: "text", text: "fixture request" }],
    revalidate: async () => {}, onSession: async () => {}, onEvent: async () => {},
    executeVersion: async () => ({ stdout: `codex-cli ${CODEX_PROTOCOL_VERSION}\n` }), createRpc: () => rpc,
    ...overrides };
}

test("Codex handshake persists the native session before execution and forwards owned events", async () => {
  const events = [], order = [];
  const rpc = new FakeRpc(rpc => { rpc.event("item/agentMessage/delta", { delta: "hello" }); rpc.complete(); });
  const original = rpc.request.bind(rpc);
  rpc.request = async (method, params) => { order.push(method); return original(method, params); };
  const result = await runCodexTurn(context(rpc, { onSession: async id => { assert.equal(id, "thread-1"); order.push("persist-session"); }, onEvent: async (kind, value) => events.push({ kind, value }) }));
  assert.deepEqual(result, { status: "succeeded", nativeSession: "thread-1" });
  assert.deepEqual(order.slice(0, 4), ["initialize", "thread/start", "persist-session", "turn/start"]);
  assert.deepEqual(rpc.sent[0], { method: "initialized" });
  assert.equal(rpc.calls[1].params.modelProvider, "openai");
  assert.equal(events[0].kind, "output");
  assert.equal(events[0].value.delta, "hello");
  assert.equal(rpc.closed, true);
});

test("resume retains the native session and rejects events for another session", async () => {
  const events = [];
  const rpc = new FakeRpc(rpc => {
    rpc.event("item/agentMessage/delta", { threadId: "someone-else", delta: "private" });
    rpc.complete();
  });
  await runCodexTurn(context(rpc, { nativeSession: "thread-1", onEvent: async (...args) => events.push(args) }));
  assert.equal(rpc.calls[1].method, "thread/resume");
  assert.equal(events.length, 0);
});
test("Codex receives explicit native skill inputs and the selected reasoning effort", async () => {
  const rpc = new FakeRpc(rpc => rpc.complete());
  const input = [{ type: "text", text: "$fixture inspect" }, { type: "skill", name: "fixture", path: "/opt/neural-labs/skills/fixture/SKILL.md" }];
  assert.equal((await runCodexTurn(context(rpc, { input, effort: "high" }))).status, "succeeded");
  const request = rpc.calls.find(row => row.method === "turn/start").params;
  assert.deepEqual(request.input, input); assert.equal(request.effort, "high");
  await assert.rejects(runCodexTurn(context(null, { input: [{ ...input[1], path: "/other-owner/SKILL.md" }] })), /input/);
});

test("approval is a scoped server request and lease is checked again after user input", async () => {
  let leased = true;
  const rpc = new FakeRpc(rpc => rpc.approval());
  const result = await runCodexTurn(context(rpc, {
    revalidate: async () => { if (!leased) throw new Error("membership removed"); },
    approve: async request => { assert.equal(request.id, "5"); leased = false; return { decision: "accept" }; },
  }));
  assert.equal(result.status, "unknown");
  assert.ok(!rpc.sent.some(row => row.id === 5));
  assert.ok(rpc.calls.some(row => row.method === "turn/interrupt"));
});

test("interactive approvals cannot silently grant session-wide or policy amendments", async () => {
  const rpc = new FakeRpc(rpc => rpc.approval());
  const result = await runCodexTurn(context(rpc, { approve: async () => ({ decision: "acceptForSession" }) }));
  assert.equal(result.code, "approval-or-lease-failed");
  assert.ok(!rpc.sent.some(row => row.id === 5));
});

test("scheduled approvals produce visible blocked outcomes without permission expansion", async () => {
  const events = [];
  const rpc = new FakeRpc(rpc => rpc.approval());
  const result = await runCodexTurn(context(rpc, { background: true, onEvent: async (kind, value) => events.push({ kind, value }),
    approve: async () => assert.fail("background cannot invoke interactive approval") }));
  assert.equal(result.status, "blocked");
  assert.equal(events[0].kind, "blocked");
  assert.ok(!rpc.sent.some(row => row.id === 5));
});

test("cancellation releases a provider even while an approval is unanswered", async () => {
  const abort = new AbortController();
  const rpc = new FakeRpc(rpc => { rpc.approval(); setImmediate(() => abort.abort()); });
  const result = await runCodexTurn(context(rpc, { signal: abort.signal, approve: () => new Promise(() => {}) }));
  assert.equal(result.status, "cancelled");
  assert.equal(rpc.closed, true);
});

test("lease heartbeat stops a silent turn after revocation", async () => {
  let leased = true;
  const rpc = new FakeRpc(() => { leased = false; });
  const result = await runCodexTurn(context(rpc, { leaseCheckMs: 5, timeoutMs: 500,
    revalidate: async () => { if (!leased) throw new Error("revoked"); } }));
  assert.equal(result.code, "execution-lease-revoked");
  assert.equal(rpc.closed, true);
});

test("app-server pin mismatches fail before any provider process is started", async () => {
  await assert.rejects(runCodexTurn(context(null, { executeVersion: async () => ({ stdout: "codex-cli 0.0.1" }), createRpc: () => assert.fail("must not start") })), /pin/);
});

test("cancellation during the version probe never launches a native turn", async () => {
  const abort = new AbortController();
  const result = await runCodexTurn(context(null, { signal: abort.signal,
    executeVersion: async () => { abort.abort(); return { stdout: `codex-cli ${CODEX_PROTOCOL_VERSION}` }; },
    createRpc: () => assert.fail("cancelled turn must not spawn") }));
  assert.equal(result.status, "cancelled");
});

test("provider environments include only the selected credential and no ambient connectors", () => {
  const fields = { provider: "codex", home: "/home/fixture", credentialHome: "/home/fixture/codex", method: "subscription" };
  const env = providerEnvironment(fields);
  assert.deepEqual(Object.keys(env).sort(), ["CODEX_HOME", "HOME", "LANG", "NO_COLOR", "PATH"]);
  assert.equal(env.CODEX_HOME, fields.credentialHome);
  assert.throws(() => providerEnvironment({ ...fields, method: "api-key" }), /unavailable/);
  assert.throws(() => providerEnvironment({ ...fields, apiKey: "fixture-not-a-real-key" }), /inherit/);
  const claude = providerEnvironment({ ...fields, provider: "claude", method: "api-key", apiKey: "fixture-not-a-real-key" });
  assert.equal(claude.ANTHROPIC_API_KEY, "fixture-not-a-real-key");
  assert.equal(claude.OPENAI_API_KEY, undefined);
});

test('deployment tool calls have time for the bounded build and readiness checks', async () => {
  const rpc = new FakeRpc(rpc => rpc.complete());
  const result = await runCodexTurn(context(rpc, { mcpConfig: { url: 'http://127.0.0.1:8792/mcp', http_headers: {} },
    createRpc: (_command, args) => { assert.ok(args.includes('mcp_servers.neural-labs.tool_timeout_sec=420')); return rpc; } }));
  assert.equal(result.status, 'succeeded');
});

test("Codex no-prompt mode retains workspace sandbox on new and resumed threads", async () => {
  for (const nativeSession of [undefined, "thread-1"]) {
    const rpc = new FakeRpc(rpc => rpc.complete()); let args;
    const result = await runCodexTurn(context(rpc, { nativeSession, policy: { sandbox: "workspace-write", approval: "never" },
      createRpc: (_command, supplied) => { args = supplied; return rpc; } }));
    assert.equal(result.status, "succeeded");
    assert.equal(rpc.calls[1].params.approvalPolicy, "never");
    assert.equal(rpc.calls[1].params.sandbox, "workspace-write");
    assert.ok(args.includes("sandbox_workspace_write.network_access=true"));
    assert.ok(!JSON.stringify(args).includes("danger-full-access"));
  }
});
