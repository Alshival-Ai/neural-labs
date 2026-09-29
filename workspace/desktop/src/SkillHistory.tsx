import { useEffect, useState } from "react";
import { settingsRequest } from "./settingsApi";

type RecordSummary = { migration: string; id: string; sha256: string; title: string; status: string; updatedAt: string | null };
type Page = { records: RecordSummary[]; next: string | null };
type Inspection = { id: string; sha256: string; raw: unknown; history: unknown[] };

export function SkillHistory() {
  const [records, setRecords] = useState<RecordSummary[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [selection, setSelection] = useState<Inspection>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function load(after = "") {
    setBusy(true); setError(undefined);
    try {
      const page = await settingsRequest<Page>(`/workspace/api/skills/history?after=${encodeURIComponent(after)}`);
      setRecords(previous => after ? [...previous, ...page.records] : page.records); setNext(page.next);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Proposal history could not be loaded."); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []);
  async function inspect(row: RecordSummary) {
    setBusy(true); setError(undefined); setSelection(undefined);
    try {
      setSelection(await settingsRequest<Inspection>(`/workspace/api/skills/history-detail?migration=${encodeURIComponent(row.migration)}&id=${encodeURIComponent(row.id)}`));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The proposal could not be loaded."); }
    finally { setBusy(false); }
  }
  return <section className="skills-drafts skill-history" aria-label="Proposal history" aria-busy={busy}>
    <header><div><span>Preserved records</span><h1>Proposal history</h1>
      <p>Original proposals, events, and rollback records are available for administrator review. Recorded outcomes remain unchanged.</p></div>
      <button type="button" disabled={busy} onClick={() => void load()}>Refresh</button></header>
    {error && <p role="alert">{error}</p>}
    {!busy && !error && !records.length && <p>No retained proposals have been imported.</p>}
    <div>{records.map(row => <button type="button" key={`${row.migration}/${row.id}`} disabled={busy} onClick={() => void inspect(row)}>
      <div><strong>{row.title}</strong><small>{row.status} · {row.id}</small>{row.updatedAt && <em>{row.updatedAt}</em>}</div>
    </button>)}</div>
    {next && <button type="button" disabled={busy} onClick={() => void load(next)}>Load more</button>}
    {selection && <article aria-label={`Retained proposal ${selection.id}`}><h2>{selection.id}</h2>
      <p>Record SHA-256: <code>{selection.sha256}</code></p>
      <details open><summary>Original record</summary><pre>{JSON.stringify(selection.raw, null, 2)}</pre></details>
      <details><summary>Events and rollbacks ({selection.history.length})</summary><pre>{JSON.stringify(selection.history, null, 2)}</pre></details>
    </article>}
  </section>;
}
