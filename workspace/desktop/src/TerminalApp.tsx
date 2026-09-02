import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Terminal as XTerm, type ITheme } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  Braces,
  Check,
  ChevronDown,
  Clipboard,
  Columns2,
  Copy,
  Crown,
  Eraser,
  GitBranch,
  MoreHorizontal,
  Palette,
  Plus,
  RefreshCw,
  Rows2,
  Search,
  SmilePlus,
  TerminalSquare,
  Users,
  Wifi,
  X,
} from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  createTerminal,
  endTerminal,
  issueTerminalTicket,
  listTerminals,
  TerminalRequestError,
  terminalSocketUrl,
  type TerminalDescriptor,
  type TerminalController,
  type TerminalParticipant,
} from "./terminalApi";
import { readDeviceState, writeDeviceState } from "./deviceState";
import { FontSizeControl } from "./FontSizeControl";
import { DESKTOP_FONT_SCALE_DEFAULT, normalizeDesktopFontScale } from "./fontScale";
import "./terminal-app.css";

type TerminalSplitDirection = "vertical" | "horizontal";
type PaneConnectionStatus = "connecting" | "connected" | "reconnecting" | "offline" | "exited";

export type TerminalAppProps = {
  workspaceName?: string;
  notify?: (message: string) => void;
  storageNamespace?: string;
  storageArea?: string;
  fontScale?: number;
  onFontScaleChange?: (value: number) => void;
};

const SOCKET_RETRY_MAX_MS = 15_000;
const SOCKET_READY_TIMEOUT_MS = 10_000;
const TEAM_REACTIONS = ["👍", "🎉", "🚀", "🔥", "❤️", "👏", "😂", "👀"] as const;
const REACTION_DISPLAY_MS = 1800;

export const NEURAL_TERMINAL_THEME: ITheme = {
  background: "#0a0c12",
  foreground: "#f1f3f7",
  cursor: "#67e8f9",
  cursorAccent: "#0a0c12",
  selectionBackground: "#7b4dff99",
  selectionForeground: "#ffffff",
  selectionInactiveBackground: "#7b4dff55",
  scrollbarSliderBackground: "#8b92a633",
  scrollbarSliderHoverBackground: "#67e8f966",
  scrollbarSliderActiveBackground: "#67e8f999",
  black: "#969ca9",
  red: "#ff806d",
  green: "#6ee7ad",
  yellow: "#ffd166",
  blue: "#69c8ff",
  magenta: "#d29cff",
  cyan: "#67e8f9",
  white: "#f1f5f9",
  brightBlack: "#a8aeba",
  brightRed: "#ffa093",
  brightGreen: "#91f2c5",
  brightYellow: "#ffe08a",
  brightBlue: "#91d8ff",
  brightMagenta: "#e0b8ff",
  brightCyan: "#9af2fb",
  brightWhite: "#ffffff",
};

type TerminalDeviceState = {
  activeId?: string;
  secondaryId?: string;
  splitDirection: TerminalSplitDirection;
  activePane: "primary" | "secondary";
  hiddenTeamIds: string[];
};

