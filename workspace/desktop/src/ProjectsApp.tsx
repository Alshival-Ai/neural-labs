import { useCallback, useEffect, useRef, useState } from "react";
import "./projects-app.css";

type ItemData = {
  title: string; body: string; state: string; visibility: string; priority: string; acceptance: string;
  assignee: string | null; reviewer: string | null; starts_on: string | null; due_on: string | null;
  parent_id: string | null; archived: boolean; details: Record<string, string>;
};
type Item = { id: string; kind: string; revision: number; data: ItemData; author_id: string; updated_at: string };
type Member = { id: string; display_name: string };
const states = ["todo", "doing", "waiting", "review", "done"];
const labels: Record<string, string> = { todo: "To do", doing: "In progress", waiting: "Waiting", review: "Review", done: "Done" };
async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const csrf = document.cookie.split(";").map(value => value.trim()).find(value => value.startsWith("neural-labs-csrf="))?.split("=").slice(1).join("=") ?? "";
  const response = await fetch(`/api/projects${path}`, { method, credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json", "X-CSRF-Token": decodeURIComponent(csrf) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (response.status === 204) return undefined as T;
  const value = await response.json();
  if (!response.ok) throw new Error(value.error?.message ?? "Project service is unavailable.");
  return value;
}
export function ProjectsApp() {
  const [items, setItems] = useState<Item[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [kind, setKind] = useState("task");
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [selected, setSelected] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [key, setKey] = useState("");
  const [keys, setKeys] = useState<Array<{ id: string; name: string; revoked_at: string | null }>>([]);
  const [events, setEvents] = useState<Array<{ sequence: string; operation: string; created_at: string }>>([]);
  const serial = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++serial.current;
    try {
      const all: Item[] = []; let after = "";
      do {
        const page = await api<{ items: Item[]; next: string | null }>(`/items?after=${encodeURIComponent(after)}`);
        all.push(...page.items); after = page.next ?? "";
      } while (after);
      if (request === serial.current) setItems(all);
    } catch (reason) { if (request === serial.current) setError((reason as Error).message); }
  }, []);
  useEffect(() => {
    void refresh();
    void api<{ members: Member[] }>("/members").then(value => setMembers(value.members)).catch(reason => setError(reason.message));
    let stopped = false; let socket: WebSocket; let timer: ReturnType<typeof setTimeout>;
    const connect = () => {
      socket = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/projects/socket`);
      socket.onopen = () => { setConnected(true); void refresh(); };
      socket.onmessage = () => { void refresh(); };
      socket.onclose = event => { setConnected(false); if (!stopped && event.code !== 4403) timer = setTimeout(connect, 3000); };
      socket.onerror = () => socket.close();
    };
    connect();
    return () => { stopped = true; clearTimeout(timer); socket?.close(); };
  }, [refresh]);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const fields = new FormData(event.currentTarget);
    const data: Record<string, unknown> = {};
    for (const [name, value] of fields) data[name] = ["assignee", "reviewer", "starts_on", "due_on", "parent_id"].includes(name) ? value || null : value;
    try {
      const item = selected ? await api<Item>(`/items/${selected.id}`, "PATCH", { idempotency_key: crypto.randomUUID(), revision: selected.revision, data })
        : await api<Item>("/items", "POST", { idempotency_key: crypto.randomUUID(), kind, data });
      setSelected(item); await refresh();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  async function change(item: Item, data: unknown, action?: string) {
    setBusy(true); setError("");
    try {
      const updated = await api<Item>(`/items/${item.id}${action ? "/actions" : ""}`, action ? "POST" : "PATCH", { idempotency_key: crypto.randomUUID(), revision: item.revision, ...(action ? { action } : { data }) });
      if (selected?.id === item.id) setSelected(updated);
      await refresh();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  const visible = items.filter(item => item.kind === kind && item.data.archived === showArchived);
  const newest = selected && items.find(item => item.id === selected.id);
  return <section className="projects-app" aria-label="Project management">
    <header><div><h1>Projects</h1><span role="status">{connected ? "Live updates connected" : "Reconnecting to your environment…"}</span></div><button type="button" onClick={() => { setSelected(null); setEvents([]); }}>New {kind}</button></header>
    <nav aria-label="Project sections">{["task", "deliverable", "note", "resource", "ticket"].map(value => <button type="button" key={value} aria-pressed={kind === value} onClick={() => { setKind(value); setSelected(null); }}>{value === "task" ? "Board" : `${value[0].toUpperCase()}${value.slice(1)}s`}</button>)}<label><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />Archived</label></nav>
    {error && <p role="alert">{error}</p>}
    <div className="projects-layout"><div className="projects-board">{(kind === "task" ? states : [""]).map(state => <section className="projects-column" key={state}><h2>{labels[state] ?? `${kind[0].toUpperCase()}${kind.slice(1)}s`}</h2>{visible.filter(item => !state || item.data.state === state).map(item => <button className="projects-card" type="button" key={item.id} onClick={() => { setSelected(item); setEvents([]); }}><strong>{item.data.title}</strong><span>{item.data.body.slice(0, 160)}</span><small>{item.data.priority} {item.data.due_on && `· Due ${item.data.due_on}`}</small></button>)}</section>)}</div>
      <aside><h2>{selected ? "Edit item" : `New ${kind}`}</h2>
        {newest && newest.revision !== selected?.revision && <p role="alert">This item changed. <button type="button" onClick={() => setSelected(newest)}>Load current version</button></p>}
        <form key={selected ? `${selected.id}:${selected.revision}` : kind} onSubmit={save}>
          <label>Title<input required name="title" maxLength={200} defaultValue={selected?.data.title ?? ""} /></label>
          <label>Description<textarea name="body" maxLength={20000} defaultValue={selected?.data.body ?? ""} /></label>
          <label>Status<select name="state" defaultValue={selected?.data.state ?? "todo"}>{states.map(value => <option key={value} value={value}>{labels[value]}</option>)}</select></label>
          <label>Priority<select name="priority" defaultValue={selected?.data.priority ?? "normal"}>{["low", "normal", "high", "urgent"].map(value => <option key={value}>{value}</option>)}</select></label>
          {["assignee", "reviewer"].map(name => <label key={name}>{name === "assignee" ? "Assigned to" : "Reviewer"}<select name={name} defaultValue={selected?.data[name as "assignee" | "reviewer"] ?? ""}><option value="">Unassigned</option>{members.map(member => <option key={member.id} value={member.id}>{member.display_name}</option>)}</select></label>)}
          <label>Starts<input type="date" name="starts_on" defaultValue={selected?.data.starts_on ?? ""} /></label><label>Due<input type="date" name="due_on" defaultValue={selected?.data.due_on ?? ""} /></label>
          <label>Acceptance criteria<textarea name="acceptance" maxLength={6000} defaultValue={selected?.data.acceptance ?? ""} /></label>
          <button disabled={busy} type="submit">{busy ? "Saving…" : "Save"}</button>
        </form>
        {selected && <><div className="projects-actions"><button disabled={busy} onClick={() => void change(selected, { archived: !selected.data.archived })}>{selected.data.archived ? "Restore" : "Archive"}</button>{selected.data.state === "review" && <><button disabled={busy} onClick={() => void change(selected, {}, "approve")}>Accept review</button><button disabled={busy} onClick={() => void change(selected, {}, "changes")}>Request changes</button></>}<button onClick={() => void api<{ events: typeof events }>(`/items/${selected.id}/history`).then(value => setEvents(value.events)).catch(reason => setError(reason.message))}>History</button></div>
        {events.map(event => <p key={event.sequence}>{event.operation} · {new Date(event.created_at).toLocaleString()}</p>)}
        <h3>Replies</h3>{items.filter(item => item.kind === "comment" && item.data.parent_id === selected.id).map(item => <p key={item.id}>{item.data.body}</p>)}
        <form onSubmit={event => { event.preventDefault(); const form = event.currentTarget; const body = String(new FormData(form).get("reply") ?? ""); setBusy(true); void api("/items", "POST", { idempotency_key: crypto.randomUUID(), kind: "comment", data: { title: "Reply", body, parent_id: selected.id, visibility: selected.data.visibility } }).then(() => { form.reset(); return refresh(); }).catch(reason => setError(reason.message)).finally(() => setBusy(false)); }}><label>Reply<textarea name="reply" required /></label><button disabled={busy}>Add reply</button></form></>}
      </aside></div>
    <details><summary>API &amp; MCP connections</summary><p>API: <code>{location.origin}/api/projects</code><br />MCP: <code>{location.origin}/api/projects/mcp</code></p><p>Credentials belong to your user and expire after 30 days.</p>
    <button onClick={() => void api<{ id: string; token: string }>("/keys", "POST", { name: "Project client", scopes: ["project:read", "project:write"] }).then(value => setKey(value.token)).catch(reason => setError(reason.message))}>Create credential</button>
    {key && <label>Copy now; it will not be shown again<input readOnly value={key} onFocus={event => event.target.select()} /><button onClick={() => setKey("")}>Dismiss</button></label>}
    <button onClick={() => void api<{ keys: typeof keys }>("/keys").then(value => setKeys(value.keys)).catch(reason => setError(reason.message))}>Manage credentials</button>{keys.filter(item => !item.revoked_at).map(item => <p key={item.id}>{item.name} <button onClick={() => void api(`/keys/${item.id}`, "DELETE").then(() => setKeys(current => current.filter(value => value.id !== item.id))).catch(reason => setError(reason.message))}>Revoke</button></p>)}
    </details>
  </section>;
}
