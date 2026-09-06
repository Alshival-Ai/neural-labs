import { createPortal } from "react-dom";
import { useLayoutEffect, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { ImagePlay, SmilePlus, X } from "lucide-react";
import { searchTerminalGifs, type TerminalGif } from "./terminalApi";

const QUICK = ["👍", "🎉", "🚀", "🔥", "❤️", "👏", "😂", "👀"];
const CATEGORY_NAMES: Record<string, string> = { people: "Smileys & people", nature: "Animals & nature", foods: "Food & drink", activity: "Activities", places: "Travel & places", objects: "Objects", symbols: "Symbols", flags: "Flags" };
type Emoji = { id: string; name: string; keywords?: string[]; skins: { native: string }[] };
type EmojiData = { categories: { id: string; emojis: string[] }[]; emojis: Record<string, Emoji> };
export type TeamReaction = { id: string; label: string; emoji?: string; gif?: TerminalGif };
export type ReactionSelection = { emoji: string } | { kind: "gif"; token: string };

export function safeGifUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443") && ["static.klipy.com", "static1.klipy.com", "static2.klipy.com"].includes(url.hostname);
  } catch { return false; }
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media?.matches ?? false);
    media?.addEventListener?.("change", update);
    return () => media?.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

function GifImage({ gif, preview = false }: { gif: TerminalGif; preview?: boolean }) {
  const reduced = useReducedMotion();
  const src = reduced ? gif.still : preview ? gif.preview : gif.url;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return src && safeGifUrl(src) && !failed
    ? <img src={src} alt={gif.title} referrerPolicy="no-referrer" loading={preview ? "lazy" : "eager"} onError={() => setFailed(true)} />
    : <span className="terminal-gif-fallback">{gif.title}</span>;
}

export function ReactionOverlays({ reactions }: { reactions: TeamReaction[] }) {
  return <div className="terminal-pane__reactions" aria-live="polite" aria-atomic="false">{reactions.map((reaction) => <span className={`terminal-pane__reaction${reaction.gif ? " is-gif" : ""}`} aria-label={`${reaction.label} reacted with ${reaction.gif?.title ?? reaction.emoji}`} key={reaction.id}><span className="terminal-pane__reaction-burst" aria-hidden="true">{reaction.gif ? <GifImage gif={reaction.gif} /> : <b>{reaction.emoji}</b>}<small>{reaction.label}</small></span></span>)}</div>;
}

