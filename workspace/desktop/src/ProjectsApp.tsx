import { useCallback, useEffect, useRef, useState } from "react";
import "./projects-app.css";

type ItemData = {
  title: string; body: string; status_id: string | null; state: string; visibility: string; priority: string; acceptance: string;
  assignee: string | null; reviewer: string | null; starts_on: string | null; due_on: string | null;
  position: { x: number; y: number } | null;
  parent_id: string | null; archived: boolean; deleted: boolean; color: string;
  checklist: Array<{ id: string; text: string; done: boolean }>; details: Record<string, string>;
};
type Item = { id: string; kind: string; revision: number; data: ItemData; author_id: string; updated_at: string };
type Edge = { id: string; source_id: string; target_id: string; kind: "depends_on" | "related" };
type Status = { id: string; revision: number; name: string; color: string; category: string; legacy_state: string; position: number; is_default: boolean; retired: boolean; replacement_id: string | null };
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
function StickyCanvas({ notes, open, move }: { notes: Item[]; open: (note: Item) => void; move: (note: Item, position: { x: number; y: number }) => void }) {
  return <div className="projects-sticky-canvas" aria-label="Workspace sticky notes">{notes.map((note, index) => {
    const at = note.data.position ?? { x: (index % 3) * 190 + 12, y: Math.floor(index / 3) * 170 + 12 };
    return <button type="button" draggable className="projects-sticky" data-color={note.data.color} key={note.id}
      style={{ left: at.x, top: at.y }} onClick={() => open(note)}
      onKeyDown={event => {
        if (!event.altKey || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        move(note, { x: Math.max(0, at.x + (event.key === "ArrowRight" ? 20 : event.key === "ArrowLeft" ? -20 : 0)),
          y: Math.max(0, at.y + (event.key === "ArrowDown" ? 20 : event.key === "ArrowUp" ? -20 : 0)) });
      }}
      onDragEnd={event => {
        const box = event.currentTarget.parentElement?.getBoundingClientRect(); if (!box || event.clientX <= 0) return;
        move(note, { x: Math.max(0, event.clientX - box.left - 70), y: Math.max(0, event.clientY - box.top - 20) });
      }}><strong>{note.data.title}</strong><small>{note.data.body}</small></button>;
  })}</div>;
}
export function ProjectsApp() {
  const [items, setItems] = useState<Item[]>([]);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [manageStatuses, setManageStatuses] = useState(false);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [view, setView] = useState<"board" | "graph" | "timeline" | "activity" | "trash">("board");
  const [members, setMembers] = useState<Member[]>([]);
  const [kind, setKind] = useState("task");
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [selected, setSelected] = useState<Item | null>(null);
  const [noteParent, setNoteParent] = useState<string | null>(null);
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
      const links = await api<{ edges: Edge[] }>("/edges");
      const catalog = await api<{ statuses: Status[]; can_manage: boolean }>("/statuses");
      if (request === serial.current) { setItems(all); setEdges(links.edges ?? []); setStatuses(catalog.statuses); setManageStatuses(catalog.can_manage); }
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
      setSelected(item); setNoteParent(null); await refresh();
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
  async function link(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return;
    const fields = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      await api("/edges", "POST", { idempotency_key: crypto.randomUUID(), source_id: selected.id,
        target_id: fields.get("target_id"), kind: fields.get("kind") });
      await refresh(); event.currentTarget.reset();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  async function unlink(id: string) {
    setBusy(true); setError("");
    try { await api(`/edges/${id}`, "DELETE"); await refresh(); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  const visible = items.filter(item => item.kind === kind && !item.data.deleted && item.data.archived === showArchived);
  const tasks = items.filter(item => item.kind === "task" && !item.data.deleted && !item.data.archived);
  const taskById = new Map(tasks.map(item => [item.id, item]));
  const links = selected?.kind === "task" ? edges.filter(edge => edge.source_id === selected.id || edge.target_id === selected.id) : [];
  const unresolved = selected?.kind === "task" ? edges.filter(edge => edge.kind === "depends_on" && edge.source_id === selected.id && taskById.get(edge.target_id)?.data.state !== "done") : [];
  const newest = selected && items.find(item => item.id === selected.id);
  return <section className="projects-app" aria-label="Project management">
    <header><div><h1>Projects</h1><span role="status">{connected ? "Live updates connected" : "Reconnecting to your environment…"}</span></div><button type="button" onClick={() => { setSelected(null); setEvents([]); }}>New {kind}</button></header>
    <nav aria-label="Project sections">{["board", "graph", "timeline", "activity", "trash"].map(value => <button type="button" key={value} aria-pressed={view === value} onClick={() => { setView(value as typeof view); setKind("task"); }}>{value[0].toUpperCase() + value.slice(1)}</button>)}{["deliverable", "note", "resource"].map(value => <button type="button" key={value} aria-pressed={kind === value && view === "board"} onClick={() => { setView("board"); setKind(value); setSelected(null); }}>{`${value[0].toUpperCase()}${value.slice(1)}s`}</button>)}<label><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />Archived</label></nav>
    {error && <p role="alert">{error}</p>}
    <div className="projects-layout"><div className="projects-board">{view === "graph" ? <TaskGraph tasks={tasks} edges={edges} open={setSelected} />
      : view === "timeline" ? <div className="projects-timeline">{tasks.filter(task => task.data.starts_on || task.data.due_on).sort((a,b) => (a.data.starts_on ?? a.data.due_on ?? "").localeCompare(b.data.starts_on ?? b.data.due_on ?? "")).map(task => <button key={task.id} onClick={() => setSelected(task)}>{task.data.starts_on ?? "…"} → {task.data.due_on ?? "…"} · {task.data.title}</button>)}</div>
      : view === "activity" ? <div className="projects-timeline">{items.slice().sort((a,b) => b.updated_at.localeCompare(a.updated_at)).map(item => <button key={item.id} onClick={() => setSelected(item)}>{new Date(item.updated_at).toLocaleString()} · {item.data.title}</button>)}</div>
      : view === "trash" ? <div className="projects-timeline">{items.filter(item => item.data.deleted || item.data.archived).map(item => <button key={item.id} onClick={() => setSelected(item)}>{item.data.title} · {item.data.deleted ? "Deleted" : "Archived"}</button>)}</div>
      : kind === "note" ? <StickyCanvas move={(note, position) => void change(note, { position })} notes={visible.filter(note => !note.data.parent_id)} open={setSelected} />
      : (kind === "task" ? statuses.filter(status => !status.retired).map(status => status.id) : [""]).map(state => <section className="projects-column" key={state}><h2>{statuses.find(status => status.id === state)?.name ?? `${kind[0].toUpperCase()}${kind.slice(1)}s`}</h2>{visible.filter(item => !state || item.data.status_id === state).map(item => <button className="projects-card" type="button" key={item.id} onClick={() => { setSelected(item); setEvents([]); }}><strong>{item.data.title}</strong><span>{item.data.body.slice(0, 160)}</span><small>{item.data.priority} {item.data.due_on && `· Due ${item.data.due_on}`}</small></button>)}</section>)}</div>
      <aside><h2>{selected ? "Edit item" : `New ${kind}`}</h2>
        {newest && newest.revision !== selected?.revision && <p role="alert">This item changed. <button type="button" onClick={() => setSelected(newest)}>Load current version</button></p>}
        <form key={selected ? `${selected.id}:${selected.revision}` : kind} onSubmit={save}>
          <label>Title<input required name="title" maxLength={200} defaultValue={selected?.data.title ?? ""} /></label>
          <label>Description<textarea name="body" maxLength={20000} defaultValue={selected?.data.body ?? ""} /></label>
          {kind === "task" ? <label>Status<select name="status_id" defaultValue={selected?.data.status_id ?? statuses.find(status => status.is_default)?.id}>{statuses.filter(status => !status.retired).map(status => <option key={status.id} value={status.id}>{status.name}</option>)}</select></label> : <label>Status<select name="state" defaultValue={selected?.data.state ?? "todo"}>{states.map(value => <option key={value} value={value}>{labels[value]}</option>)}</select></label>}
          <label>Priority<select name="priority" defaultValue={selected?.data.priority ?? "normal"}>{["low", "normal", "high", "urgent"].map(value => <option key={value}>{value}</option>)}</select></label>
          {["assignee", "reviewer"].map(name => <label key={name}>{name === "assignee" ? "Assigned to" : "Reviewer"}<select name={name} defaultValue={selected?.data[name as "assignee" | "reviewer"] ?? ""}><option value="">Unassigned</option>{members.map(member => <option key={member.id} value={member.id}>{member.display_name}</option>)}</select></label>)}
          <label>Starts<input type="date" name="starts_on" defaultValue={selected?.data.starts_on ?? ""} /></label><label>Due<input type="date" name="due_on" defaultValue={selected?.data.due_on ?? ""} /></label>
          <label>Acceptance criteria<textarea name="acceptance" maxLength={6000} defaultValue={selected?.data.acceptance ?? ""} /></label>
          {kind === "note" && <><label>Task<select name="parent_id" defaultValue={selected?.data.parent_id ?? noteParent ?? ""}><option value="">Workspace note</option>{tasks.map(task => <option key={task.id} value={task.id}>{task.data.title}</option>)}</select></label><label>Color<select name="color" defaultValue={selected?.data.color ?? "yellow"}>{["yellow", "blue", "pink", "green", "orange", "purple", "teal", "gray"].map(color => <option key={color}>{color}</option>)}</select></label></>}
          <button disabled={busy} type="submit">{busy ? "Saving…" : "Save"}</button>
        </form>
        {selected && <><div className="projects-actions"><button disabled={busy} onClick={() => void change(selected, { archived: !selected.data.archived })}>{selected.data.archived ? "Restore" : "Archive"}</button>{selected.data.state === "review" && <><button disabled={busy} onClick={() => void change(selected, {}, "approve")}>Accept review</button><button disabled={busy} onClick={() => void change(selected, {}, "changes")}>Request changes</button></>}<button onClick={() => void api<{ events: typeof events }>(`/items/${selected.id}/history`).then(value => setEvents(value.events)).catch(reason => setError(reason.message))}>History</button></div>
        {selected.kind === "task" && <section className="projects-related"><h3>Task graph</h3>{unresolved.length > 0 && <p role="status">Waiting on {unresolved.length} linked task{unresolved.length === 1 ? "" : "s"}; status changes remain available.</p>}{links.map(edge => <p key={edge.id}>{edge.kind === "related" ? "Related" : edge.source_id === selected.id ? "Depends on" : "Required by"}: {taskById.get(edge.source_id === selected.id ? edge.target_id : edge.source_id)?.data.title ?? "Task"} <button disabled={busy} type="button" onClick={() => void unlink(edge.id)}>Remove</button></p>)}<form onSubmit={link}><label>Link task<select name="target_id" required defaultValue=""><option value="">Choose a task</option>{tasks.filter(task => task.id !== selected.id).map(task => <option key={task.id} value={task.id}>{task.data.title}</option>)}</select></label><label>Relationship<select name="kind"><option value="related">Related</option><option value="depends_on">Depends on</option></select></label><button disabled={busy}>Add link</button></form><h3>Checklist</h3>{(selected.data.checklist ?? []).map((entry, index) => <label key={entry.id}><input type="checkbox" checked={entry.done} onChange={() => void change(selected, { checklist: (selected.data.checklist ?? []).map((value, at) => at === index ? { ...value, done: !value.done } : value) })} />{entry.text}</label>)}<form onSubmit={event => { event.preventDefault(); const input = event.currentTarget.elements.namedItem("checklist_text") as HTMLInputElement; const value = input.value.trim(); if (value) void change(selected, { checklist: [...(selected.data.checklist ?? []), { id: crypto.randomUUID(), text: value, done: false }] }); input.value = ""; }}><label>Add checklist item<input name="checklist_text" maxLength={500} required /></label><button disabled={busy}>Add</button></form><h3>Sticky notes</h3><StickyCanvas move={(note, position) => void change(note, { position })} notes={items.filter(item => item.kind === "note" && item.data.parent_id === selected.id && !item.data.deleted)} open={note => { setKind("note"); setSelected(note); }} /><button onClick={() => { setNoteParent(selected.id); setKind("note"); setSelected(null); }}>Add task note</button></section>}
        {events.map(event => <p key={event.sequence}>{event.operation} · {new Date(event.created_at).toLocaleString()}</p>)}
        <h3>Replies</h3>{items.filter(item => item.kind === "comment" && item.data.parent_id === selected.id).map(item => <p key={item.id}>{item.data.body}</p>)}
        <form onSubmit={event => { event.preventDefault(); const form = event.currentTarget; const body = String(new FormData(form).get("reply") ?? ""); setBusy(true); void api("/items", "POST", { idempotency_key: crypto.randomUUID(), kind: "comment", data: { title: "Reply", body, parent_id: selected.id, visibility: selected.data.visibility } }).then(() => { form.reset(); return refresh(); }).catch(reason => setError(reason.message)).finally(() => setBusy(false)); }}><label>Reply<textarea name="reply" required /></label><button disabled={busy}>Add reply</button></form></>}
      </aside></div>
    {manageStatuses && <details><summary>Board statuses</summary><StatusEditor statuses={statuses} onSave={async (input) => { try { await api("/statuses", "POST", input); await refresh(); } catch (reason) { setError((reason as Error).message); } }} /></details>}
    <details><summary>API &amp; MCP connections</summary><p>API: <code>{location.origin}/api/projects</code><br />MCP: <code>{location.origin}/api/projects/mcp</code></p><p>Credentials belong to your user and expire after 30 days.</p>
    <button onClick={() => void api<{ id: string; token: string }>("/keys", "POST", { name: "Project client", scopes: ["project:read", "project:write"] }).then(value => setKey(value.token)).catch(reason => setError(reason.message))}>Create credential</button>
    {manageStatuses && <button onClick={() => void api<{ id: string; token: string }>("/keys", "POST", { name: "Graph sync", scopes: ["project:read", "project:write", "project:sync"] }).then(value => setKey(value.token)).catch(reason => setError(reason.message))}>Create sync credential</button>}
    {key && <label>Copy now; it will not be shown again<input readOnly value={key} onFocus={event => event.target.select()} /><button onClick={() => setKey("")}>Dismiss</button></label>}
    <button onClick={() => void api<{ keys: typeof keys }>("/keys").then(value => setKeys(value.keys)).catch(reason => setError(reason.message))}>Manage credentials</button>{keys.filter(item => !item.revoked_at).map(item => <p key={item.id}>{item.name} <button onClick={() => void api(`/keys/${item.id}`, "DELETE").then(() => setKeys(current => current.filter(value => value.id !== item.id))).catch(reason => setError(reason.message))}>Revoke</button></p>)}
    </details>
  </section>;
}

function StatusEditor({ statuses, onSave }: { statuses: Status[]; onSave: (input: unknown) => Promise<void> }) {
  const [selected, setSelected] = useState("");
  const status = statuses.find(value => value.id === selected);
  return <><label>Status<select value={selected} onChange={event => setSelected(event.target.value)}><option value="">New status</option>{statuses.filter(value => !value.retired).map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
    <form key={`${selected}:${status?.revision}`} onSubmit={event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      void onSave({ ...(status ? { id: status.id } : {}), revision: status?.revision ?? 0, data: {
        name: String(form.get("name")), color: String(form.get("color")), category: status?.category ?? String(form.get("category")),
        legacy_state: status?.legacy_state ?? "", position: Number(form.get("position")), is_default: form.has("is_default"),
        retired: form.has("retired"), replacement_id: form.get("replacement_id") || null,
      } });
    }}><label>Name<input name="name" maxLength={60} required defaultValue={status?.name ?? ""} /></label>
    <label>Category<select name="category" disabled={Boolean(status)} defaultValue={status?.category ?? "todo"}><option value="todo">Not started</option><option value="doing">In progress</option><option value="done">Finished</option></select></label>
    <label>Color<select name="color" defaultValue={status?.color ?? "blue"}>{["gray","blue","orange","purple","green","pink","teal"].map(color => <option key={color}>{color}</option>)}</select></label>
    <label>Position<input name="position" type="number" min={0} max={10000} defaultValue={status?.position ?? statuses.length} /></label>
    <label><input name="is_default" type="checkbox" defaultChecked={status?.is_default} />Default for new tasks</label>
    {status && <><label><input name="retired" type="checkbox" />Retire this status</label><label>Replacement<select name="replacement_id" defaultValue=""><option value="">Choose replacement when retiring</option>{statuses.filter(value => !value.retired && value.id !== status.id && value.category === status.category).map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label></>}
    <button type="submit">Save status</button></form></>;
}

function TaskGraph({ tasks, edges, open }: { tasks: Item[]; edges: Edge[]; open: (task: Item) => void }) {
  const [zoom, setZoom] = useState(1);
  const [focus, setFocus] = useState<string | null>(null);
  const columns = Math.min(4, Math.max(1, tasks.length));
  const points = new Map(tasks.map((task, index) => [task.id, { x: 30 + index % columns * 280, y: 40 + Math.floor(index / columns) * 150 }]));
  const width = columns * 280 + 20, height = Math.max(240, Math.ceil(tasks.length / columns) * 150 + 40);
  return <section className="projects-graph-surface"><div className="projects-actions"><button onClick={() => setZoom(value => Math.max(.5, value - .25))} aria-label="Zoom out">−</button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom(value => Math.min(2, value + .25))} aria-label="Zoom in">+</button></div>
    {!tasks.length ? <p>Add a task to start the graph.</p> : <div className="projects-graph-scroll"><svg width={width * zoom} height={height * zoom} viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Task graph">
      <defs><marker id="project-dependency-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="currentColor" /></marker></defs>
      {edges.map(edge => { const a = points.get(edge.source_id), b = points.get(edge.target_id); if (!a || !b) return null;
        return <path key={edge.id} d={`M${a.x + 110},${a.y + 80} C${a.x + 110},${a.y + 115} ${b.x + 110},${b.y - 35} ${b.x + 110},${b.y}`}
          fill="none" stroke="currentColor" strokeWidth={focus && [edge.source_id, edge.target_id].includes(focus) ? 3 : 1.5}
          opacity={!focus || [edge.source_id, edge.target_id].includes(focus) ? .8 : .15}
          strokeDasharray={edge.kind === "related" ? "5 4" : undefined} markerEnd={edge.kind === "depends_on" ? "url(#project-dependency-arrow)" : undefined}>
          <title>{tasks.find(task => task.id === edge.source_id)?.data.title} {edge.kind === "depends_on" ? "depends on" : "is related to"} {tasks.find(task => task.id === edge.target_id)?.data.title}</title></path>; })}
      {tasks.map(task => { const point = points.get(task.id)!; return <g key={task.id} role="button" tabIndex={0} aria-label={`Open task: ${task.data.title}`} className="projects-graph-task"
        onFocus={() => setFocus(task.id)} onBlur={() => setFocus(null)} onMouseEnter={() => setFocus(task.id)} onMouseLeave={() => setFocus(null)}
        onClick={() => open(task)} onKeyDown={event => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); open(task); } }}>
        <rect x={point.x} y={point.y} width={220} height={80} rx={12} /><text x={point.x + 12} y={point.y + 28}>{task.data.title.length > 25 ? task.data.title.slice(0, 24) + "…" : task.data.title}</text><text className="graph-state" x={point.x + 12} y={point.y + 56}>{labels[task.data.state]}</text><title>{task.data.title}</title>
      </g>; })}</svg></div>}
    <p>Arrows point to dependencies. Dashed lines connect related tasks. Select a task to edit it.</p>
  </section>;
}
