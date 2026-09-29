import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { chmod, mkdir, writeFile, rename, rm, lstat, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { calendarFiles, dueOccurrence, calendarOccurrence } from "./schedules.mjs";
import { identity } from "./state.mjs";
import release from "./release.json" with { type: "json" };

export { calendarOccurrence } from "./schedules.mjs";

export class NativeTriggerLoop {
  constructor({ state, scheduler, root, supercronic = "/usr/local/bin/supercronic", spawnProcess = spawn, now = Date.now, runnerPaths }) {
    this.runnerPaths = runnerPaths;
    this.state = state; this.scheduler = scheduler; this.root = root; this.supercronic = supercronic;
    this.spawn = spawnProcess; this.now = now; this.processes = new Map(); this.pending = new Set();
    this.previous = now(); this.closed = true; this.lastError = null;
    this.retries = new Map(); this.refreshing = null; this.refreshAgain = false;
    this.socketPath = path.join(root, "scheduler.sock");
  }
  jobs() { return this.state.db.prepare("SELECT id FROM jobs").all().map(row => this.state.job(row.id)); }
  get enabled() { return !this.closed && this.state.metadata("scheduling") === "enabled"; }
  status() {
    const expected = this.enabled ? Object.keys(calendarFiles(this.jobs(), this.runnerPaths)) : [];
    return { enabled: this.enabled, ready: expected.every(tz => this.processes.has(tz)),
      calendarProcesses: this.processes.size, error: this.lastError };
  }
  track(work) { const promise = Promise.resolve(work).catch(() => { this.lastError = "A trigger could not be admitted"; }).finally(() => this.pending.delete(promise)); this.pending.add(promise); return promise; }
  async start() {
    if (!this.closed) return;
    const arch = { x64: "amd64", arm64: "arm64" }[process.arch];
    const sha = createHash("sha256").update(await readFile(this.supercronic)).digest("hex");
    if (!arch || sha !== release.supercronic.sha256[arch]) throw new Error("Supercronic does not match the reviewed native release");
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    if (Buffer.byteLength(this.socketPath) > 100) throw new Error("Native scheduler socket path is too long");
    try {
      if (!(await lstat(this.socketPath)).isSocket()) throw new Error("Scheduler socket path is occupied by a retained file");
      // The caller must own the exclusive runtime lease before start/recovery.
      await rm(this.socketPath);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    this.server = createServer(socket => {
      let buffer = "", admitted = false;
      socket.setTimeout(10000, () => socket.destroy()); socket.on("error", () => {});
      socket.on("data", data => {
        if (admitted) { socket.destroy(); return; }
        buffer += data;
        if (Buffer.byteLength(buffer) > 1024) { socket.destroy(); return; }
        if (!buffer.includes("\n")) return;
        admitted = true;
        this.track((async () => {
          try {
            const input = JSON.parse(buffer); identity(input.jobId);
            if (Object.keys(input).length !== 1 || !this.enabled) throw new Error("Scheduling is gated");
            const job = this.state.job(input.jobId);
            if (!job || job.definition.schedule?.kind !== "cron") throw new Error("Unknown calendar job");
            const occurrence = calendarOccurrence(job.definition.schedule, this.now());
            if (!occurrence) throw new Error("Calendar occurrence is outside its schedule");
            const result = await this.scheduler.launch(job.id, occurrence);
            socket.end(JSON.stringify({ accepted: result.accepted, id: result.id ?? result.previous?.id }) + "\n");
          } catch { socket.end(JSON.stringify({ error: "Calendar occurrence could not be admitted" }) + "\n"); }
        })());
      });
    });
    await new Promise((resolve, reject) => { this.server.once("error", reject); this.server.listen(this.socketPath, resolve); });
    this.ownsSocket = true;
    await chmod(this.socketPath, 0o600);
    this.closed = false; this.previous = this.now();
    await this.refresh();
    this.timer = setInterval(() => this.tick(), 1000); this.timer.unref();
  }
  async refresh() {
    this.refreshAgain = true;
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      do { this.refreshAgain = false; await this.refreshProcesses(); } while (this.refreshAgain && !this.closed);
    })().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }
  async refreshProcesses() {
    const files = this.enabled ? calendarFiles(this.jobs(), this.runnerPaths) : {};
    for (const [tz, child] of this.processes) if (!Object.hasOwn(files, tz)) { this.processes.delete(tz); child.kill("SIGTERM"); }
    for (const tz of this.retries.keys()) if (!Object.hasOwn(files, tz)) this.retries.delete(tz);
    for (const [tz, content] of Object.entries(files)) {
      const name = createHash("sha256").update(tz).digest("hex").slice(0, 20), filename = path.join(this.root, `${name}.cron`);
      const previous = await readFile(filename, "utf8").catch(error => { if (error.code === "ENOENT") return null; throw error; });
      if (previous !== content) { await writeFile(`${filename}.next`, content, { mode: 0o600 }); await rename(`${filename}.next`, filename); }
      const running = this.processes.get(tz);
      if (running) { if (previous !== content) running.kill("SIGUSR2"); continue; }
      if (!this.enabled || (this.retries.get(tz)?.at || 0) > this.now()) continue;
      const child = this.spawn(this.supercronic, ["-overlapping", "-quiet", filename], {
        stdio: ["ignore", "ignore", "pipe"], env: { PATH: "/usr/local/bin:/usr/bin:/bin", TZ: tz, NEURAL_LABS_SCHEDULER_SOCKET: this.socketPath },
      });
      child.stderr.resume(); this.processes.set(tz, child);
      const failed = () => {
        if (this.processes.get(tz) !== child) return;
        this.processes.delete(tz); this.lastError = "Calendar scheduler stopped; restart pending";
        const attempts = (this.retries.get(tz)?.attempts || 0) + 1;
        this.retries.set(tz, { attempts, at: this.now() + Math.min(60000, 1000 * 2 ** Math.min(attempts, 6)) });
      };
      child.once("error", failed); child.once("exit", failed);
    }
  }
  tick() {
    const now = this.now(), previousCheck = Math.min(this.previous, now); this.previous = now;
    if (!this.enabled) return;
    if (!this.status().ready && !this.refreshing) this.track(this.refresh());
    for (const job of this.jobs()) {
      try {
        const occurrence = dueOccurrence(job, { now, previousCheck });
        if (occurrence) this.track(this.scheduler.launch(job.id, occurrence));
      } catch { this.lastError = "An automation schedule requires review"; }
    }
    this.state.setMetadata("scheduler-last-check", String(now));
  }
  event(event) {
    if (!this.enabled) return;
    for (const job of this.jobs()) {
      const occurrence = dueOccurrence(job, { now: this.now(), event });
      if (occurrence) this.track(this.scheduler.launch(job.id, occurrence));
    }
  }
  async close() {
    this.closed = true; clearInterval(this.timer);
    if (this.refreshing) await this.refreshing.catch(() => {});
    const children = [...this.processes.values()]; this.processes.clear();
    await Promise.all(children.map(child => new Promise(resolve => {
      if (child.exitCode !== null) { resolve(); return; }
      const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 2000);
      child.once("exit", () => { clearTimeout(timer); resolve(); }); child.kill("SIGTERM");
    })));
    if (this.server) await new Promise(resolve => this.server.close(resolve));
    await Promise.all(this.pending); await this.scheduler.drain();
    if (this.ownsSocket) { await rm(this.socketPath, { force: true }); this.ownsSocket = false; }
  }
}