function EmojiPicker({ send }: { send: (selection: ReactionSelection) => void }) {
  const [data, setData] = useState<EmojiData>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("people");
  const [skin, setSkin] = useState(0);
  useEffect(() => {
    let active = true;
    setError(false);
    void import("@emoji-mart/data").then((module) => { if (active) setData(module.default as EmojiData); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [attempt]);
  const emojis = useMemo(() => {
    if (!data) return [];
    const search = query.trim().toLowerCase();
    return search ? Object.values(data.emojis).filter((emoji) => [emoji.name, emoji.id, ...(emoji.keywords ?? []), ...emoji.skins.map((item) => item.native)].join(" ").toLowerCase().includes(search))
      : (data.categories.find((item) => item.id === category)?.emojis ?? []).map((id) => data.emojis[id]);
  }, [data, query, category]);
  return <>
    <label className="terminal-reaction-search">Search emoji<input autoFocus value={query} maxLength={160} onChange={(event) => setQuery(event.target.value)} placeholder="Search emoji" /></label>
    <div className="terminal-emoji-options"><label>Category<select value={category} onChange={(event) => { setCategory(event.target.value); setQuery(""); }}>{Object.entries(CATEGORY_NAMES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><label>Skin tone<select value={skin} onChange={(event) => setSkin(Number(event.target.value))}>{["Default", "Light", "Medium-light", "Medium", "Medium-dark", "Dark"].map((name, index) => <option key={name} value={index}>{name}</option>)}</select></label></div>
    <div className="terminal-reaction-results">
      {!query && <><p>Quick reactions</p><div className="terminal-emoji-grid" aria-label="Quick reactions">{QUICK.map((emoji) => <button type="button" aria-label={`Send ${emoji}`} key={emoji} onClick={() => send({ emoji })}>{emoji}</button>)}</div><p>{CATEGORY_NAMES[category]}</p></>}
      {!data && <p role="status">{error ? "Emoji could not load" : "Loading emoji…"}{error && <button type="button" onClick={() => setAttempt((value) => value + 1)}>Retry</button>}</p>}
      {data && !emojis.length && <p role="status">No emoji found</p>}
      <div className="terminal-emoji-grid" aria-label="Emoji results">{emojis.map((emoji) => { const native = (emoji.skins[skin] ?? emoji.skins[0]).native; return <button type="button" key={emoji.id} aria-label={`Send ${emoji.name}`} title={emoji.name} onClick={() => send({ emoji: native })}>{native}</button>; })}</div>
    </div>
  </>;
}

function GifPicker({ terminalId, connected, send }: { terminalId: string; connected: boolean; send: (selection: ReactionSelection) => void }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState({ pos: "", attempt: 0 });
  const [results, setResults] = useState<TerminalGif[]>([]);
  const [next, setNext] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!connected) { setLoading(false); return; }
    const abort = new AbortController();
    setLoading(true); setError("");
    const timer = window.setTimeout(() => {
      void searchTerminalGifs(terminalId, query, page.pos, abort.signal).then((response) => {
        if (abort.signal.aborted) return;
        setResults((current) => page.pos ? [...current, ...response.results] : response.results);
        setNext(response.next); setLoading(false);
      }).catch((reason: unknown) => {
        if (abort.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "GIFs could not load"); setLoading(false);
      });
    }, query && !page.pos ? 300 : 0);
    return () => { window.clearTimeout(timer); abort.abort(); };
  }, [terminalId, query, page, connected]);
  return <>
    <label className="terminal-reaction-search">Search GIFs<input autoFocus value={query} maxLength={160} placeholder="Search KLIPY" onChange={(event) => { setQuery(event.target.value); setPage({ pos: "", attempt: 0 }); setResults([]); setNext(""); }} /></label>
    <div className="terminal-reaction-results">
      {!query && <p>Featured GIFs</p>}
      <div className="terminal-gif-grid">{results.map((gif) => <button type="button" disabled={!connected} aria-label={`Send ${gif.title}`} key={gif.token} onClick={() => send({ kind: "gif", token: gif.token })}><GifImage gif={gif} preview /></button>)}</div>
      {loading && <p role="status">Loading GIFs…</p>}
      {error && <p role="alert">{error}<button type="button" onClick={() => setPage((current) => ({ ...current, attempt: current.attempt + 1 }))}>Retry</button></p>}
      {!loading && !error && connected && !results.length && <p role="status">No GIFs found. Try another search.</p>}
      {next && !error && <button type="button" disabled={loading || !connected} onClick={() => setPage({ pos: next, attempt: 0 })}>Load more GIFs</button>}
    </div>
    <small className="terminal-klipy-credit">Powered by KLIPY</small>
  </>;
}

export function TerminalReactionSidebar({ terminalId, connected, send, error, dismissError }: { terminalId: string; connected: boolean; send: (selection: ReactionSelection) => void; error: string; dismissError: () => void }) {
  const [open, setOpen] = useState<"emoji" | "gif" | null>(null);
  const emojiTrigger = useRef<HTMLButtonElement>(null);
  const gifTrigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!open) return;
    const rail = emojiTrigger.current?.parentElement;
    const canvas = rail?.parentElement;
    const app = canvas?.closest(".terminal-app");
    if (!canvas || !app) return;
    const update = () => {
      const pane = canvas.getBoundingClientRect();
      const bounds = pane.width < 400 || pane.height < 320 ? app.getBoundingClientRect() : pane;
      const compact = bounds !== pane;
      const viewport = window.visualViewport;
      const leftEdge = Math.max(bounds.left + 8, (viewport?.offsetLeft ?? 0) + 8);
      const rightEdge = Math.min(bounds.right - (compact ? 8 : 48), (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth) - 8);
      const top = Math.max(bounds.top + 8, (viewport?.offsetTop ?? 0) + 8);
      const bottom = Math.min(bounds.bottom - 8, (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight) - 8);
      const width = Math.min(340, Math.max(0, rightEdge - leftEdge));
      setPosition({ position: "fixed", left: rightEdge - width, top, width, height: Math.min(430, Math.max(0, bottom - top)), maxWidth: "none", maxHeight: "none" });
    };
    update();
    const resize = new ResizeObserver(update);
    resize.observe(canvas); resize.observe(app);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    window.visualViewport?.addEventListener("resize", update);
    return () => { resize.disconnect(); window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); window.visualViewport?.removeEventListener("resize", update); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !dialog.current?.contains(event.target) && !emojiTrigger.current?.parentElement?.contains(event.target)) setOpen(null);
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside, true);
    return () => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("focusin", outside, true); };
  }, [open]);
  const close = () => { (open === "emoji" ? emojiTrigger : gifTrigger).current?.focus(); setOpen(null); };
  const select = (selection: ReactionSelection) => { if (!connected) return; dismissError(); setOpen(null); send(selection); };
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); close(); }
    if (event.key === "Tab") {
      const items = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select');
      if (!items?.length) return;
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) && event.target instanceof HTMLButtonElement && event.target.parentElement?.matches(".terminal-emoji-grid, .terminal-gif-grid")) {
      const grid = event.target.parentElement;
      const items = [...grid.querySelectorAll<HTMLButtonElement>("button")];
      const columns = Math.max(1, Math.round(grid.clientWidth / Math.max(1, event.target.offsetWidth)));
      const delta = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" ? -columns : columns;
      event.preventDefault(); items[(items.indexOf(event.target) + delta + items.length) % items.length]?.focus();
    }
  };
  return <>
    <aside className="terminal-reaction-rail" aria-label="Team Terminal reactions"><button ref={emojiTrigger} type="button" aria-label="Send a team reaction" title="Emoji reactions" aria-expanded={open === "emoji"} onClick={() => setOpen(open === "emoji" ? null : "emoji")}><SmilePlus /></button><button ref={gifTrigger} type="button" aria-label="Send a GIF reaction" title="GIF reactions" aria-expanded={open === "gif"} onClick={() => setOpen(open === "gif" ? null : "gif")}><ImagePlay /></button></aside>
    {open && createPortal(<div style={position} ref={dialog} role="dialog" aria-label={open === "emoji" ? "Emoji reactions" : "GIF reactions"} className="terminal-reaction-dialog" onKeyDown={keys} onKeyUp={(event) => event.stopPropagation()}><header><strong>{open === "emoji" ? "Emoji" : "GIFs"}</strong><button type="button" aria-label="Close reactions" onClick={close}><X /></button></header>{!connected && <p role="status">Reconnect to send reactions</p>}{open === "emoji" ? <EmojiPicker send={select} /> : <GifPicker terminalId={terminalId} connected={connected} send={select} />}</div>, document.body)}
    {error && <div className="terminal-reaction-error" role="alert">{error}<button type="button" aria-label="Dismiss reaction error" onClick={dismissError}><X /></button></div>}
  </>;
}
