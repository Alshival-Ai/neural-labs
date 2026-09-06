import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, symlink, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { WorkspaceTerminalManager } from "./terminal-manager.mjs";
import { TerminalAgentBridge } from "./terminal-agent.mjs";
import { installTerminalGuidance } from "./terminal-guidance.mjs";

const alice = { id: "alice", label: "Alice", role: "user" };
const bob = { id: "bob", label: "Bob", role: "user" };
const admin = { id: "admin", label: "Admin", role: "admin" };
const channel = "55555555-5555-4555-8555-555555555555";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "terminal-agent-"));
  const actors = new Map([alice, bob, admin].map((a) => [a.id, a]));
  const members = new Set([alice.id, bob.id, admin.id]);
  const processes = [];
  const manager = new WorkspaceTerminalManager({ workspaceRoot: root, shell: "/bin/bash", teamChannelAuthorizer: async (actor, channelId) => members.has(actor.id) && channelId === channel ? { allowed: true, channel: { id: channel, name: "release" } } : null, spawnPty: (shell, args, options) => {
    const process = { shell, args, options, writes: [], onData(fn) { this.output = fn; }, onExit(fn) { this.exit = fn; }, write(data) { this.writes.push(data); }, kill() {}, resize() {} };
    processes.push(process); return process;
  } });
  let now = Date.now();
  const bridge = new TerminalAgentBridge({ manager, resolveActor: async (id) => actors.get(id), now: () => now });
  t.after(async () => { bridge.close(); manager.shutdown(); await rm(root, { recursive: true, force: true }); });
  const mint = (actor = alice, extra = {}) => bridge.mint(actor, { conversationId: "private-1", ...extra });
  return { root, manager, bridge, mint, actors, members, processes, advance: (ms) => { now += ms; } };
}

function desktop(bridge, actor = alice, id = "desktop") {
  const response = new EventEmitter();
  response.writes = [];
  response.writeHead = () => {};
  response.write = (value) => { response.writes.push(value); response.emit("data", value); };
  response.end = () => response.emit("close");
  bridge.subscribe(actor, id, response);
  return response;
}

test("reads prior terminal history and new output, without rerunning commands", async (t) => {
  const f = await fixture(t);
  const terminal = await f.manager.create(alice);
  f.processes[0].output("build failed: missing module\n");
  const context = await f.mint(alice, { terminalId: terminal.id });
  const result = await f.bridge.call("read_terminal", context);
  assert.match(result.output, /missing module/);
  assert.equal(f.processes.length, 1);
  const pending = f.bridge.call("read_terminal", { ...context, afterSequence: result.nextSequence, waitMs: 500 });
  setTimeout(() => f.processes[0].output("fixed\n"), 20);
  assert.equal((await pending).output, "fixed\n");
  assert.equal(f.processes[0].writes.length, 0);
});

test("pause excludes output permanently, rejects writes and rechecks waiting reads", async (t) => {
  const f = await fixture(t);
  const terminal = await f.manager.create(alice);
  const context = await f.mint(alice, { terminalId: terminal.id });
  const pending = f.bridge.call("read_terminal", { ...context, afterSequence: 0, waitMs: 500 });
  await new Promise((r) => setTimeout(r, 20));
  await f.manager.setAgentMode(alice, terminal.id, "status-only");
  assert.equal((await pending).statusOnly, true);
  f.processes[0].output("do-not-share-this\n");
  await assert.rejects(f.bridge.call("send_terminal_input", { ...context, terminalId: terminal.id, text: "x" }), { code: "terminal_paused" });
  await f.manager.setAgentMode(alice, terminal.id, "shared");
  f.processes[0].output("safe output\n");
  const result = await f.bridge.call("read_terminal", context);
  assert.equal(result.output, "safe output\n");
  assert.equal(result.excludedOutput, true);
  assert.match(f.manager.replay(f.manager.sessions.get(terminal.id), null).data, /do-not-share-this/);
});

test("personal ownership and conversation channel boundaries", async (t) => {
  const f = await fixture(t);
  const personal = await f.manager.create(alice);
  await assert.rejects(f.bridge.call("read_terminal", { ...await f.mint(bob), terminalId: personal.id }), { code: "terminal_not_found" });
  const team = await f.manager.create(alice, { scope: "team", channelId: channel });
  await f.manager.focusSession(bob, team.id);
  const privateBob = await f.mint(bob);
  assert.equal((await f.bridge.call("list_terminals", privateBob)).sessions.length, 1);
  const shared = await f.mint(alice, { channelId: channel, terminalId: team.id });
  await assert.rejects(f.bridge.call("read_terminal", { ...shared, terminalId: personal.id }), { code: "terminal_not_found" });
  await assert.rejects(f.manager.setAgentMode(bob, team.id, "status-only"), { code: "terminal_forbidden" });
  await f.manager.setAgentMode(admin, team.id, "status-only");
  f.members.delete(bob.id);
  await assert.rejects(f.bridge.call("read_terminal", privateBob), { code: "terminal_not_found" });
});

