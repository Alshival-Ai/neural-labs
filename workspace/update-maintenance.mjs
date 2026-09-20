import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export async function atomicJson(filename, data) {
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  await writeFile(`${filename}.next`, JSON.stringify(data), { mode: 0o600 });
  await rename(`${filename}.next`, filename);
}
async function saved(filename) {
  try { return JSON.parse(await readFile(filename, "utf8")); }
  catch (e) { if (e.code === "ENOENT") return null; throw e; }
}

// Use the supported config CLI before the Gateway starts. The ledger records
// only the settings we override; a migration's other config changes survive.
export async function prepareProbation({ probation, run, root, activate = false }) {
  const filename = path.join(root, "probation.json");
  let ledger = await saved(filename);
  if (probation) {
    if (!ledger) {
      const result = await run(["config", "get", "agents", "--json"], { quiet: true });
      if (result.status !== 0) throw new Error("Cannot inventory heartbeat configuration");
      const agents = JSON.parse(result.stdout);
      ledger = [{ path: "agents.defaults.heartbeat", value: agents.defaults?.heartbeat ?? null }];
      // The public CLI normalizes the legacy list into entries keyed by ID.
      // Use those stable keys, never roster indexes that migrations may reorder.
      if (!agents.entries || typeof agents.entries !== "object" || Array.isArray(agents.entries)) throw new Error("Cannot inventory the effective agent roster");
      for (const [id, agent] of Object.entries(agents.entries)) {
        if (!/^[a-z0-9][a-z0-9_-]{0,127}$/u.test(id)) throw new Error("Unsupported agent configuration path");
        ledger.push({ path: `agents.entries.${id}.heartbeat`, value: agent.heartbeat ?? null });
      }
      await atomicJson(filename, ledger);
    }
    const result = await run(["config", "set", "--batch-json", JSON.stringify(ledger.map(item => ({ path: item.path, value: { ...(item.value ?? {}), every: "0m" } })))]);
    if (result.status !== 0) throw new Error("Cannot disable probation heartbeats");
  } else if (ledger && activate) {
    for (const item of ledger) {
      const result = item.value === null ? await run(["config", "unset", item.path], { quiet: true })
        : await run(["config", "set", item.path, JSON.stringify(item.value), "--strict-json"], { quiet: true });
      if (result.status !== 0) throw new Error("Cannot restore heartbeat configuration");
    }
    await rm(filename);
  }
}

