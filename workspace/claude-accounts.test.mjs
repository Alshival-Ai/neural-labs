import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ClaudeAccounts } from "./claude-accounts.mjs";
import { TeamOpenAI } from "./team-openai.mjs";
import { buildClaudeBackend, claudeEnvironment, prepareClaudeExecution, CLAUDE_VERSION } from "./claude-runtime.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "claude-accounts-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const children = [], authenticated = new Set(), calls = [];
  const manager = { stateRoot: root, ensureProvisioned: async userId => { const agentId = `nl-${userId}`; await mkdir(path.join(root, "agents", agentId, "agent"), { recursive: true }); return { agentId }; },
    openclawJson: async () => ({ entries: Object.fromEntries(["nl-alice", "nl-bob", "main", "nl-teamneura"].map(id => [id, { models: { "anthropic/test": { agentRuntime: { id: "neural-labs-claude" } } } }])) }), execute: async (...args) => calls.push(args) };
  const accounts = new ClaudeAccounts({ manager, team: { agentId: "nl-teamneura", ensureProvisioned: async () => {} },
    execute: async (cmd, args, options) => {
      calls.push([cmd, args, options]);
      if (args[0] === "--version") return { stdout: `${CLAUDE_VERSION} (Claude Code)` };
      if (args[1] === "logout") { authenticated.delete(options.env.CLAUDE_CONFIG_DIR); return { stdout: "" }; }
      return { stdout: JSON.stringify({ loggedIn: authenticated.has(options.env.CLAUDE_CONFIG_DIR), authMethod: "claude.ai" }) };
    },
    spawnPty: (cmd, args, options) => {
      const child = { cmd, args, options, data: [], onData(cb) { this.receive = cb; }, onExit(cb) { this.exit = cb; }, write(data) { this.data.push(data); }, kill() { this.exit({ exitCode: 1 }); } };
      children.push(child); return child;
    }, saveKey: async value => calls.push(["saveKey", value]),
  });
  const finish = async (child, code = 0) => { authenticated.add(child.options.env.CLAUDE_CONFIG_DIR); child.exit({ exitCode: code }); await new Promise(resolve => setImmediate(resolve)); await accounts.tails.get(path.basename(path.dirname(path.dirname(child.options.cwd)))); await new Promise(resolve => setTimeout(resolve, 20)); };
  return { root, accounts, children, authenticated, calls, finish };
}
test("Claude resolves the provisioned Team Neura owner through the real team manager", async t => {
  const f = await fixture(t);
  const provisioned = [];
  const team = new TeamOpenAI({
    account: () => ({ agentId: "nl-teamneura" }),
    ensureProvisioned: async owner => { provisioned.push(owner); return { agentId: "nl-teamneura" }; },
  });
  f.accounts.team = team;
  const status = await f.accounts.snapshot({ workload: "team" });
  assert.equal(status.agentId, "nl-teamneura");
  assert.equal(status.state, "disconnected");
  assert.deepEqual(provisioned, ["team-neura"]);
  assert.equal((await f.accounts.snapshot({ workload: "background" })).agentId, "main");
});
test("native login has isolated homes, browser fallback, owner-bound terminal input and no secrets in status", async t => {
  const f = await fixture(t);
  const a = await f.accounts.action({ userId: "alice" }, "connect", {}, "actor-a");
  const b = await f.accounts.action({ userId: "bob" }, "connect", {}, "actor-b");
  assert.notEqual(f.children[0].options.env.CLAUDE_CONFIG_DIR, f.children[1].options.env.CLAUDE_CONFIG_DIR);
  assert.equal(f.children[0].options.env.BROWSER, "/bin/false");
  assert.deepEqual(f.children[0].args, ["auth", "login"]);
  f.children[0].receive("native auth link and code");
  assert.throws(() => f.accounts.loginSession("nl-alice", a.attemptId, "actor-b"));
  assert.throws(() => f.accounts.loginSession("nl-bob", a.attemptId, "actor-b"));
  assert.match(f.accounts.loginSession("nl-alice", a.attemptId, "actor-a").output, /native auth/);
  await assert.rejects(f.accounts.action({ userId: "alice" }, "terminal", {}, "actor-a"));
  assert.equal(JSON.stringify(await f.accounts.snapshot({ userId: "alice" })).includes("one-time-code"), false);
  await f.finish(f.children[0]);
  assert.equal((await f.accounts.snapshot({ userId: "alice" })).modelReady, true);
  await f.accounts.action({ userId: "bob" }, "cancel", {}, "actor-b");
  assert.throws(() => f.accounts.loginSession("nl-bob", b.attemptId, "actor-b"));
});
test("pause persists across managers and disconnect retires the native home without touching other owners", async t => {
  const f = await fixture(t);
  await f.accounts.action({ userId: "alice" }, "connect", {}, "actor-a"); await f.finish(f.children[0]);
  const state = await f.accounts.state("nl-alice");
  await f.accounts.action({ userId: "alice" }, "pause", {}, "actor-a");
  assert.equal((await f.accounts.snapshot({ userId: "alice" })).paused, true);
  assert.equal(JSON.parse(await readFile(f.accounts.paths("nl-alice").state)).paused, true);
  await f.accounts.action({ userId: "alice" }, "resume", {}, "actor-a");
  await f.accounts.action({ userId: "alice" }, "disconnect", {}, "actor-a");
  assert.equal((await f.accounts.snapshot({ userId: "alice" })).authenticated, false);
  assert.ok((await f.accounts.state("nl-alice")).generation > state.generation);
});
test("cancellation cannot be overwritten by a late login completion; API keys require workspace ownership", async t => {
  const f = await fixture(t);
  await f.accounts.action({ userId: "alice" }, "connect", {}, "actor-a");
  const child = f.children[0];
  await f.accounts.action({ userId: "alice" }, "cancel", {}, "actor-a");
  await f.finish(child);
  assert.equal((await f.accounts.state("nl-alice")).paused, true);
  await assert.rejects(f.accounts.action({ userId: "alice" }, "api-key", { key: "test-only-key" }, "actor-a"));
  await f.accounts.action({ workload: "team" }, "api-key", { key: "test-only-key" }, "admin");
  assert.equal((await f.accounts.state("nl-teamneura")).method, "api-key");
  assert.equal((await f.accounts.state("main")).method, "subscription");
  assert.equal(JSON.stringify(await f.accounts.state("nl-teamneura")).includes("test-only-key"), false);
});
test("runtime rejects ownerless and paused execution, and rechecks generation after queue admission", async t => {
  const f = await fixture(t); await f.accounts.owner({ userId: "alice" });
  await f.accounts.persist("nl-alice", { generation: 1, method: "subscription", paused: false });
  const agentDir = path.dirname(f.accounts.paths("nl-alice").root);
  const prepared = await prepareClaudeExecution({ agentDir }, { stateRoot: f.root });
  assert.equal(prepared.env.CLAUDE_CONFIG_DIR, f.accounts.home("nl-alice", { generation: 1 }));
  await prepared.beforeExecution();
  await f.accounts.persist("nl-alice", { generation: 2, method: "subscription", paused: false });
  await assert.rejects(prepared.beforeExecution());
  await assert.rejects(prepareClaudeExecution({ agentDir: "/tmp/unknown" }, { stateRoot: f.root }));
  await f.accounts.persist("nl-alice", { generation: 2, method: "subscription", paused: true });
  await assert.rejects(prepareClaudeExecution({ agentDir }, { stateRoot: f.root }));
});
test("runtime removes ambient credentials and keeps Gateway tools in both fresh and resumed argv", () => {
  const env = claudeEnvironment("/test/native-home", { ANTHROPIC_API_KEY: "secret", CLAUDE_CODE_OAUTH_TOKEN: "secret", ANTHROPIC_BASE_URL: "http://wrong", OPENAI_API_KEY: "secret", PATH: "/bin" });
  assert.deepEqual(env, { PATH: "/bin", CLAUDE_CONFIG_DIR: "/test/native-home", DISABLE_AUTOUPDATER: "1", NO_COLOR: "1" });
  const backend = buildClaudeBackend();
  for (const baseArgs of [backend.config.args, backend.config.resumeArgs]) {
    const args = backend.resolveExecutionArgs({ baseArgs, thinkingLevel: "high" });
    assert.ok(args.includes("mcp__openclaw__*")); assert.equal(args[args.indexOf("--tools") + 1], "");
    assert.equal(args.includes("--dangerously-skip-permissions"), false);
  }
});

test("native login links are restricted to Anthropic authorization pages", async () => {
  const { nativeLoginUrl } = await import("./claude-accounts.mjs");
  assert.equal(nativeLoginUrl("Open https://claude.ai/oauth/authorize?code=true&state=test"), "https://claude.ai/oauth/authorize?code=true&state=test");
  const credentialUrl = new URL("https://claude.ai/oauth/authorize");
  credentialUrl.username = "example-user";
  credentialUrl.password = "example-password";
  for (const value of ["https://untrusted.example/oauth/authorize", "https://claude.ai.untrusted.example/oauth/authorize", credentialUrl.href, "http://claude.ai/oauth/authorize", "https://claude.ai/unrelated"]) assert.equal(nativeLoginUrl(value), null);
});

test("the workspace image pins the same native CLI version as connection verification", async () => {
  const containerfile = await readFile(new URL("./Containerfile", import.meta.url), "utf8");
  assert.ok(containerfile.includes(`ARG CLAUDE_VERSION=${CLAUDE_VERSION}\n`));
});
