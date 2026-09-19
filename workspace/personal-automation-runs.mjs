import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { personalAgentId } from "./personal-openai.mjs";
import { notificationScheduler } from "./notification-scheduler.mjs";

export class AutomationRunError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Public scheduler APIs have no per-run agent override. Keep disabled isolated
// execution jobs and a durable parent link instead of mutating a live schedule.
export class PersonalAutomationRuns {
  constructor({ root, request, accounts, now = Date.now }) {
    this.file = path.join(root, "personal-automation-runs.json");
    this.request = request;
    this.accounts = accounts;
    this.now = now;
    this.tail = Promise.resolve();
  }

  async records() {
    try {
      const value = JSON.parse(await readFile(this.file, "utf8"));
      if (!Array.isArray(value)) throw new Error("Invalid manual-run registry");
      return value;
    } catch (error) { if (error.code === "ENOENT") return []; throw error; }
  }

  async save(records) {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    await writeFile(`${this.file}.tmp`, JSON.stringify(records), { mode: 0o600 });
    await rename(`${this.file}.tmp`, this.file);
  }

  async jobs() {
    const jobs = [];
    for (let offset = 0; offset < 10000; offset += 200) {
      const page = await this.request("cron.list", { includeDisabled: true, limit: 200, offset });
      jobs.push(...(page.jobs ?? []));
      if (!page.hasMore && (page.jobs?.length ?? 0) < 200) return jobs;
      if (page.hasMore === false) return jobs;
    }
    throw new Error("Scheduler inventory exceeds the supported limit");
  }

  async linkedRecords(jobs) {
    return (await this.records()).map(record => ({ ...record,
      childId: record.childId ?? jobs.find(job => job.declarationKey === record.declarationKey)?.id,
    }));
  }

  run(actor, input) {
    const operation = this.tail.then(() => this.runOnce(actor, input));
    this.tail = operation.catch(() => {});
    return operation;
  }