test("revokes access during a long poll and expires capabilities", async (t) => {
  const f = await fixture(t);
  const terminal = await f.manager.create(alice);
  const context = await f.mint(alice, { terminalId: terminal.id });
  const pending = f.bridge.call("read_terminal", { ...context, afterSequence: 0, waitMs: 50 });
  await new Promise((r) => setTimeout(r, 10));
  f.actors.delete(alice.id);
  await assert.rejects(pending, { code: "terminal_access_revoked" });
  f.actors.set(alice.id, alice);
  f.advance(3600001);
  await assert.rejects(f.bridge.call("list_terminals", context), { code: "terminal_context_expired" });
});

test("bounded history reports gaps, truncation and strips ANSI", async (t) => {
  const f = await fixture(t);
  const terminal = await f.manager.create(alice);
  const context = await f.mint(alice, { terminalId: terminal.id });
  f.processes[0].output("a".repeat(2 * 1024 * 1024));
  f.processes[0].output("b".repeat(1024) + "\x1b[31merror\x1b[0m");
  const result = await f.bridge.call("read_terminal", { ...context, afterSequence: 0, maxBytes: 256 });
  assert.equal(result.historyGap, true);
  assert.equal(result.truncated, true);
  assert.ok(Buffer.byteLength(result.output) <= 256);
  assert.match(result.output, /error$/);
  assert.ok(!result.output.includes("\x1b"));
});

test("user and agent write to one PTY, without implicit newlines, and report exit", async (t) => {
  const f = await fixture(t);
  const terminal = await f.manager.create(alice);
  const context = await f.mint(alice, { terminalId: terminal.id });
  const session = f.manager.sessions.get(terminal.id);
  f.manager.input(session, { actor: alice, lastTypingAt: 0 }, "user\n");
  await f.bridge.call("send_terminal_input", { ...context, terminalId: terminal.id, text: "agent" });
  await f.bridge.call("send_terminal_input", { ...context, terminalId: terminal.id, interrupt: true });
  assert.deepEqual(f.processes[0].writes, ["user\n", "agent", "\x03"]);
  f.processes[0].exit({ exitCode: 7 });
  assert.equal((await f.bridge.call("read_terminal", context)).exitCode, 7);
  await assert.rejects(f.bridge.call("send_terminal_input", { ...context, terminalId: terminal.id, text: "again" }), { code: "terminal_not_running" });
  await f.manager.close(alice, terminal.id);
  await assert.rejects(f.bridge.call("read_terminal", context), { code: "terminal_not_found" });
});

test("launch chooses focused desktop, claims once, waits for ready, and deduplicates", async (t) => {
  const f = await fixture(t);
  const old = desktop(f.bridge, alice, "old");
  f.advance(1);
  const current = desktop(f.bridge, alice, "current");
  const context = await f.mint();
  const launch = f.bridge.call("open_terminal", { ...context, requestId: "launch-1", command: "printf ready", agentMode: "status-only" });
  await new Promise((r) => setTimeout(r, 20));
  const event = current.writes.find((value) => value.startsWith("event:"));
  assert.ok(event);
  assert.ok(!old.writes.some((value) => value.startsWith("event:")));
  const { requestId } = JSON.parse(event.split("data: ")[1]);
  await assert.rejects(f.bridge.claim(alice, { requestId, desktopId: "old" }), { code: "launch_not_found" });
  const { session } = await f.bridge.claim(alice, { requestId, desktopId: "current" });
  assert.equal(f.processes.length, 0);
  await assert.rejects(f.bridge.claim(alice, { requestId, desktopId: "current" }), { code: "launch_claimed" });
  f.manager.start(f.manager.sessions.get(session.id));
  const result = await launch;
  assert.equal(result.state, "started");
  assert.equal(session.agentMode, "status-only");
  assert.deepEqual(f.processes[0].args, ["-lc", "printf ready"]);
  const retry = await f.bridge.call("open_terminal", { ...context, requestId: "launch-1", command: "different command" });
  assert.equal(retry.terminalId, session.id);
  assert.equal(f.processes.length, 1);
});

test("offline and expired launches do not execute", async (t) => {
  const f = await fixture(t);
  const context = await f.mint();
  await assert.rejects(f.bridge.call("open_terminal", { ...context, requestId: "offline" }), { code: "desktop_offline" });
  desktop(f.bridge);
  const launch = f.bridge.call("open_terminal", { ...context, requestId: "expires", command: "touch should-not-exist" });
  await new Promise((r) => setTimeout(r, 20));
  f.advance(30001);
  f.bridge.cleanup();
  assert.equal((await launch).state, "expired");
  assert.equal(f.processes.length, 0);
});

test("working directories reject traversal, symlinks, and non-directories", async (t) => {
  const f = await fixture(t);
  await symlink(tmpdir(), path.join(f.root, "outside"));
  await writeFile(path.join(f.root, "file"), "x");
  for (const cwd of ["..", "outside", "file", "missing"]) await assert.rejects(f.manager.create(alice, { cwd }), { code: "invalid_cwd" });
  await mkdir(path.join(f.root, "project"));
  const terminal = await f.manager.create(alice, { cwd: "project" });
  assert.equal(terminal.cwd, path.join(f.root, "project"));
});

