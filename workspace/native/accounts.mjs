import { EventEmitter } from "node:events";
import { watch } from "node:fs";
import { providerEnvironment, CODEX_APP_SERVER } from "./codex.mjs";
import { NATIVE_HOME } from "./launcher.mjs";

const OPENAI_DEVICE_URL = "https://auth.openai.com/codex/device";
function openAIDeviceCode(output) {
  const clean = output.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/gu, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, "").replace(/\r/gu, "\n");
  const url = clean.match(/URL:\s*(https:\/\/[^\s]+)/iu)?.[1];
  const code = clean.match(/Code:\s*([A-Z0-9][A-Z0-9-]{3,31})/u)?.[1];
  if (!url || !code) return null;
  // A provider process must not supply an arbitrary destination to the browser.
  if (url !== OPENAI_DEVICE_URL) return null;
  return { verificationUrl: url, userCode: code };
}

export function nativeAccountEnvironment(provider, method = "subscription") {
  return providerEnvironment({ provider, method, home: NATIVE_HOME,
    credentialHome: `${NATIVE_HOME}/${provider === "codex" ? ".codex" : ".claude"}` });
}

export class NativeAccounts extends EventEmitter {
  constructor({ terminals, spawnPty, resolveActor }) {
    super(); this.terminals = terminals; this.spawnPty = spawnPty; this.resolveActor = resolveActor;
    this.logins = new Map(); this.watchers = new Map();
  }
  watch(connection, homeRoot) {
    if (this.watchers.has(connection)) return;
    const watchers = [".codex", ".claude"].map(directory => watch(`${homeRoot}/${directory}`, { persistent: false }, () => {
      this.emit("changed", { connection });
    }));
    for (const watcher of watchers) watcher.on("error", () => this.emit("changed", { connection }));
    this.watchers.set(connection, watchers);
  }
  async status(grant, launch) {
    if (grant.binding.method !== "subscription") return { ready: false, reason: "api-key-not-configured" };
    const provider = grant.binding.provider;
    let ready = false;
    try {
      const result = await launch.exec(provider === "codex" ? CODEX_APP_SERVER : "/usr/local/bin/claude",
        provider === "codex" ? ["login", "status"] : ["auth", "status", "--json"],
        { env: nativeAccountEnvironment(provider), timeout: 10000, maxBuffer: 65536 });
      const claude = provider === "claude" ? JSON.parse(result.stdout) : null;
      ready = provider === "codex"
        ? /^Logged in using ChatGPT\b/m.test(`${result.stdout}\n${result.stderr}`)
        : claude.loggedIn === true && ["claude.ai", "oauth"].includes(claude.authMethod);
    } catch { /* Device login can be pending while status exits unsuccessfully. */ }
    const signIn = !ready && provider === "codex" ? await this.deviceSignIn(grant) : null;
    return { ready, reason: ready ? null : "native-sign-in-required", ...(signIn ? { signIn } : {}) };
  }
  async deviceSignIn(grant) {
    const entry = this.logins.get(grant.connection);
    if (!entry || entry.actor !== grant.actor || !this.terminals || !this.resolveActor) return null;
    const actor = await this.resolveActor(grant.actor);
    if (!actor || actor.id !== grant.actor) return null;
    const terminal = await this.terminals.get(actor, await entry.terminal);
    if (!terminal || terminal.status !== "running") return null;
    const output = terminal.backlog.map(chunk => chunk.data).join("").slice(-65536);
    return openAIDeviceCode(output);
  }
  async login(grant, launch) {
    if (!this.terminals || !this.spawnPty || !this.resolveActor) throw new Error("Private native sign-in terminal is unavailable");
    if (grant.binding.method !== "subscription") throw new Error("This connection does not use native subscription sign-in");
    const prior = this.logins.get(grant.connection);
    if (prior) {
      if (prior.actor !== grant.actor) throw new Error("Another administrator is connecting this account");
      return { terminalId: await prior.terminal };
    }
    const actor = await this.resolveActor(grant.actor);
    if (!actor || actor.id !== grant.actor) throw new Error("Sign-in membership is unavailable");
    const provider = grant.binding.provider;
    const entry = { actor: grant.actor, terminal: null };
    this.logins.set(grant.connection, entry);
    const access = async viewer => {
      if (viewer.id !== grant.actor) return false;
      try { await grant.revalidate(); return true; } catch { return false; }
    };
    try {
      entry.terminal = this.terminals.create(actor, {
        scope: "personal", title: `${provider === "codex" ? "Codex" : "Claude"} sign-in`,
        agentMode: "status-only", providerSignIn: () => null, access,
        beforeStart: grant.revalidate,
        processFactory: () => {
          const spec = launch.invocation(provider === "codex" ? CODEX_APP_SERVER : "/usr/local/bin/claude",
            provider === "codex" ? ["login", "--device-auth"] : ["auth", "login"],
            { env: { ...nativeAccountEnvironment(provider), TERM: "xterm-256color" } });
          const process = this.spawnPty(spec.file, spec.args, { ...spec.options, name: "xterm-256color", cols: 100, rows: 30 });
          let checking = false;
          const timer = setInterval(() => {
            if (checking) return;
            checking = true;
            Promise.resolve().then(grant.revalidate).catch(() => process.kill()).finally(() => { checking = false; });
          }, 5000);
          timer.unref();
          process.onExit(() => {
            clearInterval(timer); this.logins.delete(grant.connection);
            this.emit("changed", { connection: grant.connection });
          });
          return process;
        },
      }).then(terminal => terminal.id);
      return { terminalId: await entry.terminal };
    } catch (error) { this.logins.delete(grant.connection); throw error; }
  }
  async cancel(grant) {
    const entry = this.logins.get(grant.connection);
    if (!entry) return { cancelled: false };
    if (entry.actor !== grant.actor) throw new Error("Another administrator is connecting this account");
    const actor = await this.resolveActor(grant.actor);
    if (!actor || actor.id !== grant.actor) throw new Error("Sign-in membership is unavailable");
    await grant.revalidate();
    const closed = await this.terminals.close(actor, await entry.terminal);
    return { cancelled: closed };
  }
  close() { for (const watchers of this.watchers.values()) for (const watcher of watchers) watcher.close(); this.watchers.clear(); }
}