function nonceAwareDocument(source: Document): Document {
  const nonce = source.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content;
  if (!nonce) return source;
  return new Proxy(source, {
    get(target, property) {
      if (property === "createElement") {
        return ((tagName: string, options?: ElementCreationOptions) => {
          const element = target.createElement(tagName, options);
          if (tagName.toLowerCase() === "style") element.setAttribute("nonce", nonce);
          return element;
        }) as Document["createElement"];
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function terminalDeviceState(storageNamespace: string | undefined, storageArea: string): TerminalDeviceState {
  const stored = readDeviceState(storageNamespace, storageArea);
  if (!stored || typeof stored !== "object") return { splitDirection: "vertical", activePane: "primary", hiddenTeamIds: [] };
  const value = stored as Record<string, unknown>;
  return {
    activeId: typeof value.activeId === "string" ? value.activeId : undefined,
    secondaryId: typeof value.secondaryId === "string" ? value.secondaryId : undefined,
    splitDirection: value.splitDirection === "horizontal" ? "horizontal" : "vertical",
    activePane: value.activePane === "secondary" ? "secondary" : "primary",
    hiddenTeamIds: Array.isArray(value.hiddenTeamIds) ? value.hiddenTeamIds.filter((id): id is string => typeof id === "string").slice(0, 32) : [],
  };
}

export function isTerminalCopyShortcut(event: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "shiftKey">): boolean {
  return (event.metaKey && event.key.toLowerCase() === "c")
    || (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "c")
    || (event.ctrlKey && event.code === "Insert");
}

export function isTerminalPasteShortcut(event: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "shiftKey">): boolean {
  return (event.metaKey && event.key.toLowerCase() === "v")
    || (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "v")
    || (event.shiftKey && event.code === "Insert");
}

export function isTerminalInsertToggle(event: Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "shiftKey">): boolean {
  return event.code === "Insert" && !event.ctrlKey && !event.metaKey && !event.shiftKey;
}

export function TerminalApp({ workspaceName = "Workspace", notify, storageNamespace, storageArea = "terminal", fontScale = DESKTOP_FONT_SCALE_DEFAULT, onFontScaleChange }: TerminalAppProps) {
  const [initialUiState] = useState(() => terminalDeviceState(storageNamespace, storageArea));
  const [sessions, setSessions] = useState<TerminalDescriptor[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | undefined>(initialUiState.activeId);
  const [secondaryId, setSecondaryId] = useState<string | undefined>(initialUiState.secondaryId);
  const [splitDirection, setSplitDirection] = useState<TerminalSplitDirection>(initialUiState.splitDirection);
  const [activePane, setActivePane] = useState<"primary" | "secondary">(initialUiState.activePane);
  const [hiddenTeamIds, setHiddenTeamIds] = useState<Set<string>>(() => new Set(initialUiState.hiddenTeamIds));
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [teamComposerOpen, setTeamComposerOpen] = useState(false);
  const [teamTitle, setTeamTitle] = useState("");
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const initialized = useRef(false);
  const sessionsRef = useRef<TerminalDescriptor[]>([]);
  const recoveryPending = useRef(false);
  const teamButtonRef = useRef<HTMLButtonElement>(null);
  const teamPopoverRef = useRef<HTMLDivElement>(null);
  const teamPopoverId = useId();
  const teamPopoverTitleId = useId();
  const teamTitleInputId = useId();

  const report = useCallback((message: string) => {
    setNotice(message);
    notify?.(message);
  }, [notify]);

  useEffect(() => {
    if (!teamComposerOpen) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (teamButtonRef.current?.contains(target) || teamPopoverRef.current?.contains(target)) return;
      setTeamComposerOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setTeamComposerOpen(false);
      teamButtonRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [teamComposerOpen]);

  const mergeSession = useCallback((next: TerminalDescriptor) => {
    setSessions((current) => {
      const found = current.some((session) => session.id === next.id);
      return found ? current.map((session) => session.id === next.id ? next : session) : [...current, next];
    });
  }, []);

  sessionsRef.current = sessions;

  const recoverPersonalTerminal = useCallback(async () => {
    if (recoveryPending.current) return;
    recoveryPending.current = true;
    setError(undefined);
    try {
      const next = await createTerminal({ scope: "personal", title: "workspace" });
      mergeSession(next);
      setActiveId(next.id);
      setSecondaryId((current) => current && sessionsRef.current.some((session) => session.id === current) ? current : undefined);
      setActivePane("primary");
      setNotice("The workspace terminal restarted in a fresh shell.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The terminal could not be restarted.");
    } finally {
      recoveryPending.current = false;
    }
  }, [mergeSession]);

  const handleSessionUnavailable = useCallback((session: TerminalDescriptor) => {
    const replacement = sessionsRef.current.find((candidate) => candidate.id !== session.id && candidate.scope === "personal" && candidate.status === "running");
    setSessions((current) => current.filter((candidate) => candidate.id !== session.id));
    setActiveId((current) => current === session.id ? replacement?.id : current);
    setSecondaryId((current) => current === session.id ? undefined : current);
    if (session.scope === "personal" && !replacement) void recoverPersonalTerminal();
  }, [recoverPersonalTerminal]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const available = await listTerminals();
        if (cancelled) return;
        const runningPersonal = available.find((session) => session.scope === "personal" && session.status === "running");
        setSessions(available);
        setActiveId((current) => available.some((session) => session.id === current && session.status === "running" && (session.scope === "personal" || !hiddenTeamIds.has(session.id)))
          ? current
          : runningPersonal?.id ?? available.find((session) => session.status === "running" && (session.scope === "personal" || !hiddenTeamIds.has(session.id)))?.id);
        setSecondaryId((current) => available.some((session) => session.id === current) ? current : undefined);
        if (!runningPersonal) {
          const created = await createTerminal({ scope: "personal", title: "workspace" });
          if (cancelled) return;
          setSessions((current) => [...current, created]);
          setActiveId((current) => current && available.some((session) => session.id === current && session.status === "running") ? current : created.id);
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Terminal sessions could not be loaded.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let stopped = false;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing || !initialized.current) return;
      refreshing = true;
      try {
        const available = await listTerminals();
        if (!stopped) {
          const lostRunningPersonal = sessionsRef.current.some((session) => session.scope === "personal" && session.status === "running")
            && !available.some((session) => session.scope === "personal" && session.status === "running");
          setSessions(available);
          if (lostRunningPersonal) void recoverPersonalTerminal();
        }
      } catch {
        // Live panes report transport state; a discovery poll should stay quiet.
      } finally {
        refreshing = false;
      }
    };
    const interval = window.setInterval(() => void refresh(), 10_000);
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      stopped = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [recoverPersonalTerminal]);

  const visibleSessions = useMemo(
    () => sessions.filter((session) => session.scope === "personal" || !hiddenTeamIds.has(session.id)),
    [hiddenTeamIds, sessions],
  );
  const activeSession = visibleSessions.find((session) => session.id === activeId) ?? visibleSessions[0];
  const secondarySession = sessions.find((session) => session.id === secondaryId);
  const teamSessions = sessions.filter((session) => session.scope === "team");

  useEffect(() => {
    if (loading) return;
    writeDeviceState(storageNamespace, storageArea, {
      activeId,
      secondaryId: secondarySession?.id,
      splitDirection,
      activePane: secondarySession ? activePane : "primary",
      hiddenTeamIds: [...hiddenTeamIds].filter((id) => sessions.some((session) => session.id === id && session.scope === "team")),
    } satisfies TerminalDeviceState);
  }, [activeId, activePane, hiddenTeamIds, loading, secondarySession, sessions, splitDirection, storageArea, storageNamespace]);

  useEffect(() => {
    if (activeSession && activeId !== activeSession.id) setActiveId(activeSession.id);
  }, [activeId, activeSession]);

  const createPersonal = async (asSplit?: TerminalSplitDirection) => {
    setError(undefined);
    try {
      const next = await createTerminal({ scope: "personal" });
      mergeSession(next);
      if (asSplit) {
        setSplitDirection(asSplit);
        setSecondaryId(next.id);
        setActivePane("secondary");
      } else {
        setActiveId(next.id);
        setActivePane("primary");
      }
      report(asSplit ? `Opened ${next.title} in a split.` : `Opened ${next.title}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The terminal could not be created.");
    }
  };

  const createTeam = async (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    try {
      const next = await createTerminal({ scope: "team", title: teamTitle.trim() || undefined });
      mergeSession(next);
      setHiddenTeamIds((current) => {
        const updated = new Set(current);
        updated.delete(next.id);
        return updated;
      });
      setActiveId(next.id);
      setActivePane("primary");
      setTeamComposerOpen(false);
      setTeamTitle("");
      report(`${next.title} is live for the team.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The Team Terminal could not be created.");
    }
  };

  const joinTeam = (session: TerminalDescriptor) => {
    setHiddenTeamIds((current) => {
      const updated = new Set(current);
      updated.delete(session.id);
      return updated;
    });
    setActiveId(session.id);
    setActivePane("primary");
    setTeamComposerOpen(false);
  };

  const removeFromLayout = (session: TerminalDescriptor) => {
    if (secondaryId === session.id) {
      setSecondaryId(undefined);
      setActivePane("primary");
    }
    if (activeId === session.id) setActiveId(visibleSessions.find((candidate) => candidate.id !== session.id)?.id);
  };

  const closeSession = async (session: TerminalDescriptor) => {
    if (session.scope === "team") {
      setHiddenTeamIds((current) => new Set(current).add(session.id));
      removeFromLayout(session);
      report(`Left ${session.title}. The shared shell is still running.`);
      return;
    }
    try {
      await endTerminal(session.id);
      setSessions((current) => current.filter((candidate) => candidate.id !== session.id));
      removeFromLayout(session);
      report(`Ended ${session.title}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The terminal could not be ended.");
    }
  };

  const terminateTeam = async (session: TerminalDescriptor) => {
    if (!session.canTerminate || !window.confirm(`End ${session.title} for everyone? The shell process will stop.`)) return;
    try {
      await endTerminal(session.id);
      setSessions((current) => current.filter((candidate) => candidate.id !== session.id));
      removeFromLayout(session);
      report(`Ended ${session.title} for everyone.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The Team Terminal could not be ended.");
    }
  };

  const split = (direction: TerminalSplitDirection) => {
    setSplitDirection(direction);
    if (!secondarySession) void createPersonal(direction);
  };

  if (loading) return <div className="terminal-app terminal-app--empty"><RefreshCw className="terminal-spin" /><strong>Connecting to terminal runtime…</strong></div>;

  if (!activeSession) {
    return <div className="terminal-app terminal-app--empty"><TerminalSquare /><strong>{error || "No terminal sessions"}</strong><button type="button" onClick={() => void createPersonal()}><Plus />New terminal</button></div>;
  }

  return (
    <section className="terminal-app" aria-label="Developer terminal">
      <header className="terminal-toolbar">
        <div className="terminal-toolbar__identity">
          <span className="terminal-toolbar__mark"><TerminalSquare /></span>
          <span><strong>Terminal</strong><small><i />persistent workspace shells</small></span>
        </div>
        <div className="terminal-toolbar__context" aria-label="Terminal context"><span>{activeSession.scope === "team" ? "team runtime" : "private runtime"}</span><strong>{activeSession.cwd}</strong></div>
        <div className="terminal-toolbar__actions">
          <button type="button" onClick={() => void createPersonal()} aria-label="New terminal" title="New personal terminal"><Plus /><span>New</span></button>
          <i aria-hidden="true" />
          <button type="button" onClick={() => split("vertical")} aria-label="Split terminal vertically" aria-pressed={Boolean(secondarySession) && splitDirection === "vertical"} title="Split vertically"><Columns2 /></button>
          <button type="button" onClick={() => split("horizontal")} aria-label="Split terminal horizontally" aria-pressed={Boolean(secondarySession) && splitDirection === "horizontal"} title="Split horizontally"><Rows2 /></button>
          <button type="button" onClick={() => setSearchOpen((open) => !open)} aria-label="Search terminal output" aria-pressed={searchOpen} title="Search output"><Search /></button>
          <div className="terminal-team-menu">
            <button ref={teamButtonRef} type="button" aria-label="Team terminals" aria-expanded={teamComposerOpen} aria-controls={teamPopoverId} aria-haspopup="dialog" title="Team terminals" onClick={() => setTeamComposerOpen((open) => !open)}><Users /><span>Team</span><ChevronDown /></button>
          </div>
          <button type="button" aria-label="More terminal actions" title="Keyboard shortcuts" onClick={() => report("Copy: Ctrl/Cmd+Shift+C · Paste: Ctrl/Cmd+Shift+V · Ctrl+C interrupts")}><MoreHorizontal /></button>
        </div>
      </header>

      {teamComposerOpen && (
        <div ref={teamPopoverRef} id={teamPopoverId} className="terminal-team-popover" role="dialog" aria-modal="false" aria-labelledby={teamPopoverTitleId}>
          <header>
            <div><Users /><span><strong id={teamPopoverTitleId}>Team terminals</strong><small>{teamSessions.filter((session) => session.status === "running").length} live in this workspace</small></span></div>
            <button type="button" aria-label="Close Team terminals menu" onClick={() => setTeamComposerOpen(false)}><X /></button>
          </header>
          <p>Shared, persistent shells where everyone can see and type.</p>
          {teamSessions.length > 0 ? (
            <div className="terminal-team-list">{teamSessions.map((session) => <button type="button" key={session.id} onClick={() => joinTeam(session)}><i className={session.status === "running" ? "is-running" : ""} /><span><strong>{session.title}</strong><small>{session.participants.length} connected · by {session.owner.label}</small></span><small>{hiddenTeamIds.has(session.id) ? "Join" : "Open"}</small></button>)}</div>
          ) : (
            <div className="terminal-team-empty"><TerminalSquare /><span><strong>No shared shells yet</strong><small>Create one for your team below.</small></span></div>
          )}
          <form onSubmit={(event) => void createTeam(event)}><label htmlFor={teamTitleInputId}>Start a shared shell</label><div><input id={teamTitleInputId} value={teamTitle} onChange={(event) => setTeamTitle(event.target.value)} maxLength={60} placeholder="Release room" /><button type="submit"><Plus />Create</button></div></form>
        </div>
      )}

      <div className="terminal-tabs" role="tablist" aria-label="Terminal sessions">
        {visibleSessions.map((session) => (
          <div className={`terminal-tab is-${session.scope}${activeSession.id === session.id ? " is-active" : ""}`} key={session.id}>
            <button type="button" className="terminal-tab__select" role="tab" aria-selected={activeSession.id === session.id} onClick={() => { setActiveId(session.id); setActivePane("primary"); }}><i /><TerminalSquare /><span>{session.title}</span>{session.scope === "team" && <Users />}<small>{session.status}</small></button>
            <button type="button" className="terminal-tab__close" aria-label={`${session.scope === "team" ? "Leave" : "Close"} ${session.title}`} onClick={() => void closeSession(session)}><X /></button>
          </div>
        ))}
        <button type="button" className="terminal-tabs__new" aria-label="New terminal tab" onClick={() => void createPersonal()}><Plus /></button>
        <span className="terminal-tabs__spacer" />
        <span className="terminal-tabs__workspace"><Wifi />{workspaceName} · {sessions.filter((session) => session.status === "running").length} running</span>
      </div>

      <div className="terminal-banners">
        {searchOpen && <div className="terminal-search"><Search /><label className="terminal-sr-only" htmlFor="terminal-search-input">Search terminal output</label><input id="terminal-search-input" autoFocus value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Find in active terminal" /><span>Live buffer search</span><button type="button" aria-label="Close terminal search" onClick={() => { setSearchOpen(false); setSearchQuery(""); }}><X /></button></div>}
        {error && <div className="terminal-notice is-error" role="alert"><X /><span>{error}</span><button type="button" aria-label="Dismiss terminal error" onClick={() => setError(undefined)}><X /></button></div>}
        {notice && <div className="terminal-notice" role="status"><Check /><span>{notice}</span><button type="button" aria-label="Dismiss terminal message" onClick={() => setNotice(undefined)}><X /></button></div>}
      </div>

      <main className={`terminal-workspace${secondarySession ? ` is-split is-${splitDirection}` : ""}`}>
        <LiveTerminalPane session={activeSession} active={activePane === "primary"} fontSize={Math.round(18 * normalizeDesktopFontScale(fontScale) / 100)} searchQuery={activePane === "primary" ? searchQuery : ""} onActivate={() => setActivePane("primary")} onDescriptorChange={mergeSession} onUnavailable={() => handleSessionUnavailable(activeSession)} onEndTeam={() => void terminateTeam(activeSession)} onClose={() => void closeSession(activeSession)} />
        {secondarySession && <LiveTerminalPane session={secondarySession} active={activePane === "secondary"} fontSize={Math.round(18 * normalizeDesktopFontScale(fontScale) / 100)} searchQuery={activePane === "secondary" ? searchQuery : ""} onActivate={() => setActivePane("secondary")} onDescriptorChange={mergeSession} onUnavailable={() => handleSessionUnavailable(secondarySession)} onEndTeam={() => void terminateTeam(secondarySession)} onClose={() => { setSecondaryId(undefined); setActivePane("primary"); }} />}
      </main>

      <footer className="terminal-statusbar">
        <div><span><GitBranch />workspace</span><span className={activeSession.scope === "team" ? "is-team" : ""}><Braces />{activeSession.scope === "team" ? "shared · one driver" : "private"}</span></div>
        <div><span title="High-contrast ANSI truecolor profile"><Palette />Neural Spectrum</span><span>{activeSession.shell}</span><span>UTF-8</span><span>{activeSession.cols} × {activeSession.rows}</span><span>{activeSession.participants.length} connected</span>{onFontScaleChange && <FontSizeControl className="terminal-statusbar__zoom" value={fontScale} onChange={onFontScaleChange} />}</div>
      </footer>
    </section>
  );
}

type LiveTerminalPaneProps = {
  session: TerminalDescriptor;
  active: boolean;
  fontSize: number;
  searchQuery: string;
  onActivate: () => void;
  onDescriptorChange: (session: TerminalDescriptor) => void;
  onUnavailable: () => void;
  onEndTeam: () => void;
  onClose: () => void;
};

function LiveTerminalPane({ session, active, fontSize, searchQuery, onActivate, onDescriptorChange, onUnavailable, onEndTeam, onClose }: LiveTerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | undefined>(undefined);
  const fitRef = useRef<FitAddon | undefined>(undefined);
  const searchRef = useRef<SearchAddon | undefined>(undefined);
  const socketRef = useRef<WebSocket | undefined>(undefined);
  const reconnectTimer = useRef<number | undefined>(undefined);
  const readyTimer = useRef<number | undefined>(undefined);
  const reconnectAttempt = useRef(0);
  const ticketRequestPending = useRef(false);
  const lastSequence = useRef<number | null>(null);
  const terminalEnded = useRef(session.status === "exited");
  const connectionId = useRef<string | undefined>(undefined);
  const viewerId = useRef<string | undefined>(undefined);
  const connectRef = useRef<() => void>(() => undefined);
  const descriptorRef = useRef(session);
  const lastSentSize = useRef({ cols: session.cols, rows: session.rows });
  const canControlRef = useRef(session.scope === "personal");
  const activeRef = useRef(active);
  const [connectionStatus, setConnectionStatus] = useState<PaneConnectionStatus>(session.status === "exited" ? "exited" : "connecting");
  const [participants, setParticipants] = useState<TerminalParticipant[]>(session.participants);
  const [controller, setController] = useState<TerminalController | null>(session.controller);
  const [inputMode, setInputMode] = useState<"insert" | "overwrite">("insert");
  const [typingActors, setTypingActors] = useState<Record<string, string>>({});
  const [reactionPickerOpen, setReactionPickerOpen] = useState(false);
  const [reactions, setReactions] = useState<Array<{ id: string; emoji: string; label: string }>>([]);
  const typingTimers = useRef(new Map<string, number>());
  const reactionTimers = useRef(new Map<string, number>());

  const hasControl = session.scope === "personal" || Boolean(connectionId.current && controller?.connectionId === connectionId.current);
  const typingLabels = Object.values(typingActors);
  descriptorRef.current = session;
  canControlRef.current = hasControl;
  activeRef.current = active;

  const writeSocket = useCallback((payload: object) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify(payload));
  }, []);

  const resizeToHost = useCallback(() => {
    if (!fitRef.current || !terminalRef.current) return;
    try {
      fitRef.current.fit();
      const next = { cols: terminalRef.current.cols, rows: terminalRef.current.rows };
      if (!canControlRef.current) return;
      if (next.cols === lastSentSize.current.cols && next.rows === lastSentSize.current.rows) return;
      lastSentSize.current = next;
      writeSocket({ type: "resize", ...next });
    } catch {
      // A moving or minimized desktop window can briefly report a zero-sized host.
    }
  }, [writeSocket]);

  const copySelection = useCallback(async () => {
    const selection = terminalRef.current?.getSelection();
    if (!selection) return;
    try { await navigator.clipboard?.writeText(selection); } catch { /* Clipboard permission can be denied by browser policy. */ }
  }, []);

  const pasteClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard?.readText();
      if (text) terminalRef.current?.paste(text);
    } catch {
      // The browser requires an explicit clipboard grant in some environments.
    }
  }, []);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let effectDisposed = false;
    terminalEnded.current = session.status === "exited";
    lastSentSize.current = { cols: session.cols, rows: session.rows };
    connectionId.current = undefined;
    viewerId.current = undefined;
    lastSequence.current = null;
    reconnectAttempt.current = 0;
    ticketRequestPending.current = false;
    setParticipants(session.participants);
    setController(session.controller);
    setInputMode("insert");
    setTypingActors({});
    setReactions([]);
    setReactionPickerOpen(false);
    setConnectionStatus(session.status === "exited" ? "exited" : "connecting");
    const terminal = new XTerm({
      cols: session.cols,
      rows: session.rows,
      allowProposedApi: false,
      convertEol: false,
      documentOverride: nonceAwareDocument(document),
      cursorBlink: true,
      cursorStyle: "bar",
      cursorInactiveStyle: "outline",
      drawBoldTextInBrightColors: true,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize,
      fontWeight: "400",
      fontWeightBold: "700",
      letterSpacing: 0,
      lineHeight: 1.2,
      minimumContrastRatio: 7,
      rightClickSelectsWord: true,
      scrollback: 10_000,
      scrollOnUserInput: true,
      theme: NEURAL_TERMINAL_THEME,
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(search);
    terminal.open(host);
    terminalRef.current = terminal;
    fitRef.current = fit;
    searchRef.current = search;

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      if (isTerminalCopyShortcut(event)) { void copySelection(); return false; }
      if (isTerminalPasteShortcut(event)) { void pasteClipboard(); return false; }
      if (isTerminalInsertToggle(event)) setInputMode((current) => current === "insert" ? "overwrite" : "insert");
      return true;
    });
    const dataSubscription = terminal.onData((data) => {
      if (canControlRef.current) writeSocket({ type: "input", data });
    });
    let resizeFrame: number | undefined;
    let observedWidth = 0;
    let observedHeight = 0;
    const resizeObserver = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width < 16 || rect.height < 16) return;
      if (Math.abs(rect.width - observedWidth) < 1 && Math.abs(rect.height - observedHeight) < 1) return;
      observedWidth = rect.width;
      observedHeight = rect.height;
      if (resizeFrame !== undefined) window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = undefined;
        resizeToHost();
      });
    });
    resizeObserver.observe(host);

    const scheduleReconnect = (immediate = false) => {
      if (effectDisposed || terminalEnded.current || reconnectTimer.current !== undefined) return;
      setConnectionStatus(navigator.onLine ? "reconnecting" : "offline");
      const attempt = reconnectAttempt.current++;
      const base = immediate ? 0 : Math.min(SOCKET_RETRY_MAX_MS, 500 * (2 ** Math.min(attempt, 5)));
      const delay = immediate ? 0 : Math.round(base * (0.8 + Math.random() * 0.4));
      reconnectTimer.current = window.setTimeout(() => { reconnectTimer.current = undefined; connectRef.current(); }, delay);
    };

    connectRef.current = () => {
      if (effectDisposed || terminalEnded.current || ticketRequestPending.current || socketRef.current?.readyState === WebSocket.CONNECTING || socketRef.current?.readyState === WebSocket.OPEN) return;
      setConnectionStatus(reconnectAttempt.current === 0 ? "connecting" : "reconnecting");
      ticketRequestPending.current = true;
      void issueTerminalTicket(session.id, lastSequence.current).then((ticket) => {
        ticketRequestPending.current = false;
        if (effectDisposed) return;
        const socket = new WebSocket(terminalSocketUrl(ticket.path), [ticket.protocol, `ticket.${ticket.ticket}`]);
        socketRef.current = socket;
        const socketReadyTimer = window.setTimeout(() => {
          if (socketRef.current === socket && socket.readyState !== WebSocket.CLOSED) {
            socket.close(4000, "Terminal handshake timed out");
          }
        }, SOCKET_READY_TIMEOUT_MS);
        readyTimer.current = socketReadyTimer;
        const clearSocketReadyTimer = () => {
          window.clearTimeout(socketReadyTimer);
          if (readyTimer.current === socketReadyTimer) readyTimer.current = undefined;
        };
        socket.onmessage = (event) => {
          let message: Record<string, unknown>;
          try { message = JSON.parse(String(event.data)) as Record<string, unknown>; } catch { return; }
          if (message.type === "ready") {
            clearSocketReadyTimer();
            const next = message.session as TerminalDescriptor;
            connectionId.current = String(message.connectionId);
            viewerId.current = (message.viewer as { id?: string } | undefined)?.id;
            setParticipants(next.participants);
            setController(next.controller);
            descriptorRef.current = next;
            onDescriptorChange(next);
            if (message.mode === "replay") terminal.reset();
            setConnectionStatus("connected");
            reconnectAttempt.current = 0;
            window.requestAnimationFrame(() => {
              terminal.options.disableStdin = next.scope === "team" && next.controller?.connectionId !== connectionId.current;
              resizeToHost();
              if (activeRef.current) terminal.focus();
            });
          } else if (message.type === "replay") {
            terminal.reset();
            terminal.write(String(message.data ?? ""));
            lastSequence.current = Number(message.sequence) || 0;
          } else if (message.type === "output") {
            const sequence = Number(message.sequence);
            if (Number.isSafeInteger(sequence) && (lastSequence.current === null || sequence > lastSequence.current)) {
              terminal.write(String(message.data ?? ""));
              lastSequence.current = sequence;
            }
          } else if (message.type === "presence") {
            const nextParticipants = message.participants as TerminalParticipant[];
            const nextController = message.controller as TerminalController | null;
            setParticipants(nextParticipants);
            setController(nextController);
            terminal.options.disableStdin = descriptorRef.current.scope === "team" && nextController?.connectionId !== connectionId.current;
            const next = { ...descriptorRef.current, participants: nextParticipants, controller: nextController };
            descriptorRef.current = next;
            onDescriptorChange(next);
          } else if (message.type === "layout") {
            const nextController = message.controller as TerminalController | null;
            setController(nextController);
            const nextSize = { cols: Number(message.cols), rows: Number(message.rows) };
            lastSentSize.current = nextSize;
            window.requestAnimationFrame(resizeToHost);
            const next = { ...descriptorRef.current, cols: Number(message.cols), rows: Number(message.rows), controller: nextController };
            descriptorRef.current = next;
            onDescriptorChange(next);
          } else if (message.type === "input-activity") {
            const actor = message.actor as { id?: string; label?: string };
            if (!actor.id || !actor.label || actor.id === viewerId.current) return;
            const prior = typingTimers.current.get(actor.id);
            if (prior !== undefined) window.clearTimeout(prior);
            setTypingActors((current) => ({ ...current, [actor.id as string]: actor.label as string }));
            const timer = window.setTimeout(() => {
              typingTimers.current.delete(actor.id as string);
              setTypingActors((current) => {
                const updated = { ...current };
                delete updated[actor.id as string];
                return updated;
              });
            }, 1200);
            typingTimers.current.set(actor.id, timer);
          } else if (message.type === "reaction") {
            const id = String(message.id ?? "");
            const actor = message.actor as { label?: string };
            const emoji = String(message.emoji ?? "");
            if (!id || !actor.label || !TEAM_REACTIONS.includes(emoji as typeof TEAM_REACTIONS[number])) return;
            setReactions((current) => [...current.slice(-2), { id, emoji, label: actor.label as string }]);
            const timer = window.setTimeout(() => {
              reactionTimers.current.delete(id);
              setReactions((current) => current.filter((reaction) => reaction.id !== id));
            }, REACTION_DISPLAY_MS);
            reactionTimers.current.set(id, timer);
          } else if (message.type === "exit") {
            terminalEnded.current = true;
            setConnectionStatus("exited");
            const exitCode = Number.isInteger(message.exitCode) ? Number(message.exitCode) : null;
            const next = { ...descriptorRef.current, status: "exited" as const, exitCode };
            descriptorRef.current = next;
            onDescriptorChange(next);
          } else if (message.type === "closed") {
            terminalEnded.current = true;
            setConnectionStatus("exited");
            terminal.write("\r\n\x1b[38;2;255;118;101mTerminal ended.\x1b[0m\r\n");
          }
        };
        socket.onclose = () => {
          clearSocketReadyTimer();
          if (socketRef.current === socket) socketRef.current = undefined;
          if (!effectDisposed) scheduleReconnect();
        };
        socket.onerror = () => socket.close();
      }).catch((caught) => {
        ticketRequestPending.current = false;
        if (caught instanceof TerminalRequestError && caught.status === 404) {
          terminalEnded.current = true;
          setConnectionStatus("exited");
          onUnavailable();
          return;
        }
        scheduleReconnect();
      });
    };
    connectRef.current();

    const reconnectWhenAvailable = () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        if (reconnectTimer.current !== undefined) window.clearTimeout(reconnectTimer.current);
        reconnectTimer.current = undefined;
        connectRef.current();
      }
    };
    window.addEventListener("online", reconnectWhenAvailable);
    document.addEventListener("visibilitychange", reconnectWhenAvailable);

    return () => {
      effectDisposed = true;
      ticketRequestPending.current = false;
      if (reconnectTimer.current !== undefined) window.clearTimeout(reconnectTimer.current);
      if (readyTimer.current !== undefined) window.clearTimeout(readyTimer.current);
      window.removeEventListener("online", reconnectWhenAvailable);
      document.removeEventListener("visibilitychange", reconnectWhenAvailable);
      if (resizeFrame !== undefined) window.cancelAnimationFrame(resizeFrame);
      for (const timer of typingTimers.current.values()) window.clearTimeout(timer);
      for (const timer of reactionTimers.current.values()) window.clearTimeout(timer);
      typingTimers.current.clear();
      reactionTimers.current.clear();
      resizeObserver.disconnect();
      dataSubscription.dispose();
      if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ type: "detach" }));
      socketRef.current?.close(1000, "Terminal view closed");
      socketRef.current = undefined;
      terminal.dispose();
      terminalRef.current = undefined;
      fitRef.current = undefined;
      searchRef.current = undefined;
    };
  // Each pane owns exactly one xterm instance and WebSocket for its lifetime.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  useEffect(() => {
    if (!searchQuery) { searchRef.current?.clearDecorations(); return; }
    searchRef.current?.findNext(searchQuery, { incremental: true, decorations: { matchOverviewRuler: "#785c13", activeMatchColorOverviewRuler: "#ffcf55", matchBackground: "#785c13", activeMatchBackground: "#bc8c16" } });
  }, [searchQuery]);

  useEffect(() => {
    window.requestAnimationFrame(resizeToHost);
  }, [hasControl, resizeToHost]);

  useEffect(() => {
    if (active && connectionStatus === "connected") terminalRef.current?.focus();
  }, [active, connectionStatus]);

  useEffect(() => {
    if (!terminalRef.current) return;
    terminalRef.current.options.fontSize = fontSize;
    window.requestAnimationFrame(resizeToHost);
  }, [fontSize, resizeToHost]);

  const reconnectNow = () => {
    terminalEnded.current = false;
    reconnectAttempt.current = 0;
    if (reconnectTimer.current !== undefined) window.clearTimeout(reconnectTimer.current);
    reconnectTimer.current = undefined;
    socketRef.current?.close();
    socketRef.current = undefined;
    connectRef.current();
  };

  const claimControl = () => {
    writeSocket({ type: "claim-control" });
    terminalRef.current?.focus();
  };

  const sendReaction = (emoji: typeof TEAM_REACTIONS[number]) => {
    writeSocket({ type: "reaction", emoji });
    setReactionPickerOpen(false);
    terminalRef.current?.focus();
  };

  return (
    <section className={`terminal-pane${active ? " is-active" : ""}`} aria-label={`${session.title} terminal pane`} onFocusCapture={onActivate} onMouseDown={() => { onActivate(); terminalRef.current?.focus(); }}>
      <header className="terminal-pane__header">
        <div className={`terminal-pane__session is-${session.scope}`}><i /><strong>{session.shell}</strong><span>{session.cwd}</span>{session.scope === "team" && <em><Users />shared</em>}</div>
        {typingLabels.length > 0 && <span className="terminal-pane__typing">{typingLabels.length === 1 ? `${typingLabels[0]} is typing…` : `${typingLabels.length} teammates are typing…`}</span>}
        <span className={`terminal-pane__mode is-${hasControl ? inputMode : "view"}`} title={hasControl ? "Insert toggles Insert/Overwrite mode" : "Take control to type"}>{hasControl ? (inputMode === "insert" ? "INS" : "OVR") : "VIEW"}</span>
        <span className={`terminal-pane__state is-${connectionStatus}`}><i />{connectionStatus}</span>
        <div className="terminal-pane__actions">
          <button type="button" aria-label={`Copy selection from ${session.title}`} title="Copy selection" onClick={() => void copySelection()}><Copy /></button>
          <button type="button" aria-label={`Paste into ${session.title}`} title="Paste" onClick={() => void pasteClipboard()}><Clipboard /></button>
          <button type="button" aria-label={`Clear ${session.title}`} title="Clear terminal" onClick={() => terminalRef.current?.clear()}><Eraser /></button>
          {session.scope === "team" && !hasControl && <button type="button" className="terminal-pane__claim" aria-label={`Take control of ${session.title}`} title="Take control and type" onClick={claimControl}><Crown /></button>}
          {connectionStatus !== "connected" && connectionStatus !== "exited" && <button type="button" aria-label={`Reconnect ${session.title}`} title="Reconnect now" onClick={reconnectNow}><RefreshCw /></button>}
          {session.scope === "team" && session.canTerminate && <button type="button" aria-label={`End ${session.title} for everyone`} title="End for everyone" onClick={onEndTeam}><Users /><X /></button>}
          <button type="button" aria-label={`Close ${session.title} pane`} title={session.scope === "team" ? "Leave terminal" : "End terminal"} onClick={onClose}><X /></button>
        </div>
      </header>
      {session.scope === "team" && <div className="terminal-pane__presence"><span><Users />{participants.length} connected</span>{participants.map((participant) => <i className={controller?.id === participant.id ? "is-controller" : ""} key={participant.id} title={`${participant.label} · ${participant.connections} view${participant.connections === 1 ? "" : "s"}`}>{participant.label.slice(0, 2).toUpperCase()}</i>)}<small><Crown />{hasControl ? "Your turn" : controller ? `${controller.label} is driving` : "Waiting for a driver"}</small><div className="terminal-pane__reaction-picker"><button type="button" aria-label="Send a team reaction" aria-expanded={reactionPickerOpen} title="Send an emoji sticker" onClick={() => setReactionPickerOpen((open) => !open)}><SmilePlus /></button>{reactionPickerOpen && <div role="menu" aria-label="Team reactions">{TEAM_REACTIONS.map((emoji) => <button type="button" role="menuitem" aria-label={`Send ${emoji}`} key={emoji} onClick={() => sendReaction(emoji)}>{emoji}</button>)}</div>}</div></div>}
      <div className="terminal-pane__canvas">{session.scope === "team" && reactions.length > 0 && <div className="terminal-pane__reactions" aria-live="polite">{reactions.map((reaction) => <span className="terminal-pane__reaction" aria-label={`${reaction.label} reacted with ${reaction.emoji}`} key={reaction.id}><span className="terminal-pane__reaction-burst" aria-hidden="true"><b>{reaction.emoji}</b><small>{reaction.label}</small></span></span>)}</div>}<div ref={hostRef} className="terminal-xterm" aria-label={`${session.title} interactive terminal`} /></div>
    </section>
  );
}
