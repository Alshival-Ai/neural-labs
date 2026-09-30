import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { canonical } from "./state.mjs";
import { createNativeLauncher, NATIVE_HOME, NATIVE_WORKSPACE } from "./launcher.mjs";

// Only this supervisor writes event receipts. There is no public event ingress.
export class NativeSources {
  constructor({ state, scheduler, workspaceRoot, root, launcher = createNativeLauncher }) {
    Object.assign(this, { state, scheduler, workspaceRoot, root, launcher });
    this.children = new Map(); this.busy = null; this.stopped = false;
    state.db.prepare("UPDATE event_sources SET status='interrupted' WHERE status='running'").run();
  }
  get active() { return this.children.size; }
  async stop(id, status = "paused") {
    const entry = this.children.get(id); if (!entry) return;
    entry.stopping = true;
    await new Promise(resolve => {
      if (entry.child.exitCode !== null) return resolve();
      const timer = setTimeout(() => entry.child.kill("SIGKILL"), 2000);
      entry.child.once("close", () => { clearTimeout(timer); resolve(); }); entry.child.kill("SIGTERM");
    });
    this.children.delete(id);
    this.state.db.prepare("UPDATE event_sources SET status=? WHERE generation=?").run(status, entry.generation);
  }
  hold(job, code) {
    this.state.db.prepare("UPDATE jobs SET hold=? WHERE id=? AND source_hash=?").run(code, job.id, job.source_hash);
  }
  refresh(enabled) {
    const work = (this.busy || Promise.resolve()).catch(() => {}).then(() => this.work(enabled));
    this.busy = work;
    const clear = () => { if (this.busy === work) this.busy = null; };
    work.then(clear, clear);
    return work;
  }
  async work(enabled) {
    const jobs = this.state.db.prepare("SELECT id FROM jobs").all().map(r => this.state.job(r.id));
    for (const [id, entry] of this.children) {
      const job = this.state.job(id);
      if (!enabled || this.stopped || !job?.enabled || job.hold || job.source_hash !== entry.revision) { await this.stop(id); continue; }
      try { await entry.binding.revalidate(); }
      catch { this.hold(job, "authorization-or-policy-unavailable"); await this.stop(id, "revoked"); }
    }
    if (!enabled || this.stopped || this.scheduler.closed) return;
    for (const job of jobs) {
      const s = job.definition.schedule;
      if (!job.enabled || job.hold || job.completed || !["process", "stream"].includes(s?.kind) || this.children.has(job.id)) continue;
      const previous = this.state.db.prepare("SELECT * FROM event_sources WHERE job_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1").get(job.id);
      if (previous?.revision === job.source_hash && s.kind === "process" && previous.status !== "reviewed") {
        if (previous.status !== "exited") this.hold(job, "source-interrupted-review-required");
        continue;
      }
      if (previous && this.state.now() - previous.created_at < 5000) continue;
      try { await this.start(job); }
      catch { this.hold(job, "source-start-review-required"); }
    }
    for (const event of this.state.db.prepare("SELECT * FROM source_events WHERE consumed=0 ORDER BY created_at,rowid LIMIT 100").all()) {
      const job = this.state.job(event.job_id);
      if (!job || job.source_hash !== event.revision || !job.enabled || job.hold) continue;
      try {
        const result = await this.scheduler.launch(job.id, event.occurrence);
        if (result.accepted || result.previous || result.id) this.state.db.prepare("UPDATE source_events SET consumed=1 WHERE job_id=? AND occurrence=?").run(job.id, event.occurrence);
      } catch { /* Active/uncertain workflow locks retain the pending receipt. */ }
    }
  }
  async start(job) {
    const binding = await this.scheduler.authorize({ job, manual: false });
    const generation = randomUUID(), homeRoot = path.join(this.root, generation), s = job.definition.schedule;
    await mkdir(homeRoot, { recursive: true, mode: 0o700 });
    const launch = await this.launcher({ workspaceRoot: this.workspaceRoot, homeRoot, readOnly: job.definition.executionPolicy.sandbox === "read-only" });
    await binding.revalidate();
    const current = this.state.job(job.id);
    if (this.stopped || this.scheduler.closed || this.state.metadata("scheduling") !== "enabled" || !current.enabled || current.hold || current.source_hash !== job.source_hash) return;
    this.state.db.prepare("INSERT INTO event_sources VALUES (?,?,?,?,?,?,?,?)")
      .run(generation, job.id, job.source_hash, binding.actor, canonical({ connection: binding.connection, authorityGeneration: binding.authorityGeneration ?? 0 }), "running", this.state.now(), 0);
    const child = launch.spawn(s.command[0], s.command.slice(1), { cwd: path.posix.join(NATIVE_WORKSPACE, s.cwd || "."),
      env: { HOME: NATIVE_HOME, PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8" }, stdio: ["ignore", "pipe", "pipe"] });
    const entry = { child, generation, revision: job.source_hash, binding, stopping: false }; this.children.set(job.id, entry);
    let buffer = "", bytes = 0;
    child.stderr?.resume();
    const append = payload => {
      if (entry.stopping || this.stopped || this.state.metadata("scheduling") !== "enabled") return;
      const current = this.state.job(job.id);
      if (!current.enabled || current.hold || current.source_hash !== entry.revision) return;
      const pending = this.state.db.prepare("SELECT count(*) n,COALESCE(sum(length(payload)),0) bytes FROM source_events WHERE job_id=? AND consumed=0").get(job.id);
      if (pending.n >= 100 || pending.bytes + Buffer.byteLength(canonical(payload)) > 1048576) {
        this.hold(job, "source-overflow-review-required"); void this.stop(job.id, "overflow"); return;
      }
      this.state.transaction(() => {
        const row = this.state.db.prepare("UPDATE event_sources SET sequence=sequence+1 WHERE generation=? AND status='running' RETURNING sequence").get(generation);
        if (!row) return;
        this.state.db.prepare("INSERT OR IGNORE INTO source_events VALUES (?,?,?,?,?,?,0)")
          .run(job.id, `${s.kind}:${generation}:${row.sequence}`, entry.revision, generation, canonical(payload), this.state.now());
      });
    };
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", data => {
      if (s.kind !== "stream" || entry.stopping) return;
      buffer += data; bytes += Buffer.byteLength(data);
      if (bytes > 65536) { this.hold(job, "source-overflow-review-required"); void this.stop(job.id, "overflow"); return; }
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) { const line = buffer.slice(0, index); buffer = buffer.slice(index + 1); append({ type: "line", text: line }); }
      bytes = Buffer.byteLength(buffer);
    });
    child.once("error", () => { this.hold(job, "source-start-review-required"); entry.stopping = true; });
    child.once("close", (code, signal) => {
      if (!entry.stopping && !signal && Number.isInteger(code)) {
        if (s.kind === "process") append({ type: "exit", code });
        else if (buffer) append({ type: "line", text: buffer });
        this.state.db.prepare("UPDATE event_sources SET status='exited' WHERE generation=?").run(generation);
      } else if (!entry.stopping) {
        this.state.db.prepare("UPDATE event_sources SET status='interrupted' WHERE generation=?").run(generation);
      }
      if (this.children.get(job.id) === entry) this.children.delete(job.id);
    });
  }
  async close() { this.stopped = true; if (this.busy) await this.busy; await Promise.all([...this.children.keys()].map(id => this.stop(id))); }
}
