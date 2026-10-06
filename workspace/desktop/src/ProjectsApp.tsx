import { useCallback, useEffect, useRef, useState } from "react";
import {
  type Item,
  type ItemData,
  type Member,
  type Status,
  type Edge,
  labels,
} from "./project-board/types";
import { Canvas } from "./project-board/Canvas";
import { TaskColumns } from "./project-board/TaskColumns";
import { Timeline } from "./project-board/Timeline";
import "./projects-app.css";
const states = ["todo", "doing", "waiting", "review", "done"];
const views = [
  "board",
  "graph",
  "deliverables",
  "timeline",
  "activity",
  "trash",
] as const;
type View = (typeof views)[number];
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const csrf =
    document.cookie
      .split(";")
      .map((value) => value.trim())
      .find((value) => value.startsWith("neural-labs-csrf="))
      ?.split("=")
      .slice(1)
      .join("=") ?? "";
  const response = await fetch(`/api/projects${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": decodeURIComponent(csrf),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 204) return undefined as T;
  const value = await response.json().catch(() => null);
  if (!response.ok || value === null)
    throw new Error(
      value?.error?.message ??
        "Project service is unavailable. Your changes have not been discarded.",
    );
  return value;
}
export function ProjectsApp({
  storageNamespace,
}: { storageNamespace?: string } = {}) {
  const [items, setItems] = useState<Item[]>([]),
    [boards, setBoards] = useState<Item[]>([]),
    [statuses, setStatuses] = useState<Status[]>([]),
    [edges, setEdges] = useState<Edge[]>([]),
    [members, setMembers] = useState<Member[]>([]);
  const [actor, setActor] = useState<string>(),
    [manageStatuses, setManageStatuses] = useState(false),
    [activeBoard, setActiveBoard] = useState("");
  const [view, setView] = useState<View>("board"),
    [query, setQuery] = useState(""),
    [assignment, setAssignment] = useState(""),
    [showArchived, setShowArchived] = useState(false),
    [expanded, setExpanded] = useState(false),
    [filters, setFilters] = useState(false);
  const [selected, setSelected] = useState<Item | null>(null),
    [editorOpen, setEditorOpen] = useState(false),
    [kind, setKind] = useState("task"),
    [noteParent, setNoteParent] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [loaded, setLoaded] = useState(false),
    [events, setEvents] = useState<
      Array<{ sequence: string; operation: string; created_at: string }>
    >([]);
  const [key, setKey] = useState(""),
    [keys, setKeys] = useState<
      Array<{ id: string; name: string; revoked_at: string | null }>
    >([]);
  const serial = useRef(0),
    dirty = useRef(false),
    alive = useRef(true),
    creating = useRef(false);
  const refresh = useCallback(async () => {
    const request = ++serial.current;
    const all: Item[] = [],
      seen = new Set<string>();
    let after = "";
    do {
      if (seen.has(after))
        throw new Error("The project listing changed. Please reload.");
      seen.add(after);
      const page = await api<{ items: Item[]; next: string | null }>(
        `/items?after=${encodeURIComponent(after)}`,
      );
      all.push(...page.items);
      after = page.next ?? "";
    } while (after);
    const [links, catalog, boardList, people] = await Promise.all([
      api<{ edges: Edge[] }>("/edges"),
      api<{ statuses: Status[]; can_manage: boolean }>("/statuses"),
      api<{ boards: Item[] }>("/boards"),
      api<{ members: Member[]; actor?: { id: string } }>("/members"),
    ]);
    if (alive.current && request === serial.current) {
      setItems(all);
      setEdges(links.edges ?? []);
      setStatuses(catalog.statuses ?? []);
      setManageStatuses(catalog.can_manage);
      setBoards(boardList.boards ?? []);
      setMembers(people.members ?? []);
      setActor(people.actor?.id);
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    let stopped = false,
      socket: WebSocket,
      timer: ReturnType<typeof setTimeout>;
    const update = () =>
      void refresh().catch((reason) => {
        if (!stopped) setError(reason.message);
      });
    update();
    const connect = () => {
      socket = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/projects/socket`,
      );
      socket.onopen = update;
      socket.onmessage = update;
      socket.onclose = (event) => {
        if (stopped) return;
        if (event.code === 4403) {
          setItems([]);
          setError("Your workspace access changed. Sign in again to continue.");
        } else timer = setTimeout(connect, 3000);
      };
      socket.onerror = () => socket.close();
    };
    connect();
    return () => {
      alive.current = false;
      stopped = true;
      ++serial.current;
      clearTimeout(timer);
      socket?.close();
    };
  }, [refresh, storageNamespace]);
  useEffect(() => {
    const active = boards.filter((board) => !board.data.archived);
    if (activeBoard && !active.some((board) => board.id === activeBoard)) {
      setActiveBoard("");
      setEditorOpen(false);
    } else if (
      !activeBoard &&
      !items.some((item) => item.kind !== "board" && !item.data.board_id) &&
      active.length
    ) {
      setActiveBoard(active[0].id);
    }
  }, [boards, items, activeBoard]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const noteDrafts = useRef(new Set<string>());
  const noteDirty = useCallback((id: string, value: boolean) => {
    if (value) noteDrafts.current.add(id);
    else noteDrafts.current.delete(id);
  }, []);
  const leaveBoard = () =>
    leave() &&
    (!noteDrafts.current.size ||
      window.confirm("Some notes have not saved. Discard those changes?"));
  const leave = () =>
    !dirty.current || window.confirm("Discard your unsaved changes?");
  const open = (item: Item) => {
    if (!leave()) return;
    dirty.current = false;
    setKind(item.kind);
    setSelected(item);
    setEvents([]);
    setEditorOpen(true);
  };
  const begin = (next: string) => {
    if (!leave()) return;
    dirty.current = false;
    setKind(next);
    setSelected(null);
    setEvents([]);
    setEditorOpen(true);
  };
  const focusOrigin = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!editorOpen) return;
    focusOrigin.current = document.activeElement as HTMLElement;
    const pane = document.querySelector<HTMLElement>(
      ".projects-app .project-item-pane",
    );
    pane?.querySelector<HTMLElement>("input")?.focus();
    return () => focusOrigin.current?.focus();
  }, [editorOpen]);
  useEffect(() => {
    if (!editorOpen) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && leave()) {
        dirty.current = false;
        setEditorOpen(false);
        setSelected(null);
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [editorOpen]);
  const close = () => {
    if (!leave()) return;
    dirty.current = false;
    setEditorOpen(false);
    setSelected(null);
  };
  async function change(item: Item, data: Partial<ItemData>): Promise<Item> {
    const updated = await api<Item>(`/items/${item.id}`, "PATCH", {
      idempotency_key: crypto.randomUUID(),
      revision: item.revision,
      data,
    });
    if (alive.current) {
      setItems((current) =>
        current.map((row) => (row.id === updated.id ? updated : row)),
      );
      if (selected?.id === item.id && !dirty.current) setSelected(updated);
    }
    return updated;
  }
  const safeChange = async (item: Item, data: Partial<ItemData>) => {
    try {
      await change(item, data);
    } catch (reason) {
      setError((reason as Error).message);
    }
  };
  async function action(item: Item, action: string) {
    setBusy(true);
    try {
      const updated = await api<Item>(`/items/${item.id}/actions`, "POST", {
        idempotency_key: crypto.randomUUID(),
        revision: item.revision,
        action,
      });
      setSelected(updated);
      await refresh();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const fields = new FormData(event.currentTarget);
    const data: Record<string, unknown> = {};
    for (const [name, value] of fields)
      if (!name.startsWith("resource_"))
        data[name] = [
          "assignee",
          "reviewer",
          "starts_on",
          "due_on",
          "parent_id",
        ].includes(name)
          ? value || null
          : value;
    data.board_id = selected?.data.board_id ?? (activeBoard || null);
    if (kind === "resource")
      data.resource = {
        kind: fields.get("resource_kind"),
        status: fields.get("resource_status"),
        provider: fields.get("resource_provider"),
        environment: fields.get("resource_environment"),
        public_url: fields.get("resource_public_url"),
        external_id: selected?.data.resource?.external_id ?? null,
      };
    try {
      const item = selected
        ? await change(selected, data)
        : await api<Item>("/items", "POST", {
            idempotency_key: crypto.randomUUID(),
            kind,
            data,
          });
      dirty.current = false;
      setSelected(item);
      setNoteParent(null);
      await refresh();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function create(next: string) {
    if (next !== "note") {
      begin(next);
      return;
    }
    if (creating.current) return;
    creating.current = true;
    try {
      const note = await api<Item>("/items", "POST", {
        idempotency_key: crypto.randomUUID(),
        kind: "note",
        data: {
          title: "Sticky note",
          color: "yellow",
          board_id: activeBoard || null,
        },
      });
      setItems((current) => [...current, note]);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      creating.current = false;
    }
  }
  async function link(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget,
      fields = new FormData(form);
    setBusy(true);
    try {
      await api("/edges", "POST", {
        idempotency_key: crypto.randomUUID(),
        source_id: selected.id,
        target_id: fields.get("target_id"),
        kind: fields.get("kind"),
      });
      await refresh();
      form.reset();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function unlink(id: string) {
    try {
      await api(`/edges/${id}`, "DELETE");
      await refresh();
    } catch (reason) {
      setError((reason as Error).message);
    }
  }
  const boardStatuses = statuses
    .filter(
      (status) => (status.board_id ?? "") === activeBoard && !status.retired,
    )
    .sort((a, b) => a.position - b.position);
  const boardItems = items.filter(
    (item) =>
      (item.data.board_id ?? "") === activeBoard && item.kind !== "board",
  );
  const activeItems = boardItems.filter(
    (item) =>
      !item.data.deleted && Boolean(item.data.archived) === showArchived,
  );
  const allTasks = items.filter(
      (item) =>
        item.kind === "task" && !item.data.deleted && !item.data.archived,
    ),
    tasks = activeItems.filter((item) => item.kind === "task");
  const visibleTasks = tasks.filter(
    (item) =>
      (!query ||
        `${item.data.title} ${item.data.body}`
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (!assignment ||
        (assignment === "mine"
          ? item.data.assignee === actor
          : !item.data.assignee)),
  );
  const taskById = new Map(allTasks.map((item) => [item.id, item]));
  const links =
    selected?.kind === "task"
      ? edges.filter(
          (edge) =>
            edge.source_id === selected.id || edge.target_id === selected.id,
        )
      : [];
  const unresolved =
    selected?.kind === "task"
      ? edges.filter(
          (edge) =>
            edge.kind === "depends_on" &&
            edge.source_id === selected.id &&
            taskById.get(edge.target_id)?.data.state !== "done",
        )
      : [];
  const newest = selected && items.find((item) => item.id === selected.id);
  return (
    <section className="projects-app" aria-label="Project management">
      <section
        className="panel shared-project project-parity-board"
        id="workspace-board"
        data-project-enhanced
        data-filters-open={filters ? "" : undefined}
      >
        <header className="sp-heading">
          <div>
            <p className="sp-eyebrow">
              {boards.find((board) => board.id === activeBoard)?.data.title ??
                "Workspace"}
            </p>
            <h1>Board</h1>
          </div>
          <label className="sp-view-select">
            <span className="sr-only">Project view</span>
            <select
              aria-label="Project view"
              value={view}
              onChange={(event) => {
                if (leaveBoard()) {
                  dirty.current = false;
                  setEditorOpen(false);
                  setView(event.target.value as View);
                }
              }}
            >
              {views.map((value) => (
                <option key={value} value={value}>
                  {value[0].toUpperCase() + value.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <div className="sp-actions">
            {view === "board" && (
              <button
                type="button"
                className="button btn-frost"
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? "Collapse board" : "Expand board"}
              </button>
            )}
            <button
              type="button"
              className="button btn matrix-btn"
              onClick={() => begin("task")}
            >
              New task +
            </button>
            <details className="project-add-menu">
              <summary
                className="button btn-frost"
                aria-label="More board actions"
              >
                •••
              </summary>
              <button
                type="button"
                className="button btn-frost"
                onClick={() => begin("deliverable")}
              >
                Add deliverable
              </button>
            </details>
          </div>
        </header>
        {boards.length > 0 && (
          <label className="project-board-picker">
            Project board
            <select
              value={activeBoard}
              onChange={(event) => {
                if (leaveBoard()) {
                  dirty.current = false;
                  setActiveBoard(event.target.value);
                  setSelected(null);
                  setEditorOpen(false);
                }
              }}
            >
              <option value="">Workspace board</option>
              {boards
                .filter((board) => !board.data.archived)
                .map((board) => (
                  <option key={board.id} value={board.id}>
                    {board.data.title}
                  </option>
                ))}
            </select>
          </label>
        )}
        <nav className="sp-tabs" aria-label="Project views">
          {views.map((value) => (
            <a
              key={value}
              href={`#projects-${value}`}
              aria-current={view === value ? "page" : undefined}
              onClick={(event) => {
                event.preventDefault();
                if (leaveBoard()) {
                  dirty.current = false;
                  setEditorOpen(false);
                  setView(value);
                }
              }}
            >
              {value[0].toUpperCase() + value.slice(1)}
            </a>
          ))}
        </nav>
        {error && (
          <p className="sp-error" role="alert">
            {error}{" "}
            <button
              type="button"
              className="button btn-frost"
              onClick={() =>
                void refresh()
                  .then(() => setError(""))
                  .catch((reason) => setError(reason.message))
              }
            >
              Reload board
            </button>
          </p>
        )}
        {!loaded ? (
          <p role="status">Loading your board…</p>
        ) : (
          <>
            {view === "board" && (
              <>
                <button
                  type="button"
                  className="sp-filter-toggle button btn-frost"
                  aria-expanded={filters}
                  onClick={() => setFilters(!filters)}
                >
                  Filters
                </button>
                <div className="sp-toolbar">
                  <label className="sp-search">
                    <span className="sr-only">Search board</span>
                    <input
                      aria-label="Search board"
                      placeholder="Search board…"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </label>
                  <label>
                    <span className="sr-only">Assignment filter</span>
                    <select
                      aria-label="Assignment filter"
                      value={assignment}
                      onChange={(event) => setAssignment(event.target.value)}
                    >
                      <option value="">All assignments</option>
                      <option value="mine">Assigned to me</option>
                      <option value="unassigned">Unassigned</option>
                    </select>
                  </label>
                  <label>
                    <span className="sr-only">Archive filter</span>
                    <select
                      aria-label="Archive filter"
                      value={showArchived ? "1" : "0"}
                      onChange={(event) => {
                        if (leaveBoard())
                          setShowArchived(event.target.value === "1");
                      }}
                    >
                      <option value="0">Active items</option>
                      <option value="1">Archived items</option>
                    </select>
                  </label>
                </div>
                <TaskColumns
                  key={activeBoard}
                  tasks={visibleTasks}
                  statuses={boardStatuses}
                  members={members}
                  namespace={storageNamespace}
                  board={activeBoard}
                  open={open}
                  change={change}
                  report={setError}
                  expanded={expanded}
                  manager={manageStatuses}
                />
                <div className="sp-desktop-sections sp-gantt-layout">
                  <section
                    className="sp-desktop-timeline"
                    aria-label="Timeline"
                  >
                    <header className="sp-section-heading">
                      <div>
                        <p className="sp-eyebrow">What’s on the horizon</p>
                        <h2>Timeline</h2>
                      </div>
                      <a
                        href="#projects-timeline"
                        onClick={(event) => {
                          event.preventDefault();
                          if (leaveBoard()) {
                            dirty.current = false;
                            setEditorOpen(false);
                            setView("timeline");
                          }
                        }}
                      >
                        View all ↗
                      </a>
                    </header>
                    <Timeline
                      items={activeItems.filter((item) =>
                        ["task", "deliverable"].includes(item.kind),
                      )}
                      statuses={boardStatuses}
                      change={change}
                      open={open}
                      reload={refresh}
                      compact
                    />
                  </section>
                  <Canvas
                    key={`${storageNamespace}:${activeBoard}`}
                    items={activeItems}
                    members={members}
                    actor={actor}
                    manager={manageStatuses}
                    namespace={storageNamespace}
                    board={activeBoard}
                    change={change}
                    open={open}
                    create={(next) => void create(next)}
                    onDirty={noteDirty}
                  />
                </div>
              </>
            )}
            {view === "timeline" && (
              <Timeline
                items={activeItems.filter((item) =>
                  ["task", "deliverable"].includes(item.kind),
                )}
                statuses={boardStatuses}
                change={change}
                open={open}
                reload={refresh}
              />
            )}
            {view === "graph" && (
              <TaskGraph tasks={tasks} edges={edges} open={open} />
            )}
            {view === "deliverables" && (
              <div className="sp-delivery-grid">
                {activeItems
                  .filter((item) => item.kind === "deliverable")
                  .map((item) => (
                    <article className="sp-card sp-delivery" key={item.id}>
                      <span className="sp-pill">{labels[item.data.state]}</span>
                      <h3>
                        <button
                          type="button"
                          className="project-text-button"
                          onClick={() => open(item)}
                        >
                          {item.data.title}
                        </button>
                      </h3>
                      <p>{item.data.body}</p>
                      <progress
                        aria-label={`${item.data.title} completion`}
                        value={
                          tasks.filter(
                            (task) =>
                              task.data.parent_id === item.id &&
                              task.data.state === "done",
                          ).length
                        }
                        max={
                          tasks.filter(
                            (task) => task.data.parent_id === item.id,
                          ).length || 1
                        }
                      />
                      <p>
                        {item.data.due_on
                          ? `Due ${item.data.due_on}`
                          : "Not scheduled"}
                      </p>
                    </article>
                  ))}
                {!activeItems.some((item) => item.kind === "deliverable") && (
                  <div className="sp-empty">
                    <h3>The next milestone starts here.</h3>
                    <p>
                      Deliverables bring scope, ownership, and dates together.
                    </p>
                    <button
                      className="button btn matrix-btn"
                      onClick={() => begin("deliverable")}
                    >
                      Add deliverable
                    </button>
                  </div>
                )}
              </div>
            )}
            {view === "trash" && (
              <div className="sp-delivery-grid">
                {boardItems
                  .filter((item) => item.data.deleted)
                  .map((item) => (
                    <article className="sp-card" key={item.id}>
                      <span className="sp-pill">Deleted</span>
                      <h3>
                        <button
                          className="project-text-button"
                          onClick={() => open(item)}
                        >
                          {item.data.title}
                        </button>
                      </h3>
                      <button
                        className="button btn-frost"
                        onClick={() =>
                          void safeChange(item, { deleted: false })
                        }
                      >
                        Restore
                      </button>
                    </article>
                  ))}
                {!boardItems.some((item) => item.data.deleted) && (
                  <p className="sp-empty">
                    Trash is empty. Deleted tasks can be restored here.
                  </p>
                )}
              </div>
            )}
            {view === "activity" && (
              <div className="sp-activity">
                {boardItems
                  .slice()
                  .sort((a, b) =>
                    (b.updated_at ?? "").localeCompare(a.updated_at ?? ""),
                  )
                  .map((item) => (
                    <article key={item.id}>
                      <span className="sp-activity-dot" />
                      <div>
                        <header>
                          <strong>
                            {members.find(
                              (member) => member.id === item.author_id,
                            )?.display_name ?? "Workspace member"}
                          </strong>
                          <time dateTime={item.updated_at}>
                            {item.updated_at
                              ? new Date(item.updated_at).toLocaleString()
                              : ""}
                          </time>
                        </header>
                        <button
                          className="project-text-button"
                          onClick={() => open(item)}
                        >
                          {item.data.title}
                        </button>
                        <p>{item.data.body}</p>
                      </div>
                    </article>
                  ))}
              </div>
            )}
          </>
        )}
        {editorOpen && (
          <aside
            className={`project-item-pane${kind === "resource" ? " resource-pane" : ""}`}
            aria-label={selected ? `Edit ${kind}` : `New ${kind}`}
          >
            <header className="task-detail-header">
              <div>
                <p className="sp-eyebrow">{kind}</p>
                <h2>{selected?.data.title ?? `New ${kind}`}</h2>
              </div>
              <button
                type="button"
                className="button btn-frost"
                onClick={close}
                aria-label="Close item"
              >
                ×
              </button>
            </header>
            <div className="task-detail-content">
              {newest && newest.revision !== selected?.revision && (
                <p role="alert">
                  This item changed.{" "}
                  <button
                    type="button"
                    onClick={() => {
                      dirty.current = false;
                      setSelected(newest);
                    }}
                  >
                    Load current version
                  </button>
                </p>
              )}
              <form
                className="sp-form project-item-form"
                onChange={() => {
                  dirty.current = true;
                }}
                key={selected ? `${selected.id}:${selected.revision}` : kind}
                onSubmit={save}
              >
                <label>
                  Title
                  <input
                    required
                    name="title"
                    maxLength={200}
                    defaultValue={selected?.data.title ?? ""}
                  />
                </label>
                <label>
                  Description
                  <textarea
                    name="body"
                    maxLength={20000}
                    defaultValue={selected?.data.body ?? ""}
                  />
                </label>
                {kind === "task" ? (
                  <label>
                    Status
                    <select
                      name="status_id"
                      defaultValue={
                        selected?.data.status_id ??
                        boardStatuses.find((status) => status.is_default)?.id
                      }
                    >
                      {boardStatuses
                        .filter((status) => !status.retired)
                        .map((status) => (
                          <option key={status.id} value={status.id}>
                            {status.name}
                          </option>
                        ))}
                    </select>
                  </label>
                ) : (
                  <label>
                    Status
                    <select
                      name="state"
                      defaultValue={selected?.data.state ?? "todo"}
                    >
                      {states.map((value) => (
                        <option key={value} value={value}>
                          {labels[value]}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  Priority
                  <select
                    name="priority"
                    defaultValue={selected?.data.priority ?? "normal"}
                  >
                    {["low", "normal", "high", "urgent"].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                {["assignee", "reviewer"].map((name) => (
                  <label key={name}>
                    {name === "assignee" ? "Assigned to" : "Reviewer"}
                    <select
                      name={name}
                      defaultValue={
                        selected?.data[name as "assignee" | "reviewer"] ?? ""
                      }
                    >
                      <option value="">Unassigned</option>
                      {members.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.display_name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                <label>
                  Starts
                  <input
                    type="date"
                    name="starts_on"
                    defaultValue={selected?.data.starts_on ?? ""}
                  />
                </label>
                <label>
                  Due
                  <input
                    type="date"
                    name="due_on"
                    defaultValue={selected?.data.due_on ?? ""}
                  />
                </label>
                <label>
                  Acceptance criteria
                  <textarea
                    name="acceptance"
                    maxLength={6000}
                    defaultValue={selected?.data.acceptance ?? ""}
                  />
                </label>
                {kind === "task" && (
                  <label>
                    Deliverable
                    <select
                      name="parent_id"
                      defaultValue={selected?.data.parent_id ?? ""}
                    >
                      <option value="">No deliverable</option>
                      {activeItems
                        .filter((item) => item.kind === "deliverable")
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.data.title}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                {kind === "note" && (
                  <>
                    <label>
                      Task
                      <select
                        name="parent_id"
                        defaultValue={
                          selected?.data.parent_id ?? noteParent ?? ""
                        }
                      >
                        <option value="">Workspace note</option>
                        {tasks.map((task) => (
                          <option key={task.id} value={task.id}>
                            {task.data.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Color
                      <select
                        name="color"
                        defaultValue={selected?.data.color ?? "yellow"}
                      >
                        {[
                          "yellow",
                          "blue",
                          "pink",
                          "green",
                          "orange",
                          "purple",
                          "teal",
                          "gray",
                        ].map((color) => (
                          <option key={color}>{color}</option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
                {kind === "resource" && (
                  <fieldset>
                    <legend>Resource</legend>
                    <label>
                      Type
                      <select
                        name="resource_kind"
                        defaultValue={
                          selected?.data.resource?.kind ?? "website"
                        }
                      >
                        {[
                          "website",
                          "server",
                          "database",
                          "api",
                          "repository",
                          "domain",
                          "storage",
                          "other",
                        ].map((value) => (
                          <option key={value}>{value}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Resource status
                      <select
                        name="resource_status"
                        defaultValue={
                          selected?.data.resource?.status ?? "planned"
                        }
                      >
                        {["planned", "active", "retired"].map((value) => (
                          <option key={value}>{value}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Provider
                      <input
                        name="resource_provider"
                        maxLength={120}
                        defaultValue={selected?.data.resource?.provider ?? ""}
                      />
                    </label>
                    <label>
                      Environment
                      <input
                        name="resource_environment"
                        maxLength={80}
                        defaultValue={
                          selected?.data.resource?.environment ?? ""
                        }
                      />
                    </label>
                    <label>
                      Public URL
                      <input
                        type="url"
                        name="resource_public_url"
                        maxLength={2048}
                        defaultValue={selected?.data.resource?.public_url ?? ""}
                      />
                    </label>
                  </fieldset>
                )}
                <button
                  className="button btn matrix-btn"
                  disabled={busy}
                  type="submit"
                >
                  {busy ? "Saving…" : "Save"}
                </button>
              </form>
              {selected && (
                <>
                  <div className="projects-actions">
                    <button
                      disabled={busy}
                      onClick={() =>
                        void safeChange(selected, {
                          archived: !selected.data.archived,
                        })
                      }
                    >
                      {selected.data.archived ? "Restore" : "Archive"}
                    </button>
                    {selected.data.state === "review" && (
                      <>
                        <button
                          disabled={busy}
                          onClick={() => void action(selected, "approve")}
                        >
                          Accept review
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => void action(selected, "changes")}
                        >
                          Request changes
                        </button>
                      </>
                    )}
                    <button
                      onClick={() =>
                        void api<{ events: typeof events }>(
                          `/items/${selected.id}/history`,
                        )
                          .then((value) => setEvents(value.events))
                          .catch((reason) => setError(reason.message))
                      }
                    >
                      History
                    </button>
                  </div>
                  {selected.kind === "task" && (
                    <section className="projects-related">
                      <h3>Task graph</h3>
                      {unresolved.length > 0 && (
                        <p role="status">
                          Waiting on {unresolved.length} linked task
                          {unresolved.length === 1 ? "" : "s"}; status changes
                          remain available.
                        </p>
                      )}
                      {links.map((edge) => (
                        <p key={edge.id}>
                          {edge.kind === "related"
                            ? "Related"
                            : edge.source_id === selected.id
                              ? "Depends on"
                              : "Required by"}
                          :{" "}
                          {taskById.get(
                            edge.source_id === selected.id
                              ? edge.target_id
                              : edge.source_id,
                          )?.data.title ?? "Task"}{" "}
                          <button
                            disabled={busy}
                            type="button"
                            onClick={() => void unlink(edge.id)}
                          >
                            Remove
                          </button>
                        </p>
                      ))}
                      <form onSubmit={link}>
                        <label>
                          Link task
                          <select name="target_id" required defaultValue="">
                            <option value="">Choose a task</option>
                            {allTasks
                              .filter((task) => task.id !== selected.id)
                              .map((task) => (
                                <option key={task.id} value={task.id}>
                                  {task.data.title}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label>
                          Relationship
                          <select name="kind">
                            <option value="related">Related</option>
                            <option value="depends_on">Depends on</option>
                          </select>
                        </label>
                        <button disabled={busy}>Add link</button>
                      </form>
                      <h3>Checklist</h3>
                      {(selected.data.checklist ?? []).map((entry, index) => (
                        <label key={entry.id}>
                          <input
                            type="checkbox"
                            checked={entry.done}
                            onChange={() =>
                              void safeChange(selected, {
                                checklist: (selected.data.checklist ?? []).map(
                                  (value, at) =>
                                    at === index
                                      ? { ...value, done: !value.done }
                                      : value,
                                ),
                              })
                            }
                          />
                          {entry.text}
                        </label>
                      ))}
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          const input = event.currentTarget.elements.namedItem(
                            "checklist_text",
                          ) as HTMLInputElement;
                          const value = input.value.trim();
                          if (value)
                            void change(selected, {
                              checklist: [
                                ...(selected.data.checklist ?? []),
                                {
                                  id: crypto.randomUUID(),
                                  text: value,
                                  done: false,
                                },
                              ],
                            })
                              .then(() => {
                                input.value = "";
                              })
                              .catch((reason) => setError(reason.message));
                        }}
                      >
                        <label>
                          Add checklist item
                          <input
                            name="checklist_text"
                            maxLength={500}
                            required
                          />
                        </label>
                        <button disabled={busy}>Add</button>
                      </form>
                      <h3>Related notes</h3>
                      {items
                        .filter(
                          (item) =>
                            item.kind === "note" &&
                            item.data.parent_id === selected.id &&
                            !item.data.deleted,
                        )
                        .map((note) => (
                          <p key={note.id}>
                            <button
                              className="project-text-button"
                              type="button"
                              onClick={() => open(note)}
                            >
                              {note.data.title}
                            </button>
                          </p>
                        ))}
                      <button
                        type="button"
                        onClick={() => {
                          setNoteParent(selected.id);
                          begin("note");
                        }}
                      >
                        Add task note
                      </button>
                    </section>
                  )}
                  {events.map((event) => (
                    <p key={event.sequence}>
                      {event.operation} ·{" "}
                      {new Date(event.created_at).toLocaleString()}
                    </p>
                  ))}
                  <h3>Replies</h3>
                  {items
                    .filter(
                      (item) =>
                        item.kind === "comment" &&
                        item.data.parent_id === selected.id,
                    )
                    .map((item) => (
                      <p key={item.id}>{item.data.body}</p>
                    ))}
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = event.currentTarget;
                      const body = String(
                        new FormData(form).get("reply") ?? "",
                      );
                      setBusy(true);
                      void api("/items", "POST", {
                        idempotency_key: crypto.randomUUID(),
                        kind: "comment",
                        data: {
                          title: "Reply",
                          body,
                          parent_id: selected.id,
                          visibility: selected.data.visibility,
                        },
                      })
                        .then(() => {
                          form.reset();
                          return refresh();
                        })
                        .catch((reason) => setError(reason.message))
                        .finally(() => setBusy(false));
                    }}
                  >
                    <label>
                      Reply
                      <textarea name="reply" required />
                    </label>
                    <button disabled={busy}>Add reply</button>
                  </form>
                </>
              )}
            </div>
          </aside>
        )}
        <details className="project-settings">
          <summary>Board settings</summary>
          {manageStatuses && (
            <>
              <h2>Project boards</h2>
              <form
                className="sp-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = event.currentTarget,
                    name = String(new FormData(form).get("name") ?? "").trim();
                  void api<Item>("/items", "POST", {
                    idempotency_key: crypto.randomUUID(),
                    kind: "board",
                    data: { title: name },
                  })
                    .then((board) => {
                      setActiveBoard(board.id);
                      form.reset();
                      return refresh();
                    })
                    .catch((reason) => setError(reason.message));
                }}
              >
                <label>
                  Board name
                  <input name="name" maxLength={120} required />
                </label>
                <button className="button btn matrix-btn" disabled={busy}>
                  Create board
                </button>
              </form>
              {boards.map((board) => (
                <p key={board.id}>
                  {board.data.title}{" "}
                  <button
                    className="button btn-frost"
                    disabled={busy}
                    onClick={() =>
                      void change(board, { archived: !board.data.archived })
                        .then(refresh)
                        .catch((reason) => setError(reason.message))
                    }
                  >
                    {board.data.archived ? "Restore board" : "Archive board"}
                  </button>
                </p>
              ))}
              <h2>Board statuses</h2>
              <StatusEditor
                key={activeBoard}
                statuses={statuses.filter(
                  (status) => (status.board_id ?? "") === activeBoard,
                )}
                onSave={async (input) => {
                  try {
                    await api("/statuses", "POST", {
                      ...(input as Record<string, unknown>),
                      data: {
                        ...(input as { data: Record<string, unknown> }).data,
                        board_id: activeBoard || null,
                      },
                    });
                    await refresh();
                  } catch (reason) {
                    setError((reason as Error).message);
                  }
                }}
              />
            </>
          )}
          <details>
            <summary>API &amp; MCP connections</summary>
            <p>
              API: <code>{location.origin}/api/projects</code>
              <br />
              MCP: <code>{location.origin}/api/projects/mcp</code>
            </p>
            <button
              className="button btn-frost"
              onClick={() =>
                void api<{ token: string }>("/keys", "POST", {
                  name: "Project client",
                  scopes: ["project:read", "project:write"],
                })
                  .then((value) => setKey(value.token))
                  .catch((reason) => setError(reason.message))
              }
            >
              Create credential
            </button>
            {key && (
              <label>
                Copy now; it will not be shown again
                <input
                  readOnly
                  value={key}
                  onFocus={(event) => event.target.select()}
                />
                <button onClick={() => setKey("")}>Dismiss</button>
              </label>
            )}
            <button
              className="button btn-frost"
              onClick={() =>
                void api<{ keys: typeof keys }>("/keys")
                  .then((value) => setKeys(value.keys))
                  .catch((reason) => setError(reason.message))
              }
            >
              Manage credentials
            </button>
            {keys
              .filter((item) => !item.revoked_at)
              .map((item) => (
                <p key={item.id}>
                  {item.name}{" "}
                  <button
                    className="button btn-frost"
                    onClick={() =>
                      void api(`/keys/${item.id}`, "DELETE")
                        .then(() =>
                          setKeys((current) =>
                            current.filter((value) => value.id !== item.id),
                          ),
                        )
                        .catch((reason) => setError(reason.message))
                    }
                  >
                    Revoke
                  </button>
                </p>
              ))}
          </details>
        </details>
      </section>
    </section>
  );
}
function StatusEditor({
  statuses,
  onSave,
}: {
  statuses: Status[];
  onSave: (input: unknown) => Promise<void>;
}) {
  const [selected, setSelected] = useState("");
  const status = statuses.find((value) => value.id === selected);
  return (
    <>
      <label>
        Status
        <select
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">New status</option>
          {statuses
            .filter((value) => !value.retired)
            .map((value) => (
              <option key={value.id} value={value.id}>
                {value.name}
              </option>
            ))}
        </select>
      </label>
      <form
        key={`${selected}:${status?.revision}`}
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void onSave({
            ...(status ? { id: status.id } : {}),
            revision: status?.revision ?? 0,
            data: {
              name: String(form.get("name")),
              color: String(form.get("color")),
              category: status?.category ?? String(form.get("category")),
              legacy_state: status?.legacy_state ?? "",
              position: Number(form.get("position")),
              is_default: form.has("is_default"),
              retired: form.has("retired"),
              replacement_id: form.get("replacement_id") || null,
            },
          });
        }}
      >
        <label>
          Name
          <input
            name="name"
            maxLength={60}
            required
            defaultValue={status?.name ?? ""}
          />
        </label>
        <label>
          Category
          <select
            name="category"
            disabled={Boolean(status)}
            defaultValue={status?.category ?? "todo"}
          >
            <option value="todo">Not started</option>
            <option value="doing">In progress</option>
            <option value="done">Finished</option>
          </select>
        </label>
        <label>
          Color
          <select name="color" defaultValue={status?.color ?? "blue"}>
            {["gray", "blue", "orange", "purple", "green", "pink", "teal"].map(
              (color) => (
                <option key={color}>{color}</option>
              ),
            )}
          </select>
        </label>
        <label>
          Position
          <input
            name="position"
            type="number"
            min={0}
            max={10000}
            defaultValue={status?.position ?? statuses.length}
          />
        </label>
        <label>
          <input
            name="is_default"
            type="checkbox"
            defaultChecked={status?.is_default}
          />
          Default for new tasks
        </label>
        {status && (
          <>
            <label>
              <input name="retired" type="checkbox" />
              Retire this status
            </label>
            <label>
              Replacement
              <select name="replacement_id" defaultValue="">
                <option value="">Choose replacement when retiring</option>
                {statuses
                  .filter(
                    (value) =>
                      !value.retired &&
                      value.id !== status.id &&
                      value.category === status.category,
                  )
                  .map((value) => (
                    <option key={value.id} value={value.id}>
                      {value.name}
                    </option>
                  ))}
              </select>
            </label>
          </>
        )}
        <button type="submit">Save status</button>
      </form>
    </>
  );
}

function TaskGraph({
  tasks,
  edges,
  open,
}: {
  tasks: Item[];
  edges: Edge[];
  open: (task: Item) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [focus, setFocus] = useState<string | null>(null);
  const columns = Math.min(4, Math.max(1, tasks.length));
  const points = new Map(
    tasks.map((task, index) => [
      task.id,
      {
        x: 30 + (index % columns) * 280,
        y: 40 + Math.floor(index / columns) * 150,
      },
    ]),
  );
  const width = columns * 280 + 20,
    height = Math.max(240, Math.ceil(tasks.length / columns) * 150 + 40);
  return (
    <section className="projects-graph-surface">
      <div className="projects-actions">
        <button
          onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}
          aria-label="Zoom out"
        >
          −
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          onClick={() => setZoom((value) => Math.min(2, value + 0.25))}
          aria-label="Zoom in"
        >
          +
        </button>
      </div>
      {!tasks.length ? (
        <p>Add a task to start the graph.</p>
      ) : (
        <div className="projects-graph-scroll">
          <svg
            width={width * zoom}
            height={height * zoom}
            viewBox={`0 0 ${width} ${height}`}
            role="group"
            aria-label="Task graph"
          >
            <defs>
              <marker
                id="project-dependency-arrow"
                markerWidth="8"
                markerHeight="8"
                refX="7"
                refY="4"
                orient="auto"
              >
                <path d="M0,0 L8,4 L0,8 Z" fill="currentColor" />
              </marker>
            </defs>
            {edges.map((edge) => {
              const a = points.get(edge.source_id),
                b = points.get(edge.target_id);
              if (!a || !b) return null;
              return (
                <path
                  key={edge.id}
                  d={`M${a.x + 110},${a.y + 80} C${a.x + 110},${a.y + 115} ${b.x + 110},${b.y - 35} ${b.x + 110},${b.y}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={
                    focus && [edge.source_id, edge.target_id].includes(focus)
                      ? 3
                      : 1.5
                  }
                  opacity={
                    !focus || [edge.source_id, edge.target_id].includes(focus)
                      ? 0.8
                      : 0.15
                  }
                  strokeDasharray={edge.kind === "related" ? "5 4" : undefined}
                  markerEnd={
                    edge.kind === "depends_on"
                      ? "url(#project-dependency-arrow)"
                      : undefined
                  }
                >
                  <title>
                    {
                      tasks.find((task) => task.id === edge.source_id)?.data
                        .title
                    }{" "}
                    {edge.kind === "depends_on"
                      ? "depends on"
                      : "is related to"}{" "}
                    {
                      tasks.find((task) => task.id === edge.target_id)?.data
                        .title
                    }
                  </title>
                </path>
              );
            })}
            {tasks.map((task) => {
              const point = points.get(task.id)!;
              return (
                <g
                  key={task.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open task: ${task.data.title}`}
                  className="projects-graph-task"
                  onFocus={() => setFocus(task.id)}
                  onBlur={() => setFocus(null)}
                  onMouseEnter={() => setFocus(task.id)}
                  onMouseLeave={() => setFocus(null)}
                  onClick={() => open(task)}
                  onKeyDown={(event) => {
                    if (["Enter", " "].includes(event.key)) {
                      event.preventDefault();
                      open(task);
                    }
                  }}
                >
                  <rect
                    x={point.x}
                    y={point.y}
                    width={220}
                    height={80}
                    rx={12}
                  />
                  <text x={point.x + 12} y={point.y + 28}>
                    {task.data.title.length > 25
                      ? task.data.title.slice(0, 24) + "…"
                      : task.data.title}
                  </text>
                  <text
                    className="graph-state"
                    x={point.x + 12}
                    y={point.y + 56}
                  >
                    {labels[task.data.state]}
                  </text>
                  <title>{task.data.title}</title>
                </g>
              );
            })}
          </svg>
        </div>
      )}
      <p>
        Arrows point to dependencies. Dashed lines connect related tasks. Select
        a task to edit it.
      </p>
    </section>
  );
}