  async runOnce(actor, { jobId, mode = "force", requestId } = {}) {
    if (!actor?.userId || !["admin", "user"].includes(actor.role)) throw new AutomationRunError(403, "Workspace membership is required");
    if (typeof jobId !== "string" || !/^[a-zA-Z0-9-]{1,200}$/.test(jobId)
        || !/^[a-f0-9-]{36}$/.test(requestId ?? "") || !["force", "due", "if-enabled"].includes(mode)) {
      throw new AutomationRunError(422, "Invalid automation run request");
    }
    const jobs = await this.jobs();
    const records = await this.linkedRecords(jobs);
    const previous = records.find(row => row.requestId === requestId);
    if (previous) {
      if (previous.userId !== actor.userId || previous.jobId !== jobId) throw new AutomationRunError(409, "Run request identity conflicts");
      if (previous.phase !== "submitted") throw new AutomationRunError(409, "Run acceptance is uncertain. Inspect the run before retrying.");
      return { accepted: true, agentId: previous.agentId, executionJobId: previous.childId };
    }
    const job = jobs.find(row => row.id === jobId);
    if (!job || records.some(row => row.childId === jobId)) throw new AutomationRunError(404, "Automation not found");
    if (job.payload?.kind !== "agentTurn") throw new AutomationRunError(409, "Personal Run Now supports AI task automations only; system and command jobs keep their existing execution controls.");
    if (job.scheduledToolPolicy && job.scheduledToolPolicy.mode !== "trusted") {
      throw new AutomationRunError(409, "This automation's restricted execution policy cannot be transferred to a personal run");
    }
    if (mode !== "force" && !job.enabled) throw new AutomationRunError(409, "This automation is paused");
    if (mode === "due" && !(Number.isFinite(job.state?.nextRunAtMs) && job.state.nextRunAtMs <= this.now())) {
      throw new AutomationRunError(409, "This automation is not due");
    }
    if (job.state?.runningAtMs) throw new AutomationRunError(409, "This automation is already running");
    for (const record of records.filter(row => row.jobId === jobId)) {
      const child = jobs.find(row => row.id === record.childId);
      if (!child?.state?.lastRunAtMs || child.state.runningAtMs) {
        throw new AutomationRunError(409, "A manual run is active or its acceptance is uncertain. Inspect it before starting another.");
      }
    }
    let agentId, selectedModel = job.payload.model;
    try {
      if (this.accounts.prepareExecution) ({ agentId, model: selectedModel } = await this.accounts.prepareExecution(actor.userId, job.payload.model));
      else agentId = await this.accounts.prepareRun(actor.userId, job.payload.model);
    }
    catch { throw new AutomationRunError(409, "Connect or resume your selected model account in Settings → Model Provider before running this automation."); }
    if (agentId !== personalAgentId(actor.userId)) throw new AutomationRunError(409, "The connected account does not belong to the signed-in user");
    const record = { requestId, declarationKey: `neural-labs-manual:${requestId}`, jobId, userId: actor.userId,
      actorLabel: actor.email || actor.userId, agentId, phase: "preparing", createdAt: this.now() };
    records.push(record);
    await this.save(records);
    const definition = {
      name: `${job.name} · manual`, declarationKey: record.declarationKey,
      description: "Personal manual execution; managed by Neural Labs.",
      agentId, enabled: false, deleteAfterRun: false,
      schedule: { kind: "at", at: new Date(this.now() + 86400000).toISOString() },
      sessionTarget: "isolated", wakeMode: "now",
      payload: { ...job.payload, ...(selectedModel ? { model: selectedModel } : {}), fallbacks: [], message: `${job.payload.message}\n\nManual execution of automation ${jobId}. For get_automation_notification_context and notify_workspace_user use automation ID ${jobId} and the current run ID from that context. Preserve the original automation's project checkpoints and locking. Do not change its schedule or account.` },
      delivery: job.delivery ?? { mode: "none" },
    };
    try {
      const result = await this.request("cron.add", definition);
      record.childId = result.id ?? result.job?.id;
      if (!record.childId) throw new Error("Missing execution identity");
      // The execution identity disambiguates notification context if a regular
      // scheduled run overlaps. The notification bridge resolves subscribers
      // through the durable parent link, never through copied subscriptions.
      await this.request("cron.update", { id: record.childId, patch: { payload: { ...definition.payload,
        message: `${job.payload.message.replaceAll(jobId, record.childId)}\n\nThis is a personal manual run of parent automation ${jobId}. For get_automation_notification_context and notify_workspace_user use execution automation ID ${record.childId} and its current run ID. The server resolves the parent's subscribers. Preserve the parent's project checkpoints and locking. Do not change its schedule or account.`,
      } } });
      record.phase = "ready";
      await this.save(records);
      const resultRun = await this.request("cron.run", { id: record.childId, mode: "force" });
      if (resultRun?.ran === false || resultRun?.ok === false) throw new Error("Run was not accepted");
      record.phase = "submitted";
      await this.save(records);
      return { accepted: true, agentId, executionJobId: record.childId };
    } catch {
      // Never delete a possibly accepted execution or retry it automatically.
      throw new AutomationRunError(503, "Run acceptance is uncertain. Refresh and inspect the automation before retrying.");
    }
  }

  async project(jobs, entries) {
    const records = await this.linkedRecords(jobs);
    const links = new Map(records.filter(row => row.childId).map(row => [row.childId, row]));
    const projectedJobs = jobs.filter(job => !links.has(job.id)).map(job => {
      const children = records.filter(row => row.jobId === job.id).map(row => ({ record: row, job: jobs.find(child => child.id === row.childId) }));
      const active = children.find(child => child.job?.state?.runningAtMs);
      const uncertain = children.find(child => !child.job?.state?.lastRunAtMs && !child.job?.state?.runningAtMs);
      const latest = children.filter(child => child.job?.state?.lastRunAtMs).sort((a, b) => b.job.state.lastRunAtMs - a.job.state.lastRunAtMs)[0];
      const recentState = latest && latest.job.state.lastRunAtMs > (job.state?.lastRunAtMs ?? 0)
        ? { lastRunAtMs: latest.job.state.lastRunAtMs, lastRunStatus: latest.job.state.lastRunStatus } : {};
      return { ...job, state: { ...job.state, ...recentState,
        ...(active && !job.state?.runningAtMs ? { runningAtMs: active.job.state.runningAtMs } : {}),
      },
        ...(uncertain ? { manualRunWarning: "A manual run is pending or uncertain. Inspect execution history before retrying." } : {}) };
    });
    return { jobs: projectedJobs, entries: entries.map(entry => {
      const link = links.get(entry.jobId);
      return link ? { ...entry, jobId: link.jobId, executionJobId: entry.jobId, triggeredBy: link.actorLabel,
        summary: `Run by ${link.actorLabel} using their selected model account.\n${entry.summary ?? ""}` } : entry;
    }) };
  }

