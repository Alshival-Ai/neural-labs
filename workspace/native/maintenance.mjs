// Called before any trigger or ingress starts. Existing native state without an
// installation marker needs operator review; an empty rehearsal is not evidence
// that a retained workspace has completed migration.
export function initializeNativeInstallation(state, { legacyState = false } = {}) {
  return state.transaction(() => {
    const kind = state.metadata("installation");
    if (kind) return kind;
    const occupied = ["migrations", "jobs", "conversations", "retained_records"].some(table =>
      Boolean(state.db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()));
    if (legacyState || occupied || state.metadata("maintenance")) return "unverified";
    state.setMetadata("installation", "fresh");
    state.setMetadata("scheduling", "enabled"); state.setMetadata("delivery", "enabled");
    return "fresh";
  });
}

export function nativePreservationReady(state, { legacyState = false } = {}) {
  const imports = state.db.prepare("SELECT phase FROM migrations").all();
  if (!legacyState && !imports.length && state.metadata("installation") === "fresh") return true;
  return state.metadata("activation") === "verified" && imports.length > 0 && imports.every(row => row.phase === "verified");
}

export class NativeMaintenance {
  constructor({ runtime, probation = false, readiness = async () => false }) {
    this.runtime = runtime; this.probation = probation; this.readiness = readiness;
    this.gated = probation || Boolean(runtime.state.metadata("maintenance"));
    this.tail = Promise.resolve();
    this.localActivity = () => ({ terminals: 0, writes: 0, editors: 0, fileJobs: 0 });
    if (this.gated) { runtime.turns.gated = true; runtime.scheduler.closed = true; }
  }
  exclusive(work) { const next = this.tail.then(work); this.tail = next.catch(() => {}); return next; }
  async activity() {
    const state = this.runtime.state;
    const chatRuns = state.db.prepare("SELECT count(*) AS n FROM turns WHERE status IN ('running','unknown')").get().n;
    const cronRuns = state.db.prepare("SELECT count(*) AS n FROM occurrences WHERE status IN ('claimed','running','unknown')").get().n;
    const activity = { ...this.localActivity(), chatRuns, cronRuns, tasks: this.runtime.scheduler.active.size,
      background: this.runtime.accounts.logins?.size || 0 };
    if (Object.values(activity).some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error("Native activity cannot be verified");
    return { protocol: 1, probation: this.probation, gated: this.gated, activity,
      eligible: await this.readiness(), idle: Object.values(activity).every(value => value === 0) };
  }
  pause() { return this.exclusive(async () => {
    this.gated = true; this.runtime.turns.gated = true; this.runtime.scheduler.closed = true;
    this.runtime.state.transaction(() => {
      if (!this.runtime.state.metadata("maintenance")) this.runtime.state.setMetadata("maintenance", JSON.stringify({
        scheduling: this.runtime.state.metadata("scheduling"), delivery: this.runtime.state.metadata("delivery"),
      }));
      this.runtime.state.setMetadata("scheduling", "disabled"); this.runtime.state.setMetadata("delivery", "disabled");
    });
    await this.runtime.triggers?.refresh();
    return this.activity();
  }); }
  resume() { return this.exclusive(async () => {
    if (this.probation || !await this.readiness()) throw new Error("Native activation readiness is unavailable");
    const state = this.runtime.state;
    const stored = state.metadata("maintenance"), ledger = stored ? JSON.parse(stored) : null;
    if (ledger && (!["enabled", "disabled"].includes(ledger.scheduling) || !["enabled", "disabled"].includes(ledger.delivery))) throw new Error("Invalid maintenance recovery state");
    try {
      state.transaction(() => {
        if (ledger) { state.setMetadata("scheduling", ledger.scheduling); state.setMetadata("delivery", ledger.delivery); }
      });
      // The host sends resume only after its durable activation decision. A
      // failed scheduler refresh retains the ledger and closes every ingress.
      await this.runtime.triggers?.refresh();
      state.db.prepare("DELETE FROM metadata WHERE key='maintenance'").run();
      this.runtime.scheduler.closed = false; this.runtime.turns.gated = false; this.gated = false;
      return { ok: true };
    } catch (error) {
      state.setMetadata("scheduling", "disabled"); state.setMetadata("delivery", "disabled");
      this.runtime.scheduler.closed = true; this.runtime.turns.gated = true; this.gated = true;
      throw error;
    }
  }); }
}
