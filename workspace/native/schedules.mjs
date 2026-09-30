import { identity, canonical } from "./state.mjs";

export function timezone(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_+/-]+$/.test(value)) throw new Error("Invalid schedule timezone");
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(0); }
  catch { throw new Error("Unknown schedule timezone"); }
  return value;
}

export function cronExpression(value) {
  // Accept the portable five-field calendar grammar. Unsupported legacy
  // expressions stay held for review instead of being silently rewritten.
  if (typeof value !== "string" || value.includes("\n") || value.includes("\r")) throw new Error("Invalid calendar expression");
  const fields = value.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error("Calendar schedules require five fields");
  const ranges = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
  fields.forEach((field, index) => {
    const [min, max] = ranges[index];
    for (const part of field.split(",")) {
      const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
      if (!match) throw new Error("Unsupported calendar expression");
      if (match[2] && (!Number.isSafeInteger(Number(match[2])) || Number(match[2]) < 1 || Number(match[2]) > max + 1)) throw new Error("Invalid calendar step");
      if (match[1] !== "*") {
        const bounds = match[1].split("-").map(Number);
        if (bounds.some(number => number < min || number > max) || bounds.length === 2 && bounds[0] > bounds[1]) throw new Error("Invalid calendar range");
      }
    }
  });
  return fields.join(" ");
}

// One file/process per distinct timezone avoids relying on implementation-
// dependent interpretation of repeated CRON_TZ assignments in a single file.
// Run Supercronic with -overlapping: durable workflow locks, not its process
// scheduler, decide which jobs may overlap. Prompts never enter a shell command.
export function calendarFiles(jobs, { node = "/usr/local/bin/node", runner = "/usr/local/lib/neural-labs/native/runner.mjs" } = {}) {
  if (![node, runner].every(value => typeof value === "string" && /^\/[a-zA-Z0-9_./-]+$/.test(value) && !value.split("/").includes(".."))) throw new Error("Invalid fixed runner path");
  const files = new Map();
  for (const job of jobs) {
    if (!job.enabled || job.hold || job.completed || job.classification !== "automation" || job.definition.schedule?.kind !== "cron") continue;
    const schedule = job.definition.schedule;
    const tz = timezone(schedule.tz || "UTC"), expression = cronExpression(schedule.expr);
    const lines = files.get(tz) || [`CRON_TZ=${tz}`];
    lines.push(`${expression} ${node} ${runner} ${identity(job.id)}`);
    files.set(tz, lines);
  }
  return Object.fromEntries([...files].map(([tz, lines]) => [tz, lines.join("\n") + "\n"]));
}

export function occurrenceKey(kind, instant) {
  if (!Number.isSafeInteger(instant) || instant < 0) throw new Error("Invalid occurrence time");
  return `${kind}:${instant}`;
}

export function dueOccurrence(job, { now, previousCheck = now, event } = {}) {
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(previousCheck) || previousCheck > now) throw new Error("Invalid scheduler clock");
  if (!job.enabled || job.hold || job.completed || job.classification !== "automation") return null;
  const schedule = job.definition.schedule;
  const missed = job.definition.missedRunPolicy ?? "skip";
  if (!["skip", "run-once"].includes(missed)) throw new Error("Imported missed-run policy requires review");
  if (schedule.kind === "at") {
    const instant = Date.parse(schedule.at);
    if (!Number.isSafeInteger(instant)) throw new Error("Invalid one-time schedule");
    return instant <= now && (instant > previousCheck || instant === now || missed === "run-once") ? occurrenceKey("at", instant) : null;
  }
  if (schedule.kind === "every") {
    if (!Number.isSafeInteger(schedule.everyMs) || schedule.everyMs < 1 || !Number.isSafeInteger(schedule.anchorMs) || schedule.anchorMs < 0) throw new Error("Interval schedules require a positive interval and persistent anchor");
    const slot = Math.floor((now - schedule.anchorMs) / schedule.everyMs);
    if (slot < 0) return null;
    const instant = schedule.anchorMs + slot * schedule.everyMs;
    return instant > previousCheck || instant === now || missed === "run-once" ? occurrenceKey("every", instant) : null;
  }
  if (["process", "stream"].includes(schedule.kind)) {
    // Events must come from the authenticated process/stream source, never the
    // browser. Source generation makes restart and duplicate callbacks stable.
    if (!event || event.kind !== schedule.kind || event.source !== schedule.source) return null;
    identity(event.generation); identity(event.id);
    if (schedule.kind === "process" && event.type !== "exit") return null;
    return `${schedule.kind}:${event.generation}:${event.id}`;
  }
  if (schedule.kind === "cron") return null; // Supercronic supplies calendar occurrences.
  throw new Error("Unsupported schedule trigger");
}

