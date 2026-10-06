import { useEffect, useRef, useState } from "react";
import { readDeviceState, writeDeviceState } from "../deviceState";
import { type Item, type Change, type Member, colors } from "./types";
type Position = { x: number; y: number };
type Positions = Record<string, Position>;
function Note({
  item,
  change,
  open,
  author,
  canEdit,
  onDirty,
}: {
  item: Item;
  change: Change;
  open: () => void;
  author: string;
  canEdit: boolean;
  onDirty: (id: string, dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState({
    title: item.data.title,
    body: item.data.body,
    color: item.data.color,
  });
  const [base, setBase] = useState(item),
    [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const [palette, setPalette] = useState(false);
  const latest = useRef(draft);
  latest.current = draft;
  useEffect(() => {
    if (!dirty && !saving) {
      setBase(item);
      setDraft({
        title: item.data.title,
        body: item.data.body,
        color: item.data.color,
      });
    }
  }, [item, dirty, saving]);
  async function save() {
    if (saving || !dirty) return;
    const submitted = { ...draft, title: draft.title.trim() || "Sticky note" };
    setSaving(true);
    setError("");
    try {
      const result = await change(base, submitted);
      setBase(result);
      if (latest.current === draft) setDirty(false);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSaving(false);
    }
  }
  useEffect(() => {
    if (!dirty || saving || error) return;
    const timer = setTimeout(() => void save(), 750);
    return () => clearTimeout(timer);
  }, [draft, dirty, saving, error]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    onDirty(item.id, dirty);
    return () => onDirty(item.id, false);
  }, [item.id, dirty, onDirty]);
  const edit = (values: Partial<typeof draft>) => {
    setDraft({ ...draft, ...values });
    setDirty(true);
  };
  return (
    <>
      <div className="sp-note-heading">
        <span className="sp-pill">Shared</span>
        <span className="sp-note-author">{author}</span>
      </div>
      {canEdit ? (
        <>
          <div className="sp-note-controls">
            <button
              type="button"
              className="sp-note-tool"
              aria-label={`Note color: ${item.data.title}`}
              aria-expanded={palette}
              onClick={() => setPalette(!palette)}
            >
              <span className="sp-note-color-preview" />
            </button>
            {palette && (
              <div
                className="sp-note-options sp-note-palette"
                role="group"
                aria-label="Note color"
              >
                {colors.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className="sp-note-swatch"
                    data-note-color={color}
                    aria-label={color}
                    aria-pressed={draft.color === color}
                    onClick={() => {
                      edit({ color });
                      setPalette(false);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
          <div className="sp-note-editor">
            <input
              aria-label={`Note title: ${item.data.title}`}
              placeholder="Title"
              maxLength={200}
              value={draft.title}
              onChange={(e) => edit({ title: e.target.value })}
            />
            <textarea
              aria-label={`Note text: ${item.data.title}`}
              placeholder="Write a note…"
              maxLength={20000}
              value={draft.body}
              onChange={(e) => edit({ body: e.target.value })}
            />
            <p className="sp-note-save-status" role="status">
              {error ||
                (saving ? "Saving…" : dirty ? "Unsaved changes" : "Saved")}
            </p>
            {error && (
              <div className="sp-note-recovery">
                <button type="button" onClick={() => void save()}>
                  Retry save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDirty(false);
                    setError("");
                    setBase(item);
                    setDraft({
                      title: item.data.title,
                      body: item.data.body,
                      color: item.data.color,
                    });
                  }}
                >
                  Reload saved note
                </button>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <h3>
            <button
              className="project-text-button"
              type="button"
              onClick={open}
            >
              {item.data.title}
            </button>
          </h3>
          <p>{item.data.body}</p>
        </>
      )}
      {item.data.parent_id && (
        <span className="sp-related-button sp-pill">Related task</span>
      )}
      <button
        type="button"
        className="sp-note-open project-text-button"
        onClick={open}
      >
        Open note ↗
      </button>
    </>
  );
}
export function Canvas({
  items,
  members,
  actor,
  manager,
  namespace,
  board,
  change,
  open,
  create,
  onDirty,
}: {
  items: Item[];
  members: Member[];
  actor?: string;
  manager: boolean;
  namespace?: string;
  board: string;
  change: Change;
  open: (item: Item) => void;
  create: (kind: string) => void;
  onDirty: (id: string, dirty: boolean) => void;
}) {
  const [positions, setPositions] = useState<Positions>({}),
    [query, setQuery] = useState(""),
    [resourceKind, setResourceKind] = useState(""),
    [resourceStatus, setResourceStatus] = useState("");
  const area = `projects.positions.${board || "default"}`;
  const canvas = useRef<HTMLDivElement>(null),
    drag = useRef<{
      id: string;
      pointer: number;
      start: Position;
      origin: Position;
      next: Position;
      target: HTMLButtonElement;
    } | null>(null);
  const [moving, setMoving] = useState<{ id: string; at: Position } | null>(
    null,
  );
  useEffect(() => {
    const saved = readDeviceState(namespace, area);
    const valid: Positions = {};
    if (saved && typeof saved === "object" && !Array.isArray(saved))
      for (const [id, point] of Object.entries(saved)) {
        const p = point as Position;
        if (
          p &&
          Number.isFinite(p.x) &&
          Number.isFinite(p.y) &&
          p.x >= 0 &&
          p.y >= 0
        )
          valid[id] = p;
      }
    setPositions(valid);
  }, [namespace, area]);
  const commit = (id: string, at: Position) => {
    const next = { ...positions, [id]: at };
    setPositions(next);
    writeDeviceState(namespace, area, next);
  };
  const cancel = () => {
    const current = drag.current;
    drag.current = null;
    setMoving(null);
    if (current?.target.hasPointerCapture?.(current.pointer))
      current.target.releasePointerCapture(current.pointer);
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    window.addEventListener("keydown", key);
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
    };
  }, []);
  const notes = items.filter((item) => item.kind === "note"),
    resources = items.filter((item) => item.kind === "resource");
  const visible = [
    ...resources.filter(
      (item) =>
        (!query ||
          `${item.data.title} ${item.data.body} ${item.data.resource?.provider ?? ""}`
            .toLowerCase()
            .includes(query.toLowerCase())) &&
        (!resourceKind || item.data.resource?.kind === resourceKind) &&
        (!resourceStatus || item.data.resource?.status === resourceStatus),
    ),
    ...notes,
  ];
  const bound = (point: Position) => ({
    x: Math.max(
      0,
      Math.min(
        point.x,
        Math.max(0, (canvas.current?.clientWidth ?? 1000) - 240),
      ),
    ),
    y: Math.max(0, Math.min(point.y, 100000)),
  });
  return (
    <section className="sp-scrapbook-notes" aria-label="Notes & Resources">
      <header className="sp-section-heading">
        <div>
          <p className="sp-eyebrow">Ideas, systems &amp; useful things</p>
          <h2>Notes &amp; Resources</h2>
          <p className="sp-note-hint">
            {notes.length} notes · {resources.length} resources
          </p>
        </div>
        <div className="sp-actions">
          <button
            type="button"
            className="button btn matrix-btn"
            onClick={() => create("note")}
          >
            New Note
          </button>
          <button
            type="button"
            className="button btn matrix-btn"
            onClick={() => create("resource")}
          >
            New Resource
          </button>
          <button
            type="button"
            className="button btn-frost"
            onClick={() => {
              cancel();
              setPositions({});
              writeDeviceState(namespace, area, {});
            }}
          >
            Tidy cards
          </button>
        </div>
      </header>
      <p className="sp-note-hint">
        Drag a card by its handle, or use the arrow keys. Your arrangement stays
        in this browser.
      </p>
      <details className="resource-board-filters">
        <summary>Resources · {resources.length} · Search &amp; filters</summary>
        <div className="project-resource-filters">
          <label>
            Search resources
            <input value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <label>
            Type
            <select
              value={resourceKind}
              onChange={(e) => setResourceKind(e.target.value)}
            >
              <option value="">All types</option>
              {[
                "website",
                "server",
                "database",
                "api",
                "repository",
                "domain",
                "storage",
                "other",
              ].map((kind) => (
                <option key={kind}>{kind}</option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select
              value={resourceStatus}
              onChange={(e) => setResourceStatus(e.target.value)}
            >
              <option value="">All statuses</option>
              {["planned", "active", "retired"].map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
          </label>
        </div>
      </details>
      <div
        ref={canvas}
        className="sp-scrapbook-note-grid project-note-canvas"
        style={{
          minHeight: Math.max(
            355,
            ...Object.values(positions).map((p) => p.y + 370),
          ),
        }}
      >
        {visible.map((item) => {
          const resource = item.kind === "resource",
            canEdit = manager || actor === item.author_id;
          const point = moving?.id === item.id ? moving.at : positions[item.id];
          return (
            <div className="sp-note-slot" key={item.id}>
              <article
                className={`sp-sticky${resource ? " sp-resource" : ""}${point ? " is-placed" : ""}${moving?.id === item.id ? " is-dragging" : ""}`}
                data-color={resource ? "blue" : item.data.color ?? "yellow"}
                data-note-editable={!resource && canEdit ? "" : undefined}
                style={
                  point
                    ? { left: point.x, top: point.y, width: 240 }
                    : undefined
                }
              >
                <button
                  type="button"
                  className="sp-note-handle"
                  aria-label={`Move ${resource ? "resource" : "note"}: ${item.data.title}`}
                  title="Drag to move · Arrow keys to move · Escape to cancel"
                  onPointerDown={(event) => {
                    if (event.button !== 0 || drag.current) return;
                    const card = event.currentTarget.closest("article")!;
                    event.preventDefault();
                    const origin = positions[item.id] ?? {
                      x: card.offsetLeft,
                      y: card.offsetTop,
                    };
                    drag.current = {
                      id: item.id,
                      pointer: event.pointerId,
                      start: { x: event.clientX, y: event.clientY },
                      origin,
                      next: origin,
                      target: event.currentTarget,
                    };
                    event.currentTarget.setPointerCapture?.(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    const current = drag.current;
                    if (!current || current.pointer !== event.pointerId) return;
                    const next = bound({
                      x: current.origin.x + event.clientX - current.start.x,
                      y: current.origin.y + event.clientY - current.start.y,
                    });
                    current.next = next;
                    setMoving({ id: item.id, at: next });
                  }}
                  onPointerUp={(event) => {
                    if (drag.current?.pointer !== event.pointerId) return;
                    commit(item.id, drag.current.next);
                    cancel();
                  }}
                  onPointerCancel={cancel}
                  onLostPointerCapture={cancel}
                  onKeyDown={(event) => {
                    if (!event.key.startsWith("Arrow")) return;
                    event.preventDefault();
                    const card = event.currentTarget.closest("article")!,
                      at = positions[item.id] ?? {
                        x: card.offsetLeft,
                        y: card.offsetTop,
                      },
                      amount = event.shiftKey ? 40 : 10;
                    commit(
                      item.id,
                      bound({
                        x:
                          at.x +
                          (event.key === "ArrowRight"
                            ? amount
                            : event.key === "ArrowLeft"
                              ? -amount
                              : 0),
                        y:
                          at.y +
                          (event.key === "ArrowDown"
                            ? amount
                            : event.key === "ArrowUp"
                              ? -amount
                              : 0),
                      }),
                    );
                  }}
                >
                  ⠿
                </button>
                {resource ? (
                  <>
                    <div className="sp-note-heading">
                      <span className="sp-pill">Resource</span>
                    </div>
                    <h3>
                      <button
                        className="project-text-button"
                        type="button"
                        onClick={() => open(item)}
                      >
                        {item.data.title}
                      </button>
                    </h3>
                    <p>{item.data.body || item.data.resource?.provider}</p>
                    <div className="resource-card-meta">
                      <span>{item.data.resource?.kind ?? "other"}</span>
                      <span>{item.data.resource?.status ?? "planned"}</span>
                      <span>{item.data.resource?.environment}</span>
                    </div>
                    <button
                      className="sp-note-open project-text-button"
                      type="button"
                      onClick={() => open(item)}
                    >
                      Open resource ↗
                    </button>
                  </>
                ) : (
                  <Note
                    item={item}
                    change={change}
                    open={() => open(item)}
                    author={
                      members.find((member) => member.id === item.author_id)
                        ?.display_name ?? "Workspace member"
                    }
                    canEdit={canEdit}
                    onDirty={onDirty}
                  />
                )}
              </article>
            </div>
          );
        })}
        {!visible.length && (
          <div className="sp-empty">
            <h3>Leave a little inspiration.</h3>
            <p>Ideas, reminders and updates belong here.</p>
            <button
              type="button"
              className="button btn matrix-btn"
              onClick={() => create("note")}
            >
              Add a note
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