  async notification(action, input) {
    if (action === "session") return notificationScheduler(this.request, action, input);
    const jobs = await this.jobs();
    const link = (await this.linkedRecords(jobs)).find(row => row.childId === input.jobId);
    if (!link) return notificationScheduler(this.schedulerRequest.bind(this), action, input);
    const result = await notificationScheduler(this.request, action, input);
    const parent = jobs.find(job => job.id === link.jobId);
    if (!parent) return { job: null, run: null };
    return { ...result,
      job: result.job ? { ...result.job, id: parent.id, name: parent.name } : null,
      ...(result.run ? { run: { ...result.run, jobId: parent.id } } : {}),
    };
  }

  // Used by notifications as well as the UI: child results belong to the
  // parent's subscription identity, while transcripts stay with the actor.
  async schedulerRequest(method, params) {
    if (!["cron.list", "cron.runs"].includes(method)) return this.request(method, params);
    const jobs = await this.jobs();
    if (method === "cron.list") return { ...(await this.project(jobs, [])), hasMore: false };
    const records = await this.linkedRecords(jobs);
    const children = records.filter(row => row.jobId === (params.jobId ?? params.id));
    if (params.scope === "job" && children.length) {
      const entries = [];
      for (const id of [params.jobId ?? params.id, ...children.map(row => row.childId).filter(Boolean)]) {
        // Query the same bounded prefix for each execution before merging pages.
        for (let offset = 0; offset < (params.offset ?? 0) + (params.limit ?? 200); offset += 200) {
          const page = await this.request(method, { ...params, jobId: id, offset, limit: 200 });
          entries.push(...(page.entries ?? []));
          if ((page.entries?.length ?? 0) < 200) break;
        }
      }
      entries.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
      const projected = await this.project(jobs, entries);
      return { entries: projected.entries.slice(params.offset ?? 0, (params.offset ?? 0) + (params.limit ?? 200)) };
    }
    const page = await this.request(method, params);
    return { ...page, entries: (await this.project(jobs, page.entries ?? [])).entries };
  }

  async snapshot(actor) {
    const [status, jobs, history] = await Promise.all([
      this.request("cron.status", {}), this.jobs(),
      this.request("cron.runs", { scope: "all", limit: 200, sortDir: "desc" }),
    ]);
    const projected = await this.project(jobs, history.entries ?? []);
    if (actor?.role === "user") {
      // Members see shared operational state, never another caller's transcript
      // or the scheduler's administrative payload and delivery configuration.
      return { status: { enabled: status?.enabled }, jobs: projected.jobs.map(job => ({
        id: job.id, name: job.name, enabled: job.enabled,
        schedule: { kind: job.schedule?.kind, at: job.schedule?.at,
          everyMs: job.schedule?.everyMs, expr: job.schedule?.expr, tz: job.schedule?.tz },
        state: { runningAtMs: job.state?.runningAtMs, nextRunAtMs: job.state?.nextRunAtMs,
          lastRunAtMs: job.state?.lastRunAtMs, lastRunStatus: job.state?.lastRunStatus },
        manualRunWarning: job.manualRunWarning,
        payload: { kind: job.payload?.kind },
      })), entries: projected.entries.map(entry => ({
        jobId: entry.jobId, status: entry.status, action: entry.action,
        ts: entry.ts, runAtMs: entry.runAtMs, durationMs: entry.durationMs,
      })) };
    }
    return { status, ...projected };
  }
}
