import { personalAgentId } from "./personal-openai.mjs";
// This bridge exposes only bounded scheduler identity/outcome metadata, never
// raw job payloads or logs, to the control-plane notification service.
export function normalizeNotificationRun(row, jobs) {
  if (row.action !== "finished" || !["ok", "error"].includes(row.status)) return undefined;
  const job = jobs.find(job => job.id === row.jobId);
  return { id: String(row.runAtMs ?? row.runId ?? row.ts), jobId: row.jobId,
    name: job?.name ?? row.jobName ?? "Automation", outcome: row.status === "ok" && row.completionStatus !== "failed" ? "success" : "failure", finishedAt: row.ts };
}
export async function notificationScheduler(request, action, input) {
  if(action === "session") {
    if(typeof input.userId!=="string" || !/^[a-f0-9-]{36}$/.test(input.userId)) throw new Error("Invalid user");
    const listed=await request("sessions.list",{agentId:personalAgentId(input.userId),archived:"all",limit:500});
    return {owned:(listed.sessions??[]).some(row=>row.key===input.sessionKey && row.visibility==='draft')};
  }
  const listed = await request("cron.list", { includeDisabled: true, limit: 200 });
  const jobs = listed.jobs ?? [];
  const raw = jobs.find(job => job.id === input.jobId);
  const job = raw ? { id: raw.id, name: raw.name, enabled: raw.enabled, currentRunId: raw.state?.runningAtMs ? String(raw.state.runningAtMs) : null } : null;
  if (action === "job") return { job };
  if (!["runs", "run"].includes(action)) throw new Error("Unknown notification action");
  const runs = [];
  for (let offset = 0; offset < 10000; offset += 200) {
    const history = await request("cron.runs", { scope: action === "run" ? "job" : "all", ...(action === "run" ? { jobId: input.jobId } : {}), limit: 200, offset, sortDir: "desc" });
    const entries = history.entries ?? [];
    for (const row of entries) {
      const run = normalizeNotificationRun(row, jobs);
      if (run && (action === "run" || run.finishedAt >= Number(input.after || 0))) runs.push(run);
    }
    if (entries.length < 200 || (action === "runs" && entries.at(-1)?.ts < Number(input.after || 0))) break;
  }
  if (action === "runs") return { runs };
  const run = runs.find(row => row.id === input.runId);
  return { job, run: run ?? (job?.currentRunId === input.runId ? { id: input.runId, jobId: job.id, running: true } : null) };
}
