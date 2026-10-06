import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Change, Edge, Item } from "./types";
import { stickerFor, ResourceTags, StickerPicker, parseTags } from "./ResourceSticker";
import { colors } from "./types";
import { readDeviceState, writeDeviceState } from "../deviceState";
import "./connected-cards.css";

export type Connect = (
  source: Item,
  target: Item,
  kind?: "related" | "depends_on",
) => Promise<void>;
export function NoteMarkdown({
  text,
  items,
  open,
}: {
  text: string;
  items: Item[];
  open: (item: Item) => void;
}) {
  return (
    <div className="project-note-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          img: ({ alt }) => <span>{alt}</span>,
          a: ({ href, children }) => (
            <a
              href={href}
              rel="noopener noreferrer"
              onClick={(e) => {
                const target = items.find(
                  (i) =>
                    href === `#resource-${i.id}` || href === `#item-${i.id}`,
                );
                if (target) {
                  e.preventDefault();
                  open(target);
                }
              }}
            >
              {children}
            </a>
          ),
        }}
      >
        {text || "Write a note…"}
      </Markdown>
    </div>
  );
}

export function NoteEditor({
  item,
  items,
  change,
  open,
  onDirty,
  editable,
  compact = false,
}: {
  item: Item;
  items: Item[];
  change: Change;
  open: (item: Item) => void;
  onDirty: (id: string, value: boolean) => void;
  editable: boolean;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState({
    title: item.data.title,
    body: item.data.body,
    color: item.data.color,
  });
  const [base, setBase] = useState(item),
    [editing, setEditing] = useState(false),
    [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const [mention, setMention] = useState<{
      start: number;
      end: number;
      query: string;
    } | null>(null),
    [choice, setChoice] = useState(0);
  const input = useRef<HTMLTextAreaElement>(null),
    latest = useRef(draft);
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
  useEffect(() => {
    onDirty(item.id, dirty);
    return () => onDirty(item.id, false);
  }, [item.id, dirty, onDirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function save() {
    if (saving || !dirty) return;
    setSaving(true);
    setError("");
    const submitted = draft;
    try {
      const updated = await change(base, {
        ...submitted,
        title: submitted.title.trim() || "Sticky note",
      });
      setBase(updated);
      if (latest.current === submitted) setDirty(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  useEffect(() => {
    if (!dirty || saving || error) return;
    const timer = setTimeout(() => void save(), 750);
    return () => clearTimeout(timer);
  }, [draft, dirty, saving, error]);
  const edit = (values: Partial<typeof draft>) => {
    setDraft((d) => ({ ...d, ...values }));
    setDirty(true);
  };
  const candidates = items
    .filter(
      (i) =>
        i.kind === "resource" &&
        !i.data.deleted &&
        !i.data.archived &&
        i.data.title.toLowerCase().includes(mention?.query.toLowerCase() ?? ""),
    )
    .slice(0, 8);
  const detect = (text: string, caret: number) => {
    const match = /(?:^|\s)!([^\n!]{0,80})$/.exec(text.slice(0, caret));
    setMention(
      match
        ? { start: caret - match[1].length - 1, end: caret, query: match[1] }
        : null,
    );
    setChoice(0);
  };
  const insert = (resource: Item) => {
    if (!mention) return;
    const link = `[${resource.data.title.replace(/[\[\]\\]/g, "") || "Resource"}](#resource-${resource.id})`;
    const body =
      draft.body.slice(0, mention.start) + link + draft.body.slice(mention.end);
    edit({ body });
    setMention(null);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(
        mention.start + link.length,
        mention.start + link.length,
      );
    });
  };
  return (
    <div className={`connected-note-editor${compact ? " is-compact" : ""}`}>
      {editable ? (
        <input
          aria-label={`Note title: ${item.data.title}`}
          value={draft.title}
          maxLength={200}
          onChange={(e) => edit({ title: e.target.value })}
        />
      ) : (
        <h3>{draft.title}</h3>
      )}
      {editing && editable ? (
        <div className="connected-note-input">
          <textarea
            ref={input}
            autoFocus
            aria-label={`Note text: ${item.data.title}`}
            value={draft.body}
            maxLength={20000}
            onChange={(e) => {
              edit({ body: e.target.value });
              detect(e.target.value, e.target.selectionStart);
            }}
            onClick={(e) =>
              detect(e.currentTarget.value, e.currentTarget.selectionStart)
            }
            onBlur={(e) => {
              if (!e.currentTarget.parentElement?.contains(e.relatedTarget)) {
                setMention(null);
                setEditing(false);
              }
            }}
            onKeyDown={(e) => {
              if (!mention) return;
              if (e.key === "Escape") {
                e.stopPropagation();
                setMention(null);
              } else if (["ArrowDown", "ArrowUp"].includes(e.key)) {
                e.preventDefault();
                setChoice(
                  (n) =>
                    (n +
                      (e.key === "ArrowDown" ? 1 : -1) +
                      Math.max(1, candidates.length)) %
                    Math.max(1, candidates.length),
                );
              } else if (e.key === "Enter" && candidates[choice]) {
                e.preventDefault();
                insert(candidates[choice]);
              }
            }}
          />
          {mention && (
            <div
              role="listbox"
              aria-label="Resources"
              className="connected-resource-picker"
            >
              {candidates.map((r, index) => (
                <button
                  key={r.id}
                  type="button"
                  role="option"
                  aria-selected={index === choice}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insert(r)}
                >
                  {r.data.title}
                </button>
              ))}
              {!candidates.length && <p>No matching resources.</p>}
            </div>
          )}
        </div>
      ) : (
        <div
          tabIndex={editable ? 0 : undefined}
          role={editable ? "button" : undefined}
          aria-label={editable ? "Edit note text" : undefined}
          onClick={(e) => {
            if (editable && !(e.target as HTMLElement).closest("a"))
              setEditing(true);
          }}
          onKeyDown={(e) => {
            if (editable && e.key === "Enter") {
              e.preventDefault();
              setEditing(true);
            }
          }}
        >
          <NoteMarkdown text={draft.body} items={items} open={open} />
        </div>
      )}
      {!compact && editable && (
        <div className="connected-colors" aria-label="Note color">
          {colors.map((color) => (
            <button
              type="button"
              key={color}
              data-color={color}
              aria-label={color}
              aria-pressed={draft.color === color}
              onClick={() => edit({ color })}
            />
          ))}
        </div>
      )}
      {(dirty || saving || error) && (
        <p role="status">{error || (saving ? "Saving…" : "Unsaved changes")}</p>
      )}
      {error && (
        <div className="connected-actions">
          <button type="button" onClick={() => void save()}>
            Retry save
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm("Discard this draft and reload the saved note?")) {
                setDirty(false);
                setError("");
                setBase(item);
                setDraft({
                  title: item.data.title,
                  body: item.data.body,
                  color: item.data.color,
                });
              }
            }}
          >
            Reload saved note
          </button>
        </div>
      )}
    </div>
  );
}

export function Relations({
  item,
  items,
  edges,
  connect,
  unlink,
  open,
}: {
  item: Item;
  items: Item[];
  edges: Edge[];
  connect: Connect;
  unlink: (id: string) => Promise<void>;
  open: (item: Item) => void;
}) {
  const [picker, setPicker] = useState(false),
    [query, setQuery] = useState(""),
    [kind, setKind] = useState<"related" | "depends_on">("related"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const links = edges.filter(
    (e) => e.source_id === item.id || e.target_id === item.id,
  );
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="connected-relations">
      <summary>Connections</summary>
      {links.map((edge) => {
        const target = items.find(
          (i) =>
            i.id ===
            (edge.source_id === item.id ? edge.target_id : edge.source_id),
        );
        return (
          target && (
            <div className="connected-relation" key={edge.id}>
              <button type="button" onClick={() => open(target)}>
                {target.data.title}{" "}
                <small>
                  · {target.kind}
                  {edge.kind === "depends_on"
                    ? edge.source_id === item.id
                      ? " · Depends on"
                      : " · Required by"
                    : ""}
                </small>
              </button>
              <button
                type="button"
                disabled={busy}
                aria-label={`Unlink ${target.data.title}`}
                onClick={() => void run(() => unlink(edge.id))}
              >
                ×
              </button>
            </div>
          )
        );
      })}
      <button type="button" onClick={() => setPicker(!picker)}>
        ＋ Link item
      </button>
      {picker && (
        <div className="connected-link-picker">
          <label>
            Find a task, note or resource
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {item.kind === "task" && (
            <label>
              Relationship
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as typeof kind)}
              >
                <option value="related">Related</option>
                <option value="depends_on">Depends on</option>
              </select>
            </label>
          )}
          <div role="listbox" aria-label="Items">
            {items
              .filter(
                (i) =>
                  i.id !== item.id &&
                  ["task", "note", "resource"].includes(i.kind) &&
                  !i.data.archived &&
                  !i.data.deleted &&
                  (kind !== "depends_on" || i.kind === "task") &&
                  i.data.title.toLowerCase().includes(query.toLowerCase()),
              )
              .map((target) => {
                const linked = links.some(
                  (e) =>
                    e.kind === kind &&
                    (e.source_id === target.id || e.target_id === target.id),
                );
                return (
                  <button
                    type="button"
                    role="option"
                    aria-selected={linked}
                    disabled={busy || linked}
                    key={target.id}
                    onClick={() =>
                      void run(async () => {
                        await connect(item, target, kind);
                        setPicker(false);
                      })
                    }
                  >
                    {target.data.title}{" "}
                    <small>
                      · {target.kind}
                      {linked ? " · Linked" : ""}
                    </small>
                  </button>
                );
              })}
          </div>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}

type Geometry = { x: number; y: number; width: number; height: number };
export function PaperCard({
  item,
  items,
  edges,
  change,
  connect,
  unlink,
  open,
  close,
  onDirty,
  actor,
  manager,
  namespace,
  focused,
  focus,
}: {
  item: Item;
  items: Item[];
  edges: Edge[];
  change: Change;
  connect: Connect;
  unlink: (id: string) => Promise<void>;
  open: (item: Item) => void;
  close: () => void;
  onDirty: (id: string, value: boolean) => void;
  actor?: string;
  manager: boolean;
  namespace?: string;
  focused: boolean;
  focus: () => void;
}) {
  const resource = item.kind === "resource",
    area = `projects.card.${item.id}`;
  const [geometry, setGeometry] = useState<Geometry>(() => {
    const saved = readDeviceState(namespace, area) as Geometry;
    return saved &&
      [saved.x, saved.y, saved.width, saved.height].every(Number.isFinite)
      ? saved
      : { x: 32, y: 60, width: resource ? 740 : 510, height: 620 };
  });
  const [section, setSection] = useState("overview"),
    [error, setError] = useState(""),
    [moving, setMoving] = useState(false),
    [history, setHistory] = useState<
      Array<{ operation: string; created_at: string }>
    >([]);
  const card = useRef<HTMLElement>(null),
    drag = useRef<{
      pointer: number;
      x: number;
      y: number;
      initial: Geometry;
      resize: boolean;
    } | null>(null);
  const editable = manager || item.author_id === actor;
  const save = (g: Geometry) => {
    const next = {
      x: Math.max(0, Math.min(innerWidth - 120, g.x)),
      y: Math.max(0, Math.min(innerHeight - 80, g.y)),
      width: Math.max(330, Math.min(innerWidth, g.width)),
      height: Math.max(280, Math.min(innerHeight, g.height)),
    };
    setGeometry(next);
    writeDeviceState(namespace, area, next);
  };
  const start = (e: React.PointerEvent<HTMLButtonElement>, resize = false) => {
    if (e.button !== 0) return;
    e.preventDefault();
    focus();
    drag.current = {
      pointer: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      initial: geometry,
      resize,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    const dx = e.clientX - d.x,
      dy = e.clientY - d.y;
    save({
      ...d.initial,
      ...(d.resize
        ? { width: d.initial.width + dx, height: d.initial.height + dy }
        : { x: d.initial.x + dx, y: d.initial.y + dy }),
    });
  };
  const end = () => {
    drag.current = null;
  };
  const run = async (fn: () => Promise<unknown>) => {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const home = (target: Item | null) =>
    run(() => change(item, { resource_id: target?.id ?? null }));
  const keys = (e: React.KeyboardEvent, resize = false) => {
    if (!e.key.startsWith("Arrow")) return;
    e.preventDefault();
    const n = e.shiftKey ? 40 : 10,
      dx = e.key === "ArrowLeft" ? -n : e.key === "ArrowRight" ? n : 0,
      dy = e.key === "ArrowUp" ? -n : e.key === "ArrowDown" ? n : 0;
    save({
      ...geometry,
      ...(resize
        ? { width: geometry.width + dx, height: geometry.height + dy }
        : { x: geometry.x + dx, y: geometry.y + dy }),
    });
  };
  return (
    <article
      ref={card}
      className={`connected-paper${focused ? " is-focused" : ""}`}
      data-kind={item.kind}
      data-color={resource ? "blue" : item.data.color || "yellow"}
      style={{
        left: geometry.x,
        top: geometry.y,
        width: geometry.width,
        height: geometry.height,
      }}
      aria-label={`${item.kind}: ${item.data.title}`}
      onPointerDown={focus}
    >
      <header>
        <button
          className="connected-grip"
          type="button"
          aria-label={`Move expanded ${item.kind}`}
          onPointerDown={(e) => start(e)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onKeyDown={(e) => keys(e)}
        >
          ⠿
        </button>
        <button
          type="button"
          aria-label={`Collapse ${item.kind}`}
          onClick={close}
        >
          −
        </button>
      </header>
      <div className="connected-paper-content">
        {resource ? (
          <>
            <div className="resource-sticker-identity"><span className="resource-sticker-preview" data-sticker={stickerFor(item.data.resource)} aria-hidden="true" /><ResourceTags tags={item.data.resource?.tags} /></div>
            <h2>{item.data.title}</h2>
            <p className="connected-meta">
              {item.data.resource?.kind} · {item.data.resource?.status} ·{" "}
              {item.data.resource?.environment}
            </p>
            <nav aria-label="Resource content">
              {["overview", "notes", "activity", "settings"].map((tab) => (
                <button
                  type="button"
                  aria-current={section === tab ? "page" : undefined}
                  key={tab}
                  onClick={() => {
                    setSection(tab);
                    if (tab === "activity")
                      void run(async () => {
                        const { projectApi } = await import("./api");
                        const data = await projectApi<{
                          events: typeof history;
                        }>(`/items/${item.id}/history`);
                        setHistory(data.events);
                      });
                  }}
                >
                  {tab[0].toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </nav>
            {section === "overview" && (
              <div className="connected-overview">
                <section>
                  <h3>About this resource</h3>
                  <NoteMarkdown
                    text={item.data.body}
                    items={items}
                    open={open}
                  />
                </section>
                <section>
                  <h3>Details</h3>
                  <dl>
                    <dt>Provider</dt>
                    <dd>{item.data.resource?.provider || "Not specified"}</dd>
                    <dt>Environment</dt>
                    <dd>
                      {item.data.resource?.environment || "Not specified"}
                    </dd>
                    {Object.entries(item.data.details ?? {}).map(
                      ([key, value]) => (
                        <div key={key}>
                          <dt>{key}</dt>
                          <dd>{value}</dd>
                        </div>
                      ),
                    )}
                  </dl>
                  {/^https?:\/\//i.test(
                    item.data.resource?.public_url ?? "",
                  ) && (
                    <a
                      className="button"
                      href={item.data.resource?.public_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open resource ↗
                    </a>
                  )}
                </section>
              </div>
            )}
            {section === "notes" && (
              <>
                <div
                  className="connected-note-home"
                  onDragOver={(e) => {
                    if (
                      e.dataTransfer.types.includes("application/x-neural-note")
                    )
                      e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const note = items.find(
                      (i) =>
                        i.id ===
                          e.dataTransfer.getData("application/x-neural-note") &&
                        i.kind === "note",
                    );
                    if (note)
                      void run(() => change(note, { resource_id: item.id }));
                  }}
                >
                  <p>Drop a note here, or select one to attach.</p>
                  <label>
                    Attach a note
                    <select
                      aria-label="Attach a note"
                      value=""
                      onChange={(e) => {
                        const note = items.find((n) => n.id === e.target.value);
                        if (note)
                          void run(() =>
                            change(note, { resource_id: item.id }),
                          );
                      }}
                    >
                      <option value="">Choose a note</option>
                      {items
                        .filter(
                          (n) =>
                            n.kind === "note" &&
                            n.data.resource_id !== item.id &&
                            (manager || n.author_id === actor) &&
                            (n.data.board_id ?? null) ===
                              (item.data.board_id ?? null) &&
                            !n.data.deleted &&
                            !n.data.archived,
                        )
                        .map((n) => (
                          <option value={n.id} key={n.id}>
                            {n.data.title}
                          </option>
                        ))}
                    </select>
                  </label>
                  {items
                    .filter(
                      (n) =>
                        n.kind === "note" &&
                        n.data.resource_id === item.id &&
                        !n.data.deleted &&
                        !n.data.archived,
                    )
                    .map((n) => (
                      <article
                        className="connected-home-note"
                        data-color={n.data.color}
                        key={n.id}
                      >
                        <button type="button" onClick={() => open(n)}>
                          {n.data.title} ↗
                        </button>
                        <NoteMarkdown
                          text={n.data.body}
                          items={items}
                          open={open}
                        />
                      </article>
                    ))}
                </div>
                <Relations {...{ item, items, edges, connect, unlink, open }} />
              </>
            )}
            {section === "activity" && (
              <section>
                <h3>Activity</h3>
                {history.length ? (
                  history.map((entry, index) => (
                    <p key={index}>
                      {entry.operation} ·{" "}
                      {new Date(entry.created_at).toLocaleString()}
                    </p>
                  ))
                ) : (
                  <p>No activity to show.</p>
                )}
              </section>
            )}
            <div hidden={section !== "settings"}>
              <ResourceSettings item={item} change={change} onDirty={onDirty} />
              <button
                type="button"
                onClick={() =>
                  void run(() =>
                    change(item, { archived: !item.data.archived }),
                  )
                }
              >
                {item.data.archived ? "Restore resource" : "Archive resource"}
              </button>
            </div>
          </>
        ) : (
          <>
            <NoteEditor {...{ item, items, change, open, onDirty, editable }} />
            <Relations {...{ item, items, edges, connect, unlink, open }} />
            {editable && (
              <div className="connected-actions">
                {item.data.resource_id ? (
                  <button type="button" onClick={() => void home(null)}>
                    Return to board
                  </button>
                ) : (
                  <button type="button" onClick={() => setMoving(!moving)}>
                    Move to resource
                  </button>
                )}
                {moving && (
                  <label>
                    Resource
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        const target = items.find(
                          (i) => i.id === e.target.value,
                        );
                        if (target)
                          void home(target).then(() => setMoving(false));
                      }}
                    >
                      <option value="">Choose a resource</option>
                      {items
                        .filter(
                          (i) =>
                            i.kind === "resource" &&
                            !i.data.archived &&
                            !i.data.deleted &&
                            (i.data.board_id ?? null) ===
                              (item.data.board_id ?? null),
                        )
                        .map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.data.title}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
              </div>
            )}
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
      <button
        className="connected-resize"
        type="button"
        aria-label={`Resize expanded ${item.kind}`}
        onPointerDown={(e) => start(e, true)}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={(e) => keys(e, true)}
      >
        ↘
      </button>
    </article>
  );
}

function ResourceSettings({
  item,
  change,
  onDirty,
}: {
  item: Item;
  change: Change;
  onDirty: (id: string, value: boolean) => void;
}) {
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [base, setBase] = useState(item);
  useEffect(() => {
    if (!dirty) setBase(item);
  }, [item, dirty]);
  useEffect(() => {
    onDirty(item.id, dirty);
    return () => onDirty(item.id, false);
  }, [item.id, dirty, onDirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  return (
    <form
      key={base.revision}
      className="connected-resource-settings"
      onChange={() => setDirty(true)}
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        const values = new FormData(e.currentTarget),
          get = (key: string) => String(values.get(key) ?? "");
        try {
          await change(base, {
            title: get("title"),
            body: get("body"),
            resource: {
              ...base.data.resource!,
              kind: get("kind"),
              status: get("status"),
              provider: get("provider"),
              environment: get("environment"),
              public_url: get("public_url"),
              sticker: get("sticker") || "auto",
              tags: parseTags(get("tags")),
            },
          });
          setDirty(false);
        } catch (reason) {
          setError((reason as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        Title
        <input
          name="title"
          required
          maxLength={200}
          defaultValue={base.data.title}
        />
      </label>
      <label>
        Description
        <textarea name="body" maxLength={20000} defaultValue={base.data.body} />
      </label>
      <label>
        Type
        <select
          name="kind"
          defaultValue={base.data.resource?.kind ?? "website"}
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
      <StickerPicker value={base.data.resource?.sticker} />
      <label>Tags<input name="tags" maxLength={500} defaultValue={(base.data.resource?.tags ?? []).join(", ")} placeholder="Production, Client-facing" /><small>Up to 12 comma-separated tags, 40 characters each.</small></label>
      <label>
        Resource status
        <select
          name="status"
          defaultValue={base.data.resource?.status ?? "planned"}
        >
          {["planned", "active", "retired"].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>
      <label>
        Provider
        <input
          name="provider"
          maxLength={120}
          defaultValue={base.data.resource?.provider ?? ""}
        />
      </label>
      <label>
        Environment
        <input
          name="environment"
          maxLength={80}
          defaultValue={base.data.resource?.environment ?? ""}
        />
      </label>
      <label>
        Public URL
        <input
          type="url"
          name="public_url"
          maxLength={2048}
          defaultValue={base.data.resource?.public_url ?? ""}
        />
      </label>
      <button type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save"}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