test("managed agent instructions preserve other guidance and update idempotently", async (t) => {
  const f = await fixture(t);
  const file = path.join(f.root, "AGENTS.md");
  await writeFile(file, "Existing instructions\n");
  await installTerminalGuidance(f.root);
  const first = await readFile(file, "utf8");
  await installTerminalGuidance(f.root);
  assert.equal(await readFile(file, "utf8"), first);
  assert.match(first, /\*\*with the user\*\*/);
  assert.ok(first.endsWith("Existing instructions\n"));
});

test("captures exactly three recently used sessions, excluding noisy output and agent activity from ordering", async (t) => {
  const f = await fixture(t);
  const sessions = [];
  for (let i = 0; i < 4; i++) {
    sessions.push(await f.manager.create(alice, { title: `Run ${i}` }));
    f.processes[i].output(`result ${i}\n`);
  }
  const ids = (context) => context.recentTerminals.map((s) => s.terminalId);
  const initial = await f.mint();
  assert.deepEqual(ids(initial), [sessions[3].id, sessions[2].id, sessions[1].id]);
  f.processes[0].output("noisy background output\n");
  await f.bridge.call("read_terminal", { ...initial, terminalId: sessions[0].id });
  await f.bridge.call("send_terminal_input", { ...initial, terminalId: sessions[0].id, text: "agent input" });
  // An automatic transport reconnect is not human interaction.
  const socket = { readyState: 1, send() {}, close() {} };
  const connected = f.manager.attach(f.manager.sessions.get(sessions[0].id), alice, socket);
  f.manager.detach(f.manager.sessions.get(sessions[0].id), connected);
  assert.deepEqual(ids(await f.mint()), ids(initial));
  await f.manager.focusSession(alice, sessions[0].id);
  assert.deepEqual(ids(await f.mint()), [sessions[0].id, sessions[3].id, sessions[2].id]);
  f.manager.input(f.manager.sessions.get(sessions[1].id), { actor: alice, lastTypingAt: 0 }, "human input");
  assert.deepEqual(ids(await f.mint()), [sessions[1].id, sessions[0].id, sessions[3].id]);
  assert.match(initial.recentTerminals[0].output, /result 3/);
});

test("recent context is per-user, channel-scoped, bounded and stable while queued", async (t) => {
  const f = await fixture(t);
  const personal = await f.manager.create(alice);
  const team = await f.manager.create(alice, { scope: "team", channelId: channel });
  f.processes[1].output("é".repeat(5000));
  const untouched = await f.mint(bob);
  assert.deepEqual(untouched.recentTerminals, []);
  await f.manager.focusSession(bob, team.id);
  const captured = await f.mint(bob, { channelId: channel });
  assert.equal(captured.recentTerminals.length, 1);
  assert.equal(captured.recentTerminals[0].terminalId, team.id);
  assert.ok(Buffer.byteLength(captured.recentTerminals[0].output) <= 4096);
  assert.equal(captured.recentTerminals[0].truncated, true);
  f.processes[1].output("later output should not replace queued context");
  await f.manager.create(bob);
  assert.deepEqual(await f.bridge.context(captured.contextToken, bob.id, channel), captured);
  await assert.rejects(f.bridge.context(captured.contextToken, alice.id, channel), { code: "terminal_context_forbidden" });
  await assert.rejects(f.bridge.context(captured.contextToken, bob.id), { code: "terminal_context_forbidden" });
  assert.ok(!(await f.mint(alice, { channelId: channel })).recentTerminals.some((s) => s.terminalId === personal.id));
  await f.manager.setAgentMode(alice, team.id, "status-only");
  const paused = await f.bridge.context(captured.contextToken, bob.id, channel);
  assert.equal(paused.recentTerminals[0].output, "");
  assert.equal(paused.recentTerminals[0].statusOnly, true);
  f.processes[1].output("hidden while paused");
  await f.manager.setAgentMode(alice, team.id, "shared");
  assert.ok(!(await f.mint(bob, { channelId: channel })).recentTerminals[0].output.includes("hidden while paused"));
  f.members.delete(bob.id);
  await assert.rejects(f.bridge.context(captured.contextToken, bob.id, channel), { code: "terminal_access_revoked" });
});

test("status-only metadata, removed sessions, and explicit write targets", async (t) => {
  const f = await fixture(t);
  const terminal = await f.manager.create(alice, { agentMode: "status-only" });
  f.processes[0].output("masked prompt content");
  const context = await f.mint();
  assert.equal(context.recentTerminals[0].output, "");
  assert.equal(context.recentTerminals[0].statusOnly, true);
  await assert.rejects(f.bridge.call("send_terminal_input", { ...context, text: "guess" }), { code: "terminal_required" });
  await f.manager.close(alice, terminal.id);
  assert.deepEqual((await f.mint()).recentTerminals, []);
  assert.deepEqual((await f.bridge.context(context.contextToken, alice.id)).recentTerminals, []);
  await assert.rejects(f.bridge.call("read_terminal", context), { code: "terminal_not_found" });
});
