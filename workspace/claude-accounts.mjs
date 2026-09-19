import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, rename, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import * as pty from "node-pty";
import { claudePaths, claudeEnvironment, readClaudeConnection, CLAUDE_VERSION } from "./claude-runtime.mjs";

const executeDefault = promisify(execFile);
export class ClaudeAccounts {
  constructor({ manager, team, execute = executeDefault, spawnPty = pty.spawn, saveKey = saveNativeKey, now = Date.now }) {
    this.manager = manager; this.team = team; this.execute = execute; this.spawnPty = spawnPty; this.saveKey = saveKey; this.now = now;
    this.nativeChecks = new Map(); this.errors = new Map(); this.logins = new Map(); this.tails = new Map();
  }
  async owner({ userId, workload = "background" }) {
    if (userId) return (await this.manager.ensureProvisioned(userId)).agentId;
    if (workload === "team") { await this.team.ensureProvisioned(); return this.team.agentId; }
    if (workload !== "background") throw new Error("Invalid Claude workload");
    return "main";
  }
  state(id) { return readClaudeConnection(this.manager.stateRoot, id); }
  paths(id) { return claudePaths(this.manager.stateRoot, id); }
  home(id, state) { return path.join(this.paths(id).root, `home-${state.generation}`); }
  queue(id, operation) {
    const next = (this.tails.get(id) || Promise.resolve()).then(operation, operation);
    this.tails.set(id, next.catch(() => {})); return next;
  }
  async persist(id, value) {
    const paths = this.paths(id);
    await mkdir(paths.root, { recursive: true, mode: 0o700 });
    const temp = `${paths.state}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(value), { mode: 0o600 });
    await rename(temp, paths.state);
  }
  async nativeStatus(id, state) {
    const key = this.home(id, state);
    if (this.nativeChecks.has(key)) return this.nativeChecks.get(key);
    const check = this.probeNativeStatus(id, state);
    this.nativeChecks.set(key, check);
    try { return await check; } finally { if (this.nativeChecks.get(key) === check) this.nativeChecks.delete(key); }
  }
  async probeNativeStatus(id, state) {
    try {
      const options = { env: claudeEnvironment(this.home(id, state)), timeout: 15_000, maxBuffer: 128 * 1024, encoding: "utf8" };
      const version = await this.execute("claude", ["--version"], options);
      if (!version.stdout.startsWith(`${CLAUDE_VERSION} `) && version.stdout.trim() !== CLAUDE_VERSION) return false;
      const result = JSON.parse((await this.execute("claude", ["auth", "status", "--json"], options)).stdout);
      return result.loggedIn === true && ["claude.ai", "oauth"].includes(result.authMethod);
    } catch { return false; }
  }
  async snapshot(owner) {
    const id = await this.owner(owner); const state = await this.state(id); const login = this.logins.get(id);
    let authenticated = false;
    if (!login && state.method === "subscription" && state.generation > 0) authenticated = await this.nativeStatus(id, state);
    else if (!login && state.method === "api-key") {
      const auth = await this.manager.openclawJson(["models", "auth", "list", "--agent", id, "--provider", "anthropic", "--json"]).catch(() => null);
      authenticated = auth?.authStatePath?.replaceAll("\\", "/").endsWith(`/agents/${id}/agent/openclaw-agent.sqlite`) && auth.profiles?.some(row => row.id === `anthropic:neural-labs-${id}` && row.provider === "anthropic" && row.type === "api_key") || false;
    }
    const agents = authenticated ? await this.manager.openclawJson(["config", "get", "agents", "--json"]).catch(() => null) : null;
    const current = await this.state(id);
    if (current.generation !== state.generation || current.paused !== state.paused || current.method !== state.method) return this.snapshot(owner);
    const routed = Object.values(agents?.entries?.[id]?.models ?? {}).some(row => row?.agentRuntime?.id === "neural-labs-claude");
    return { provider: "anthropic", authMethod: state.method, agentId: id, authenticated: authenticated && !login, modelReady: authenticated && routed && !state.paused && !login,
      paused: state.paused, state: login ? "awaiting_user" : this.errors.has(id) ? "error" : authenticated ? "connected" : "disconnected", message: this.errors.get(id) ?? null };
  }
  async action(owner, action, input = {}, actorId) {
    const id = await this.owner(owner);
    return this.queue(id, async () => {
      if (action === "connect") {
        if (this.logins.has(id)) {
          const login = this.logins.get(id);
          if (login.actorId !== actorId) throw new Error("Another administrator is completing sign-in");
          return { ...(await this.snapshot(owner)), attemptId: login.id };
        }
        this.errors.delete(id);
        const prior = await this.state(id);
        const candidate = { method: "subscription", generation: prior.generation + 1, paused: true };
        // Persist the generation before login. Restart can never reuse a failed
        // attempt's home for a different identity or resume an old CLI session.
        await this.persist(id, candidate);
        await this.onChange?.(owner);
        const home = this.home(id, candidate);
        await mkdir(home, { recursive: true, mode: 0o700 });
        const child = this.spawnPty("claude", ["auth", "login"], { cwd: home, env: { ...claudeEnvironment(home), BROWSER: "/bin/false" }, name: "xterm-256color", cols: 90, rows: 24 });
        const login = { id: randomUUID(), actorId, child, output: "", offset: 0, cancelled: false, exited: false, listeners: new Set() };
        this.logins.set(id, login);
        login.closed = new Promise(resolve => {
          child.onData(data => {
            login.output += data;
            if (login.output.length > 65536) { const dropped = login.output.length - 65536; login.output = login.output.slice(dropped); login.offset += dropped; }
            for (const listener of login.listeners) listener({ type: "output", data, verificationUrl: nativeLoginUrl(login.output) });
          });
          child.onExit(({ exitCode }) => {
            clearTimeout(login.timer);
            login.exited = true;
            login.exitCode = exitCode;
            // Resolve before the queued completion to avoid deadlock with cancel.
            resolve();
            void this.queue(id, async () => {
              if (this.logins.get(id) !== login) return;
              this.logins.delete(id); login.output = "";
              if (!login.cancelled && exitCode === 0 && await this.nativeStatus(id, candidate)) {
                await this.persist(id, { ...candidate, paused: false });
                await this.onChange?.(owner);
              } else if (!login.cancelled) this.errors.set(id, "Claude sign-in did not complete. Start sign-in again.");
            }).catch(() => { this.errors.set(id, "Claude signed in, but model setup could not complete. Refresh the connection to retry."); }).finally(() => this.finishLogin(login));
          });
        });
        login.timer = setTimeout(() => { this.errors.set(id, "Claude sign-in expired. Start sign-in again."); login.cancelled = true; child.kill("SIGKILL"); }, 16 * 60_000); login.timer.unref?.();
        return { ...(await this.snapshot(owner)), attemptId: login.id };
      }
      if (!["cancel", "pause", "resume", "disconnect", "api-key", "refresh"].includes(action)) throw new Error("Invalid Claude action");
      if (action !== "refresh") await this.stop(id, actorId, action === "cancel");
      let state = await this.state(id);
      if (action === "pause" || action === "disconnect") await this.persist(id, { ...state, paused: true });
      if (action === "resume") {
        if (!(await this.snapshot(owner)).authenticated) throw new Error("Connect Claude before resuming");
        await this.persist(id, { ...state, paused: false });
      }
      if (action === "disconnect") {
        // Retire both methods, including dormant credentials left by an explicit
        // billing-method change or a cancelled reconnect.
        for (const name of await readdir(this.paths(id).root)) if (/^home-\d+$/.test(name)) {
          await this.execute("claude", ["auth", "logout"], { env: claudeEnvironment(path.join(this.paths(id).root, name)), timeout: 15_000, maxBuffer: 128 * 1024 });
        }
        const auth = await this.manager.openclawJson(["models", "auth", "list", "--agent", id, "--provider", "anthropic", "--json"]);
        if (auth?.profiles?.some(row => row.id === `anthropic:neural-labs-${id}`)) {
          if (!auth.authStatePath?.replaceAll("\\", "/").endsWith(`/agents/${id}/agent/openclaw-agent.sqlite`)) throw new Error("Unexpected credential owner");
          await this.manager.execute("openclaw", ["models", "auth", "logout", `anthropic:neural-labs-${id}`, "--agent", id, "--yes"], { timeout: 30_000 });
          const remaining = await this.manager.openclawJson(["models", "auth", "list", "--agent", id, "--provider", "anthropic", "--json"]);
          if (remaining?.profiles?.some(row => row.id === `anthropic:neural-labs-${id}`)) throw new Error("Claude API key removal could not be verified");
        }
        if (await this.nativeStatus(id, state)) throw new Error("Claude logout could not be verified");
        await this.persist(id, { ...state, generation: state.generation + 1, paused: true });
      }
      if (action === "api-key") {
        if (owner.userId || typeof input.key !== "string" || !input.key.trim() || input.key.length > 4096) throw new Error("A workspace API key is required");
        await this.persist(id, { ...state, paused: true });
        await this.saveKey({ agentDir: path.dirname(this.paths(id).root), profileId: `anthropic:neural-labs-${id}`, key: input.key.trim() });
        await this.manager.execute("openclaw", ["models", "auth", "order", "set", "--agent", id, "--provider", "anthropic", `anthropic:neural-labs-${id}`], { timeout: 30_000 });
        await mkdir(this.home(id, { generation: state.generation + 1 }), { recursive: true, mode: 0o700 });
        await this.persist(id, { ...state, generation: state.generation + 1, method: "api-key", paused: false });
      }
      await this.onChange?.(owner);
      this.errors.delete(id);
      return this.snapshot(owner);
    });
  }
  loginSession(id, attemptId, actorId) {
    const login = this.logins.get(id);
    if (!login || login.exited || login.cancelled || login.id !== attemptId || login.actorId !== actorId) throw new Error("Login session expired. Start sign-in again.");
    return login;
  }
  finishLogin(login) {
    for (const listener of login.listeners) listener({ type: "finished" });
    login.listeners.clear();
  }
  async stop(id, actorId, ownerOnly) {
    const login = this.logins.get(id); if (!login) return;
    if (ownerOnly && login.actorId !== actorId) throw new Error("This login belongs to another administrator");
    login.cancelled = true; login.child.kill("SIGKILL");
    let timeout;
    try { await Promise.race([login.closed, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Claude sign-in is still stopping")), 5000); })]); }
    finally { clearTimeout(timeout); }
    this.logins.delete(id); login.output = "";
    this.finishLogin(login);
  }
}
function saveNativeKey(value) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL("./claude-native-key.mjs", import.meta.url))], { stdio: ["pipe", "ignore", "ignore"], env: claudeEnvironment("/nonexistent") });
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
    child.once("error", () => { clearTimeout(timer); reject(new Error("Claude API key could not be saved")); });
    child.once("exit", code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error("Claude API key could not be saved")); });
    child.stdin.on("error", () => {}); child.stdin.end(JSON.stringify(value));
  });
}


export function nativeLoginUrl(output) {
  const clean = output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, "");
  for (const match of clean.matchAll(/https:\/\/[^\s<>"\x1b]+/gu)) {
    try {
      const url = new URL(match[0]);
      if (["claude.ai", "claude.com", "platform.claude.com"].includes(url.hostname) && !url.username && !url.password && /\/oauth\/authorize$/.test(url.pathname)) return url.href;
    } catch { /* Ignore incomplete output chunks. */ }
  }
  return null;
}