export class UpdateMaintenance {
  constructor({ request, root, probation = false, backgroundBusy = () => false, execute = promisify(execFile), configPath = process.env.OPENCLAW_CONFIG_PATH }) {
    this.request = request; this.filename = path.join(root, "paused-scheduler.json");
    this.execute = execute; this.configPath = configPath;
    this.root = root;
    this.probation = probation; this.gated = probation || existsSync(this.filename) || existsSync(path.join(root, "probation.json")); this.backgroundBusy = backgroundBusy;
    this.localActivity = () => ({ terminals: 0, writes: 0, editors: 0, fileJobs: 0 });
    this.tail = Promise.resolve();
  }
  exclusive(fn) { const next = this.tail.then(fn); this.tail = next.catch(() => {}); return next; }
  async inventory(method, key, extra = {}) {
    const all = [];
    for (let offset = 0; offset < 10000; offset += 200) {
      const page = await this.request(method, { ...extra, offset, limit: 200 });
      if (!Array.isArray(page?.[key]) || typeof page.hasMore !== "boolean") throw new Error("Unrecognized activity inventory");
      all.push(...page[key]); if (!page.hasMore) return all;
    }
    throw new Error("Activity inventory exceeds supported limit");
  }
  async activity() {
    const config = this.configPath ? JSON.parse(await readFile(this.configPath, "utf8")) : {};
    const eligible = !Object.entries(config.channels ?? {}).some(([name, value]) => name !== "sms" && value?.enabled !== false);
    const [sessions, jobs, status] = await Promise.all([
      this.inventory("sessions.list", "sessions", { archived: "all" }),
      this.inventory("cron.list", "jobs", { includeDisabled: true }),
      this.request("status", {}),
    ]);
    // Missing activity flags are an incompatible RPC contract, never 'idle'.
    if (sessions.some(s => typeof s.hasActiveRun !== "boolean")) throw new Error("Session activity is unavailable");
    if (!Number.isInteger(status?.tasks?.active) || status.tasks.active < 0) throw new Error("Native task activity is unavailable");
    const activity = { ...this.localActivity(), tasks: status.tasks.active, chatRuns: sessions.filter(s => s.hasActiveRun || s.activeRunIds?.length).length,
      cronRuns: jobs.filter(j => j.state?.runningAtMs).length, background: this.backgroundBusy() ? 1 : 0 };
    return { protocol: 1, probation: this.probation, gated: this.gated, activity, eligible,
      idle: Object.values(activity).every(n => Number.isInteger(n) && n === 0) };
  }
  async scheduler(enabled) {
    const args = enabled === null ? ["config", "unset", "cron.enabled"] : ["config", "set", "cron.enabled", JSON.stringify(enabled), "--strict-json"];
    try { await this.execute("openclaw", args, { encoding: "utf8", timeout: 30000, maxBuffer: 2 ** 20 }); }
    catch { throw new Error("Cannot change the native scheduler state"); }
    const expected = enabled !== false;
    for (let i = 0; i < 30; i++) {
      const state = await this.request("cron.status", {});
      if (state?.enabled === expected) return;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error("Native scheduler did not acknowledge the requested state");
  }
  pause() { return this.exclusive(async () => {
    this.gated = true;
    let ledger = await saved(this.filename);
    if (!ledger) {
      if (!this.configPath) throw new Error("Native config path is unavailable");
      const config = JSON.parse(await readFile(this.configPath, "utf8"));
      // A polling channel could admit work without passing through host ingress.
      // The first adapter supports the reviewed, ingress-gated SMS channel only.
      if (Object.entries(config.channels ?? {}).some(([name, value]) => name !== "sms" && value?.enabled !== false)) throw new Error("Channel configuration requires operator maintenance");
      ledger = { cronEnabled: config.cron?.enabled ?? null };
      await atomicJson(this.filename, ledger);
    }
    // Pause the scheduler as a whole, including protected system monitor jobs.
    // Editing individual cron jobs would change user schedules and is forbidden
    // for system-owned monitors in current OpenClaw releases.
    await this.scheduler(false);
    await this.request("set-heartbeats", { enabled: false });
    return this.activity();
  }); }
  resume() { return this.exclusive(async () => {
    if (this.probation) throw new Error("Probation requires a normal restart before activation");
    // Called only after the host's durable activation decision. The control
    // plane may now accept notification callbacks and new work on this version.
    this.gated = false;
    try {
      await prepareProbation({ root: this.root, probation: false, activate: true,
        run: async args => {
          try { const result = await this.execute("openclaw", args, { encoding: "utf8", timeout: 30000, maxBuffer: 2 ** 20 }); return { status: 0, stdout: result.stdout }; }
          catch { return { status: 1 }; }
        },
      });
      const ledger = await saved(this.filename);
      if (ledger) {
        await this.scheduler(ledger.cronEnabled);
        await rm(this.filename);
      }
      await this.request("set-heartbeats", { enabled: true });
    } catch (error) { this.gated = true; throw error; }
    return { ok: true };
  }); }
}

// A client disconnect does not cancel asynchronous filesystem/provider work.
// Keep admission busy until both the handler and the response have settled.
export function trackResponseWork(response, work, activity) {
  activity(1);
  let handlerDone = false, responseDone = false, released = false;
  const release = () => {
    if (!released && handlerDone && responseDone) { released = true; activity(-1); }
  };
  const ended = () => { responseDone = true; release(); };
  response.once("finish", ended); response.once("close", ended);
  return Promise.resolve().then(work).finally(() => { handlerDone = true; release(); });
}
