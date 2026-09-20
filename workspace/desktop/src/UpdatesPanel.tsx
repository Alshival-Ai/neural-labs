import { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { settingsRequest } from "./settingsApi";

export type UpdatePolicy = { openclawAutomatic: boolean; codexAutomatic: boolean; days: number[]; start: string; end: string; timezone: string };
export type UpdateStatus = {
  revision: number; policy: UpdatePolicy; maintenance: boolean;
  available: { id: string; openclawVersion: string; codexVersion: string; notesUrl: string; manualRequired: boolean; reason: string } | null;
  installed: { openclawVersion: string; codexVersion: string } | null;
  codex: { version: string; lastCheck: string | null; result: string; message: string } | null;
  worker: { connected: boolean; lastSeen: string | null; lastCheck: string | null; error: string | null };
  jobs: { id: string; kind: string; phase: string; message: string; release_id: string | null; created_at: string; updated_at: string }[];
};
const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const dateLabel = (value: string | null) => value ? new Date(value).toLocaleString() : "Not yet";
const phaseLabel = (value: string) => value.replaceAll("_", " ").replace(/^./, c => c.toUpperCase());

export function nextWindow(policy: UpdatePolicy, now = new Date()) {
  const format = new Intl.DateTimeFormat("en-US", { timeZone: policy.timezone, weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  // Scan real instants, rather than adding local days, so DST skips/repeats are handled.
  for (let offset = 0; offset < 8 * 24 * 60; offset++) {
    const date = new Date(now.getTime() + offset * 60_000);
    const parts = Object.fromEntries(format.formatToParts(date).map(p => [p.type, p.value]));
    const time = `${parts.hour}:${parts.minute}`;
    if (policy.days.includes(dayNames.indexOf(parts.weekday ?? "")) && time >= policy.start && time < policy.end) return date;
  }
  return null;
}

export function UpdatesPanel({ csrfToken }: { csrfToken: string }) {
  const [status, setStatus] = useState<UpdateStatus>();
  const [draft, setDraft] = useState<UpdatePolicy>();
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const refresh = useCallback(async () => {
    const next = await settingsRequest<UpdateStatus>("/api/admin/updates");
    setStatus(next);
    return next;
  }, []);
  useEffect(() => {
    let live = true;
    const load = () => void refresh().catch(() => { if (live) setError("Update status is unavailable. The page will retry."); });
    load(); const timer = window.setInterval(load, 5000);
    return () => { live = false; window.clearInterval(timer); };
  }, [refresh]);
  useEffect(() => { if (status && !dirty) { setDraft(status.policy); setRevision(status.revision); } }, [status, dirty]);
  const edit = (change: Partial<UpdatePolicy>) => { setDraft(value => value ? { ...value, ...change } : value); setDirty(true); setNotice(""); };
  const save = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      await settingsRequest("/api/admin/updates", { method: "PUT", headers: { "X-CSRF-Token": csrfToken }, body: JSON.stringify({ revision, policy: draft }) });
      await refresh(); setDirty(false); setNotice("Update settings saved.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save settings."); } finally { setBusy(false); }
  };
  const action = async (kind: "check" | "install") => {
    setBusy(true); setError("");
    try {
      await settingsRequest(`/api/admin/updates/${kind}`, { method: "POST", headers: { "X-CSRF-Token": csrfToken }, body: "{}" });
      setNotice(kind === "check" ? "Release check queued." : "Installation queued. It will wait until the workspace is idle."); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not queue the update."); } finally { setBusy(false); }
  };
  if (!status || !draft) return <div className="settings-panel" role="status">{error || "Loading update settings…"}</div>;
  let next: Date | null = null;
  try { next = nextWindow(status.policy); } catch { /* invalid edits are rejected by the server */ }
  const active = status.jobs.find(j => !["succeeded", "restored", "failed", "recovery_required", "cancelled"].includes(j.phase));
  return <div className="settings-panel">
    <div className="settings-section-header"><div><span><Download />Workspace updates</span><h1>Updates</h1><p>Choose when reviewed OpenClaw releases and terminal Codex updates are installed.</p></div></div>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {status.maintenance && <section className="settings-card" role="status"><h2>Workspace maintenance</h2><p>{active?.message || "Deployment or recovery is in progress. Workspace access will reopen after verification."}</p></section>}
    <section className="settings-card">
      <div className="settings-card__heading"><div><span>OpenClaw</span><h2>Reviewed workspace releases</h2><p>Updates include matching integrations and a recovery backup. Installation requires a workspace restart.</p></div></div>
      <label className="updates-toggle"><input type="checkbox" checked={draft.openclawAutomatic} onChange={e => edit({ openclawAutomatic: e.target.checked })} />Automatically install reviewed OpenClaw releases</label>
      <dl className="settings-detail-list"><div><dt>Installed</dt><dd>{status.installed?.openclawVersion ?? "Waiting for host updater"}</dd></div><div><dt>Available</dt><dd>{status.available?.openclawVersion ?? "No reviewed update found"}</dd></div><div><dt>Last release check</dt><dd>{dateLabel(status.worker.lastCheck)}</dd></div><div><dt>Host updater</dt><dd>{status.worker.connected ? "Connected" : "Offline or not installed"}</dd></div></dl>
      {!status.worker.connected && <p>The operator must install or reconnect the host updater before OpenClaw updates can run.</p>}
      {status.worker.error && <p role="alert">{status.worker.error}</p>}
      {status.available?.manualRequired && <p role="status">Manual upgrade required: {status.available.reason}</p>}
      {status.available && <p><a href={status.available.notesUrl} target="_blank" rel="noreferrer">Read release notes</a></p>}
      <div className="updates-actions"><button className="settings-button" disabled={busy || !!active || !status.worker.connected || status.maintenance} onClick={() => void action("check")}><RefreshCw />Check now</button><button className="settings-button is-primary" disabled={busy || !!active || !status.worker.connected || !status.available || status.available.manualRequired || status.maintenance} onClick={() => void action("install")}><Download />Install now when idle</button></div>
    </section>
    <section className="settings-card"><h2>Maintenance window</h2><p>Automatic installation waits for this window and for all terminal sessions to close. Active chats, jobs, uploads, and editor connections also defer installation.</p>
      <fieldset className="updates-days"><legend>Days</legend>{dayNames.map((name, day) => <label key={name}><input type="checkbox" checked={draft.days.includes(day)} onChange={e => edit({ days: e.target.checked ? [...draft.days, day].sort() : draft.days.filter(d => d !== day) })} />{name}</label>)}</fieldset>
      <div className="updates-window"><label>Start<input type="time" value={draft.start} onChange={e => edit({ start: e.target.value })} /></label><label>End<input type="time" value={draft.end} onChange={e => edit({ end: e.target.value })} /></label><label>Timezone<input value={draft.timezone} onChange={e => edit({ timezone: e.target.value })} placeholder="America/Chicago" /></label></div>
      <p>Next saved window: {next ? next.toLocaleString(undefined, { timeZone: status.policy.timezone }) : "Unavailable"} ({status.policy.timezone}). A busy workspace is never forced to restart.</p>
    </section>
    <section className="settings-card"><h2>Terminal Codex</h2><label className="updates-toggle"><input type="checkbox" checked={draft.codexAutomatic} onChange={e => edit({ codexAutomatic: e.target.checked })} />Automatically install stable terminal Codex updates daily</label><p>New Codex launches use the updated version. Running sessions continue without a workspace restart. Turning this off keeps the installed version.</p>
      <dl className="settings-detail-list"><div><dt>Installed</dt><dd>{status.codex?.version ?? status.installed?.codexVersion ?? "Checking"}</dd></div><div><dt>Last check</dt><dd>{dateLabel(status.codex?.lastCheck ?? null)}</dd></div><div><dt>Status</dt><dd>{status.codex?.message || "Waiting for workspace"}</dd></div></dl>
      <p>The Codex app-server used by OpenClaw stays tied to the reviewed workspace release.</p>
    </section>
    <button className="settings-button is-primary" disabled={!dirty || busy || status.maintenance} onClick={() => void save()}>{busy ? "Saving…" : "Save update settings"}</button>
    <section className="settings-card"><h2>Update history</h2>{!status.jobs.length ? <p>No update operations yet.</p> : <ul className="updates-history">{status.jobs.map(job => <li key={job.id}><strong>{phaseLabel(job.phase)}</strong> — {job.release_id || "Release check"}<p>{job.message || "Waiting for the host updater"}</p><small>{dateLabel(job.updated_at)}</small></li>)}</ul>}</section>
  </div>;
}
