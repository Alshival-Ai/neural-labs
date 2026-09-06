import test from "node:test";
import assert from "node:assert/strict";
import { WorkspaceTerminalManager } from "./terminal-manager.mjs";

function fixture() {
  let now = 10000;
  let allowed = true;
  const shares = [];
  const gif = { id: "gif", title: "Celebration", url: "https://static.klipy.com/test.gif", preview: "https://static.klipy.com/tiny.gif", still: null };
  const manager = new WorkspaceTerminalManager({ workspaceRoot: "/tmp", now: () => now,
    teamChannelAuthorizer: async (_actor, id) => ({ allowed, channel: { id, name: "Team" } }),
    gifProvider: { configured: true, catalog: async () => ({ results: [gif], next: "next-page" }), share: async (...args) => shares.push(args) },
  });
  const actor = { id: "a", label: "Ada" };
  const received = [];
  const peerReceived = [];
  const connection = { actor, socket: { readyState: 1, bufferedAmount: 0, send: (raw) => received.push(JSON.parse(raw)) } };
  const peer = { actor: { id: "b", label: "Bea" }, socket: { readyState: 1, bufferedAmount: 0, send: (raw) => peerReceived.push(JSON.parse(raw)) } };
  const session = { id: "terminal", scope: "team", channelId: "channel", connections: new Map([["a", connection], ["b", peer]]) };
  manager.sessions.set(session.id, session);
  return { manager, actor, received, peerReceived, connection, peer, session, shares, advance: (ms) => { now += ms; }, revoke: () => { allowed = false; }, close: () => { manager.sessions.clear(); manager.shutdown(); } };
}

test("GIF selections are bound to actor and terminal, broadcast to participants, and never enter output replay", async () => {
  const f = fixture();
  try {
    const page = await f.manager.gifCatalog(f.actor, f.session.id, "yay");
    assert.equal(page.next, "next-page");
    const token = page.results[0].token;
    await f.manager.react(f.session, f.peer, { kind: "gif", token });
    assert.equal(f.peerReceived.pop().type, "reaction-error");
    await f.manager.react({ ...f.session, id: "different" }, f.connection, { kind: "gif", token });
    assert.equal(f.received.pop().type, "reaction-error");
    await f.manager.react(f.session, f.connection, { kind: "gif", token });
    assert.equal(f.received[0].kind, "gif");
    assert.equal(f.peerReceived[0].id, f.received[0].id);
    assert.equal(f.received[0].actor.label, "Ada");
    assert.equal(f.received[0].gif.token, undefined);
    assert.deepEqual(f.shares, [["gif", "yay"]]);
    assert.equal(f.session.sequence, undefined);
    await f.manager.react(f.session, { ...f.connection }, { kind: "gif", token });
    assert.match(f.received.at(-1).message, /wait a moment/);
    f.advance(600001);
    await f.manager.react(f.session, f.connection, { kind: "gif", token });
    assert.match(f.received.at(-1).message, /expired/);
    f.manager.cleanupTickets();
    assert.equal(f.manager.gifSelections.size, 0);
  } finally { f.close(); }
});

test("full Unicode emoji variants are validated and membership is checked before every send", async () => {
  const f = fixture();
  try {
    await f.manager.react(f.session, f.connection, { emoji: "👩🏽‍💻" });
    assert.equal(f.received.at(-1).emoji, "👩🏽‍💻");
    await f.manager.react(f.session, f.connection, { emoji: "😀" });
    assert.equal(f.received.at(-1).type, "reaction-error");
    f.advance(400);
    await f.manager.react(f.session, f.connection, { emoji: "😀" });
    assert.equal(f.received.at(-1).emoji, "😀");
    await f.manager.react(f.session, f.connection, { emoji: "echo secret" });
    assert.match(f.received.at(-1).message, /Choose an emoji/);
    await f.manager.react(f.session, f.connection, { kind: "gif", token: "forged", url: "https://attacker.example" });
    assert.equal(f.received.at(-1).type, "reaction-error");
    f.revoke(); f.advance(2000);
    await f.manager.react(f.session, f.connection, { emoji: "😀" });
    assert.match(f.received.at(-1).message, /no longer have access/);
    await assert.rejects(f.manager.gifCatalog(f.actor, f.session.id), { status: 404 });
  } finally { f.close(); }
});

test("catalog rejects personal terminals and invalid search; provider failure is scrubbed", async () => {
  const f = fixture();
  try {
    await assert.rejects(f.manager.gifCatalog(f.actor, "missing"), { status: 404 });
    await assert.rejects(f.manager.gifCatalog(f.actor, f.session.id, "x".repeat(161)), { status: 422 });
    f.manager.gifProvider.catalog = async () => { throw new Error("credential=placeholder"); };
    await assert.rejects(f.manager.gifCatalog(f.actor, f.session.id), (error) => error.status === 502 && !error.message.includes("placeholder"));
    f.manager.gifProvider.configured = false;
    await assert.rejects(f.manager.gifCatalog(f.actor, f.session.id), { status: 503 });
    f.session.scope = "personal";
    await assert.rejects(f.manager.gifCatalog(f.actor, f.session.id), { status: 404 });
  } finally { f.close(); }
});

test("a GIF search spanning a provider revision change cannot recreate selections", async () => {
  const f = fixture();
  try {
    const provider = f.manager.gifProvider;
    provider.revision = "first";
    const catalog = provider.catalog;
    provider.catalog = async (...args) => {
      const page = await catalog(...args);
      provider.revision = "second";
      return page;
    };
    await assert.rejects(f.manager.gifCatalog(f.actor, f.session.id), { status: 503, code: "gif_configuration_changed" });
    assert.equal(f.manager.gifSelections.size, 0);
  } finally { f.close(); }
});
