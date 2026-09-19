import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { ClaudeAccounts } from "./claude-accounts.mjs";
import { openClaudeLoginTerminal } from "./claude-login-terminal.mjs";
import { WorkspaceTerminalManager, attachTerminalWebSocket, TERMINAL_SOCKET_PATH, TERMINAL_SOCKET_PROTOCOL } from "./terminal-manager.mjs";
import { TerminalAgentBridge } from "./terminal-agent.mjs";

const origin = "https://neural-labs.example.com";
async function until(predicate) {
  for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.ok(predicate(), "Expected socket state did not arrive");
}
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "claude-terminal-"));
  const actors = new Map(["alice", "bob", "admin", "otheradmin"].map(id => [id, { id, label: id, role: id.includes("admin") ? "admin" : "user" }]));
  const children = [], clients = [];
  const accounts = new ClaudeAccounts({ manager: { stateRoot: root, ensureProvisioned: async id => ({ agentId: `nl-${id}` }) },
    team: { agentId: "nl-teamneura", ensureProvisioned: async () => {} },
    spawnPty: (_command, _args, options) => {
      const child = { options, writes: [], sizes: [], onData(fn) { this.output = fn; }, onExit(fn) { this.exit = fn; }, write(data) { this.writes.push(data); }, resize(cols, rows) { this.sizes.push([cols, rows]); }, kill() { this.exit({ exitCode: 1 }); } };
      children.push(child); return child;
    }, execute: async () => { throw new Error("No native credentials in this test"); },
  });
  const terminals = new WorkspaceTerminalManager({ workspaceRoot: root, spawnPty: () => { throw new Error("Must not spawn a shell for sign-in"); } });
  const resolveActor = async id => actors.get(id);
  const bridge = new TerminalAgentBridge({ manager: terminals, resolveActor });
  const server = createServer((_req, res) => { res.writeHead(404); res.end(); });
  const transport = attachTerminalWebSocket(server, { manager: terminals, publicOrigin: origin, heartbeatMs: 50 });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    for (const socket of clients) socket.terminate();
    transport.close(); bridge.close();
    for (const id of [...accounts.logins.keys()]) await accounts.stop(id, null, false);
    terminals.shutdown();
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const launch = async (owner = { userId: "alice" }, actorId = "alice") => {
    const result = await accounts.action(owner, "connect", {}, actorId);
    const id = await openClaudeLoginTerminal({ accounts, terminals, owner, attemptId: result.attemptId, actorId, resolveActor });
    return terminals.sessions.get(id);
  };
  const connect = async session => {
    const ticket = await terminals.issueTicket(actors.get(session.ownerId), session.id, null);
    const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}${TERMINAL_SOCKET_PATH}`, [TERMINAL_SOCKET_PROTOCOL, `ticket.${ticket.ticket}`], { headers: { Origin: origin, "X-Forwarded-User": session.ownerId } });
    clients.push(socket); socket.messages = [];
    socket.on("message", bytes => socket.messages.push(JSON.parse(bytes.toString())));
    socket.on("error", () => {});
    await until(() => socket.messages.some(m => m.type === "ready"));
    return socket;
  };
  return { accounts, terminals, bridge, actors, children, launch, connect };
}

test("Claude uses the Terminal app socket, its exact native PTY and output-only reconnect", async t => {
  const f = await fixture(t);
  const session = await f.launch();
  f.children[0].output("Open https://claude.ai/oauth/authorize?state=example\r\nCode: ");
  const socket = await f.connect(session);
  assert.equal(socket.protocol, TERMINAL_SOCKET_PROTOCOL);
  await until(() => socket.messages.some(m => m.type === "replay"));
  assert.match(socket.messages.find(m => m.type === "replay").data, /Code:/);
  assert.equal(socket.messages.find(m => m.type === "ready").session.providerSignIn.verificationUrl, "https://claude.ai/oauth/authorize?state=example");
  socket.send(JSON.stringify({ type: "input", data: "example-code#state\r" }));
  socket.send(JSON.stringify({ type: "resize", cols: 40, rows: 20 }));
  await until(() => f.children[0].sizes.length);
  assert.deepEqual(f.children[0].writes, ["example-code#state\r"]);
  assert.deepEqual(f.children[0].sizes, [[40, 20]]);
  assert.equal((await f.launch()).id, session.id);
  assert.equal(f.children.length, 1);
  assert.match(f.children[0].options.cwd, /agents\/nl-alice\/agent\/neural-labs-claude\/home-1$/);
  socket.close(); await until(() => socket.readyState === WebSocket.CLOSED);
  await f.connect(session);
  assert.deepEqual(f.children[0].writes, ["example-code#state\r"]);
  await f.accounts.action({ userId: "alice" }, "cancel", {}, "alice");
  await until(() => session.status === "exited");
  assert.deepEqual(session.backlog, []);
});

test("sign-in is inaccessible to other users and Neura, with participation permanently disabled", async t => {
  const f = await fixture(t);
  const session = await f.launch();
  f.children[0].output("private one-time code");
  assert.equal(await f.terminals.get(f.actors.get("bob"), session.id), null);
  assert.equal(await f.terminals.get(f.actors.get("admin"), session.id), null);
  await assert.rejects(f.terminals.setAgentMode(f.actors.get("alice"), session.id, "shared"), { code: "terminal_private" });
  const context = await f.bridge.mint(f.actors.get("alice"), { conversationId: "private" });
  assert.deepEqual(context.recentTerminals, []);
  assert.deepEqual((await f.bridge.call("list_terminals", context)).sessions, []);
  for (const tool of ["read_terminal", "send_terminal_input"]) {
    await assert.rejects(f.bridge.call(tool, { ...context, terminalId: session.id, text: "code" }), { code: "terminal_not_found" });
  }
  await f.terminals.close(f.actors.get("alice"), session.id);
  await until(() => !f.accounts.logins.size);
  assert.deepEqual(session.backlog, []);
});

test("workspace sign-in belongs to its initiating admin and sockets close on role revocation", async t => {
  const f = await fixture(t);
  const session = await f.launch({ workload: "team" }, "admin");
  assert.equal(session.scope, "personal");
  assert.equal(await f.terminals.get(f.actors.get("otheradmin"), session.id), null);
  assert.match(f.children[0].options.cwd, /agents\/nl-teamneura\/agent\/neural-labs-claude\/home-1$/);
  const socket = await f.connect(session);
  f.actors.set("admin", { ...f.actors.get("admin"), role: "user" });
  await until(() => socket.readyState === WebSocket.CLOSED);
  assert.equal(await f.terminals.get(f.actors.get("admin"), session.id), null);
});
