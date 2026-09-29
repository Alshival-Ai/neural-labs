import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { nativeRequest, type NativeConnection } from "./nativeApi";
import { settingsRequest } from "./settingsApi";
import type { ProviderCatalog } from "./modelProviders";
import type { AutomationJob } from "./AutomationsApp";

export function AutomationReview({ job, onClose, onReviewed }: {
  job: AutomationJob; onClose: () => void; onReviewed: () => void | Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [connections, setConnections] = useState<NativeConnection[]>([]);
  const [connection, setConnection] = useState("");
  const [model, setModel] = useState("");
  const [catalog, setCatalog] = useState<ProviderCatalog>();
  const [sandbox, setSandbox] = useState(job.reviewPolicy?.sandbox || "");
  const [missed, setMissed] = useState(job.reviewPolicy?.missedRunPolicy || "");
  const [overlap, setOverlap] = useState(job.reviewPolicy?.overlap || "");
  const [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  // Retain the exact request ID across an uncertain HTTP response. Changing
  // a review choice starts a distinct request; a stale revision still fails.
  const request = useRef<{ body: string; id: string } | undefined>(undefined);
  useEffect(() => {
    dialog.current?.showModal?.();
    let active = true;
    void settingsRequest<{ connections: NativeConnection[] }>("/api/runtime/connections")
      .then(result => { if (active) setConnections(result.connections.filter(row => row.enabled)); })
      .catch(() => { if (active) setError("Connections could not be loaded. Close and reopen this review."); });
    return () => { active = false; };
  }, []);
  const work = async (action: () => Promise<void>) => {
    setBusy(true); setError(undefined);
    try { await action(); } catch (error) { setError(error instanceof Error ? error.message : "Review could not complete. The job remains held until confirmed."); }
    finally { setBusy(false); }
  };
  const selected = connections.find(row => row.id === connection);
  return createPortal(<dialog ref={dialog} className="automation-review" aria-labelledby="automation-review-title"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <h2 id="automation-review-title">Review {job.name}</h2>
    <p>{job.manualRunWarning}. Review the saved instruction and schedule, then explicitly assign the account and policy for future scheduled runs.</p>
    <details><summary>Saved instruction and schedule</summary><p>{job.schedule.label} · {job.schedule.expression} · {job.schedule.timezone || "UTC"}</p><pre>{job.payload.content}</pre></details>
    <label>Scheduled connection<select value={connection} disabled={busy} onChange={event => { setConnection(event.target.value); setModel(""); setCatalog(undefined); }}>
      <option value="">Choose a connection</option>{connections.map(row => <option key={row.id} value={row.id}>{row.label} · {row.scope} · {row.method}</option>)}
    </select></label>
    <button type="button" disabled={busy || !connection} onClick={() => void work(async () => {
      setCatalog(await nativeRequest<ProviderCatalog>("models.list", {}, { connection, model: "catalog" }));
    })}>Load models</button>
    <label>Scheduled model<select value={model} disabled={busy || !catalog} onChange={event => setModel(event.target.value)}>
      <option value="">Choose a model</option>{catalog?.models.map(row => <option key={row.id} value={row.id} disabled={!row.available}>{row.name}</option>)}
    </select></label>
    <label>Workspace access<select value={sandbox} disabled={busy} onChange={event => setSandbox(event.target.value)}>
      <option value="">Choose access</option><option value="read-only">Read only</option><option value="workspace-write">Read and write workspace files</option>
    </select></label>
    <label>Missed occurrences<select value={missed} disabled={busy} onChange={event => setMissed(event.target.value)}>
      <option value="">Choose missed-run behavior</option><option value="skip">Skip missed occurrences</option><option value="run-once">Run once when catching up</option>
    </select></label>
    <label>Overlapping runs<select value={overlap} disabled={busy} onChange={event => setOverlap(event.target.value)}>
      <option value="">Choose overlap behavior</option><option value="forbid">Prevent overlapping runs</option><option value="allow">Allow concurrent runs</option>
    </select></label>
    <p>Runs needing approval will be blocked. Existing workflow locks and other saved policies still apply. Unsupported policies keep the job held.</p>
    <p>{job.completed ? "This one-time job remains completed." : job.enabled ? "Releasing the hold makes this enabled job eligible for scheduling." : "This job remains paused after review."} Historical runs will not be replayed.</p>
    {selected && <p>Scheduled work will use {selected.label} ({selected.method}) and your background authorization. Your personal chat and manual-run selection stays unchanged.</p>}
    {error && <p role="alert">{error}</p>}
    <footer><button type="button" disabled={busy} onClick={onClose}>Cancel</button>
      <button type="button" className="is-primary" disabled={busy || !connection || !model || !sandbox || !missed || !overlap} onClick={() => void work(async () => {
        const params = { id: job.id, expectedRevision: job.configRevision, missedRunPolicy: missed, overlap, executionPolicy: { sandbox, approval: "on-request" } };
        const body = JSON.stringify({ params, connection, model });
        if (request.current?.body !== body) request.current = { body, id: crypto.randomUUID() };
        await nativeRequest("jobs.review", { ...params, requestId: request.current.id }, { connection, model });
        await onReviewed(); onClose();
      })}>{busy ? "Checking…" : "Assign account and release hold"}</button></footer>
  </dialog>, document.body);
}
