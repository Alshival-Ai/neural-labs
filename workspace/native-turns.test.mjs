import assert from "node:assert/strict";
import test from "node:test";
import { NativeState } from "./native/state.mjs";
import { NativeTurns } from "./native/turns.mjs";

function fixture(t, provider) {
  const state = new NativeState(":memory:"); t.after(() => state.close());
  const members = new Set(["member-1", "member-2"]);
  const grants = new Map();
  const resolveExecution = async ({ actor, selection }) => {
    if (!members.has(actor)) throw new Error("Membership revoked");
    const selected = selection || { owner: actor, provider: "codex" };
    if (selected.owner !== actor && selected.owner !== "shared") throw new Error("Account owner mismatch");
    const grant = { actor, model: "fixture", background: false, cwd: "/workspace", home: "/fixture/home", credentialHome: "/fixture/credentials",
      binding: { owner: selected.owner, provider: selected.provider, generation: 1, method: "subscription" },
      policy: { sandbox: "workspace-write", approval: "on-request" },
      launch: { spawn: () => assert.fail("fixture does not spawn"), exec: () => assert.fail("fixture does not execute") },
      revalidate: async () => { if (!members.has(actor)) throw new Error("Membership revoked"); } };
    grants.set(actor, grant); return grant;
  };
  const turns = new NativeTurns({ state, resolveExecution, providers: { codex: provider, claude: provider } });
  turns.gated = false;
  return { turns, state, members, grants };
}
const input = [{ type: "text", text: "Fixture prompt" }];
async function settle(turns, id) { return await turns.active.get(id)?.done; }

test("runtime reconnect replays persisted events without restarting native inference", async t => {
  let calls = 0;
  const { turns, state } = fixture(t, async context => {
    calls++; await context.onSession("native-thread-1"); await context.onEvent("output", { text: "reply" });
    return { status: "succeeded" };
  });
  const conversation = (await turns.create("member-1")).id;
  const request = { conversation, requestId: "request-1", input };
  const first = await turns.start("member-1", undefined, request);
  await settle(turns, first.id);
  const replay = await turns.start("member-1", undefined, request);
  assert.equal(replay.accepted, false); assert.equal(calls, 1);
  const events = await turns.events("member-1", undefined, conversation);
  assert.deepEqual(events.map(row => row.type), ["turn-started", "output", "turn-completed"]);
  assert.equal(state.db.prepare("SELECT native_session FROM conversations").get().native_session, "native-thread-1");
  await assert.rejects(turns.events("member-2", undefined, conversation), /binding/);
});

test("runtime has no product-wide concurrency cap and admission drains existing work", async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let started = 0;
  const { turns } = fixture(t, async () => { started++; await gate; return { status: "succeeded" }; });
  const requests = await Promise.all(Array.from({ length: 4 }, async (_, index) => {
    const selection = { owner: "member-1", provider: index % 2 ? "claude" : "codex" };
    const conversation = (await turns.create("member-1", selection)).id;
    return turns.start("member-1", selection, { conversation, requestId: `request-${index}`, input });
  }));
  assert.equal(started, 4); assert.equal(turns.active.size, 4);
  const draining = turns.drain();
  await assert.rejects(turns.create("member-1"), /admission/);
  release(); await draining;
  assert.equal(turns.active.size, 0); assert.equal(requests.length, 4);
});

test("shared connections require explicit selection and retain the initiating actor", async t => {
  const { turns, state } = fixture(t, async () => ({ status: "succeeded" }));
  const personal = await turns.create("member-1");
  const shared = await turns.create("member-1", { owner: "shared", provider: "claude" });
  const rows = state.db.prepare("SELECT * FROM conversations").all();
  assert.equal(JSON.parse(rows.find(row => row.id === personal.id).binding).owner, "member-1");
  assert.equal(JSON.parse(rows.find(row => row.id === shared.id).binding).owner, "shared");
  assert.equal(rows.find(row => row.id === shared.id).actor, "member-1");
  await assert.rejects(turns.start("member-1", undefined, { conversation: shared.id, requestId: "request", input }), /binding/);
});

test("runtime rejects an authorizer that lacks credential filesystem isolation", async t => {
  const state = new NativeState(":memory:"); t.after(() => state.close());
  const turns = new NativeTurns({ state, resolveExecution: async () => ({ actor: "member", model: "fixture", background: false,
    binding: { provider: "codex" }, revalidate: async () => {} }) });
  turns.gated = false;
  await assert.rejects(turns.create("member"), /filesystem isolation/);
});

test("revoked members cannot read durable events or approve another turn", async t => {
  let approval;
  const { turns, members } = fixture(t, async context => {
    const answer = await context.approve({ id: "provider-request", method: "tool/permission", params: { command: "pwd" } });
    return { status: answer?.decision === "accept" ? "succeeded" : "cancelled" };
  });
  turns.on("event", ({ conversation }) => {
    const rows = turns.state.db.prepare("SELECT payload FROM events WHERE type='approval-required'").all();
    if (rows.length) approval = JSON.parse(rows[0].payload).id;
  });
  const conversation = (await turns.create("member-1")).id;
  const started = await turns.start("member-1", undefined, { conversation, requestId: "request", input });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(approval);
  await assert.rejects(turns.approve("member-2", undefined, approval, { decision: "accept" }), /unavailable/);
  members.delete("member-1");
  await assert.rejects(turns.events("member-1", undefined, conversation), /revoked/);
  await assert.rejects(turns.approve("member-1", undefined, approval, { decision: "accept" }), /revoked/);
  // Fixture settles its stub provider. Real adapters also race approvals with
  // their abort signal and check revocation on each heartbeat.
  turns.approvals.get(approval).resolve(null);
  await settle(turns, started.id);
});
