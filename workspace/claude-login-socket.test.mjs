import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { ClaudeAccounts } from "./claude-accounts.mjs";
import { attachClaudeLoginWebSocket, CLAUDE_LOGIN_SOCKET_PROTOCOL } from "./claude-login-socket.mjs";

const origin = "https://neural-labs.example.com";
async function fixture(t, heartbeatMs = 25_000) {
  const root = await mkdtemp(path.join(os.tmpdir(), "claude-socket-"));
  const actors = new Map(["alice", "bob", "admin", "otheradmin"].map(id => [id, { id, role: id.includes("admin") ? "admin" : "user" }]));
  const children = [], clients = [];
  const accounts = new ClaudeAccounts({ manager: { stateRoot: root, ensureProvisioned: async id => ({ agentId: `nl-${id}` }) },
    team: { agentId: "nl-teamneura", ensureProvisioned: async () => {} },
    spawnPty: () => {
      const child = { writes: [], sizes: [], onData(fn) { this.output = fn; }, onExit(fn) { this.exit = fn; }, write(data) { this.writes.push(data); }, resize(cols, rows) { this.sizes.push([cols, rows]); }, kill() { this.exit({ exitCode: 1 }); } };
      children.push(child); return child;
    }, execute: async () => { throw new Error("No native credentials in this test"); },
  });
  let now = 1000;
  const server = createServer((_req, res) => { res.writeHead(404); res.end(); });
  const transport = attachClaudeLoginWebSocket(server, { accounts, publicOrigin: origin, resolveActor: async id => actors.get(id), now: () => now, heartbeatMs });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    for (const socket of clients) socket.terminate();
    transport.close();
    for (const id of accounts.logins.keys()) await accounts.stop(id, null, false);
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const connect = (ticket, actorId = "alice", suppliedOrigin = origin) => {
    const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}${ticket.path}`, [CLAUDE_LOGIN_SOCKET_PROTOCOL, `ticket.${ticket.ticket}`], { headers: { Origin: suppliedOrigin, "X-Forwarded-User": actorId } });
    clients.push(socket); socket.messages = [];
    socket.on("message", bytes => socket.messages.push(JSON.parse(bytes.toString())));
    socket.on("error", () => {});
    return socket;
  };
  return { accounts, transport, actors, children, connect, advance: ms => { now += ms; } };
}
async function until(predicate) {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.ok(predicate(), "Expected socket state did not arrive");
}
async function denied(socket) {
  const code = await new Promise(resolve => socket.once("unexpected-response", (_req, response) => { response.resume(); resolve(response.statusCode); }));
  assert.equal(code, 403); socket.terminate();
}

test("native output, pasted input, resize and reconnect use a ticketed socket without replaying input", async t => {
  const f = await fixture(t);
  const login = await f.accounts.action({ userId: "alice" }, "connect", {}, "alice");
  f.children[0].output("Open https://claude.ai/oauth/authorize?state=example\r\nCode: ");
  const ticket = await f.transport.issueTicket({ userId: "alice" }, login, "alice");
  const socket = f.connect(ticket);
  await until(() => socket.messages.length);
  assert.equal(socket.protocol, CLAUDE_LOGIN_SOCKET_PROTOCOL);
  assert.match(socket.messages[0].data, /Code:/);
  assert.equal(socket.messages[0].verificationUrl, "https://claude.ai/oauth/authorize?state=example");
  socket.send(JSON.stringify({ type: "input", data: "example-code#state\r" }));
  socket.send(JSON.stringify({ type: "resize", cols: 40, rows: 20 }));
  await until(() => f.children[0].sizes.length);
  assert.deepEqual(f.children[0].writes, ["example-code#state\r"]);
  assert.deepEqual(f.children[0].sizes, [[40, 20]]);
  f.children[0].output("Verifying\r\n");
  await until(() => socket.messages.length === 2);
  assert.equal(socket.messages[1].type, "output");
  socket.close(); await until(() => socket.readyState === WebSocket.CLOSED);
  await denied(f.connect(ticket));
  const resumed = f.connect(await f.transport.issueTicket({ userId: "alice" }, login, "alice"));
  await until(() => resumed.messages.length);
  assert.match(resumed.messages[0].data, /Verifying/);
  assert.deepEqual(f.children[0].writes, ["example-code#state\r"]);
  await f.accounts.action({ userId: "alice" }, "cancel", {}, "alice");
  await until(() => resumed.readyState === WebSocket.CLOSED);
  assert.ok(resumed.messages.some(message => message.type === "finished"));
  await assert.rejects(f.transport.issueTicket({ userId: "alice" }, login, "alice"));
});

test("tickets reject foreign origins, other actors, retired attempts, expiry and inactive accounts", async t => {
  const f = await fixture(t);
  const owner = { userId: "alice" }, login = await f.accounts.action(owner, "connect", {}, "alice");
  await assert.rejects(f.transport.issueTicket(owner, login, "bob"));
  await assert.rejects(f.transport.issueTicket(owner, { attemptId: "unknown" }, "alice"));
  await denied(f.connect(await f.transport.issueTicket(owner, login, "alice"), "alice", "https://foreign.example"));
  await denied(f.connect(await f.transport.issueTicket(owner, login, "alice"), "bob"));
  const expired = await f.transport.issueTicket(owner, login, "alice"); f.advance(60001);
  await denied(f.connect(expired));
  const revoked = await f.transport.issueTicket(owner, login, "alice"); f.actors.delete("alice");
  await denied(f.connect(revoked));
  f.actors.set("alice", { id: "alice", role: "user" });
  const retired = await f.transport.issueTicket(owner, login, "alice");
  await f.accounts.action(owner, "cancel", {}, "alice"); await f.accounts.action(owner, "connect", {}, "alice");
  await denied(f.connect(retired));
});

test("workspace sign-in requires the initiating administrator and rechecks active socket access", async t => {
  const f = await fixture(t, 20);
  const owner = { workload: "team" }, login = await f.accounts.action(owner, "connect", {}, "admin");
  await assert.rejects(f.transport.issueTicket(owner, login, "alice"));
  await assert.rejects(f.transport.issueTicket(owner, login, "otheradmin"));
  const socket = f.connect(await f.transport.issueTicket(owner, login, "admin"), "admin");
  await until(() => socket.messages.length);
  f.actors.set("admin", { id: "admin", role: "user" });
  await until(() => socket.readyState === WebSocket.CLOSED);
  assert.deepEqual(f.children[0].writes, []);
});

test("invalid input is closed before reaching the native login process", async t => {
  const f = await fixture(t);
  const owner = { userId: "alice" }, login = await f.accounts.action(owner, "connect", {}, "alice");
  const socket = f.connect(await f.transport.issueTicket(owner, login, "alice"));
  await until(() => socket.messages.length);
  socket.send(JSON.stringify({ type: "input", data: "x".repeat(8193) }));
  await until(() => socket.readyState === WebSocket.CLOSED);
  assert.deepEqual(f.children[0].writes, []);
});