function matchesField(expression, value, max, min = 0) {
  return expression.split(",").some(part => {
    const [range, stepText] = part.split("/"); const step = Number(stepText || 1);
    const [start, end] = range === "*" ? [min, max] : range.includes("-") ? range.split("-").map(Number) : [Number(range), stepText ? max : Number(range)];
    return value >= start && value <= end && (value - start) % step === 0;
  });
}
export function calendarOccurrence(schedule, now) {
  const expression = cronExpression(schedule.expr).split(" "), tz = timezone(schedule.tz || "UTC");
  const fields = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23",
    minute: "numeric", hour: "numeric", day: "numeric", month: "numeric", weekday: "short" }).formatToParts(now).map(row => [row.type, row.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(fields.weekday);
  const dom = matchesField(expression[2], Number(fields.day), 31, 1), dow = matchesField(expression[4], weekday, 7) || weekday === 0 && matchesField(expression[4], 7, 7);
  const dayMatches = expression[2] === "*" || expression[4] === "*" ? dom && dow : dom || dow;
  if (!matchesField(expression[0], Number(fields.minute), 59) || !matchesField(expression[1], Number(fields.hour), 23)
      || !matchesField(expression[3], Number(fields.month), 12, 1) || !dayMatches) return null;
  // Epoch minutes distinguish the repeated hour at DST fall-back and cannot
  // invent a nonexistent wall-clock minute at spring-forward.
  return occurrenceKey("cron", Math.floor(now / 60000) * 60000);
}

export function manualScheduleOccurrence(job, now) {
  if (!job.enabled || job.completed || job.hold || job.classification !== "automation") return null;
  const schedule = job.definition.schedule;
  if (schedule.kind === "cron") return calendarOccurrence(schedule, now);
  if (schedule.kind === "at") {
    const instant = Date.parse(schedule.at);
    return Number.isSafeInteger(instant) && instant <= now ? occurrenceKey("at", instant) : null;
  }
  if (schedule.kind === "every") {
    if (!Number.isSafeInteger(schedule.anchorMs) || !Number.isSafeInteger(schedule.everyMs) || schedule.everyMs < 1) throw new Error("Invalid interval schedule");
    const slot = Math.floor((now - schedule.anchorMs) / schedule.everyMs);
    return slot >= 0 ? occurrenceKey("every", schedule.anchorMs + slot * schedule.everyMs) : null;
  }
  // An explicit force run is available for event-driven jobs. The browser
  // cannot fabricate a pending process-exit or stream occurrence.
  return null;
}

export class NativeScheduler {
  constructor({ state, authorize, execute, now = Date.now }) {
    this.state = state; this.authorize = authorize; this.execute = execute; this.now = now;
    this.active = new Map(); this.closed = false;
  }
  async launch(jobId, occurrence, { actor, connection, manual = false, mode = "force", requestId } = {}) {
    if (this.closed) throw new Error("Native scheduler admission is closed");
    if (manual && !["force", "due", "if-enabled"].includes(mode)) throw new Error("Invalid manual run mode");
    if (manual && mode !== "force" && !requestId) throw new Error("A manual run request identity is required");
    const job = this.state.job(jobId);
    if (!job) throw new Error("Automation not found");
    let sourceEvent;
    if (!manual && ["process", "stream"].includes(job.definition.schedule.kind)) {
      const event = sourceEvent = this.state.db.prepare(`SELECT e.*,s.actor,s.binding FROM source_events e JOIN event_sources s ON s.generation=e.generation
        WHERE e.job_id=? AND e.occurrence=?`).get(jobId, occurrence);
      if (!event || event.revision !== job.source_hash || event.actor !== job.definition.actor
          || canonical(JSON.parse(event.binding).connection) !== canonical(job.definition.connection)) throw new Error("Untrusted event source");
    }
    let binding;
    try {
      binding = await this.authorize({ job, actor, connection, manual });
      if (sourceEvent && JSON.parse(sourceEvent.binding).authorityGeneration !== (binding.authorityGeneration ?? 0)) throw new Error("Source authority generation changed");
    }
    catch (error) {
      if (manual) throw error;
      // No provider has started. Retain a visible blocked receipt and a hold,
      // without changing the desired enabled state or retrying this occurrence.
      return this.state.blockOccurrence({ jobId, occurrence, expectedDefinitionHash: job.source_hash });
    }
    if (this.closed) throw new Error("Native scheduler admission is closed");
    // authorize resolves membership, background grant, and the *saved* account
    // for scheduled work; it must never select a fallback account or provider.
    const claim = this.state.claim({ jobId, occurrence, actor: binding.actor, connection: binding.connection,
      manual, manualMode: mode, manualRequestId: requestId,
      dueOccurrence: manual && mode === "due" ? manualScheduleOccurrence(job, this.now()) : null,
      workflowKey: job.definition.workflowLock || null, expectedDefinitionHash: job.source_hash });
    if (!claim.accepted) return claim;
    const run = Promise.resolve().then(async () => {
      try {
        // Recheck the lease after the durable claim and immediately before spawn.
        await binding.revalidate();
        this.state.startRun(claim.id);
        const outcome = await this.execute({ id: claim.id, job, binding, manual });
        this.state.finishRun(claim.id, outcome.status, outcome.result);
      } catch {
        // A thrown transport error cannot prove whether execution had effects.
        const row = this.state.db.prepare("SELECT status FROM occurrences WHERE id=?").get(claim.id);
        if (row?.status === "claimed") this.state.finishRun(claim.id, "blocked", { code: "authorization-unavailable" });
        else if (row?.status === "running") this.state.finishRun(claim.id, "unknown", { code: "execution-outcome-unknown" });
      }
    }).finally(() => this.active.delete(claim.id));
    this.active.set(claim.id, run);
    return claim;
  }
  async drain() { await Promise.all(this.active.values()); }
}
