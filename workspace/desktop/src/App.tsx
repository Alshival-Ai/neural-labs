import {
  Bot,
  CalendarClock,
  CopyPlus,
  FileCode2,
  FileSearch2,
  Folder,
  LogOut,
  Minimize2,
  Settings,
  Sparkles,
  TerminalSquare,
  WandSparkles,
  X,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";

import { DesktopWindow } from "./DesktopWindow";
import { readDeviceState, removeDeviceState, writeDeviceState } from "./deviceState";
import type { EditorAccent, EditorDocument, EditorLanguage } from "./EditorApp";
import {
  DESKTOP_FONT_SCALE_DEFAULT,
  desktopTypographyStyle,
  normalizeDesktopFontScale,
} from "./fontScale";
import {
  readWorkspaceTextFile, saveWorkspaceTextFile, type WorkspacePreviewFile, type WorkspaceTextFile,
} from "./filesApi";
import { NeuraGateway } from "./openclaw";
import { AutomationsGateway } from "./automationsGateway";

const AutomationsLiveApp = lazy(() => import("./AutomationsLiveApp").then((module) => ({ default: module.AutomationsLiveApp })));
const EditorApp = lazy(() => import("./EditorApp").then((module) => ({ default: module.EditorApp })));
const FilesApp = lazy(() => import("./FilesApp").then((module) => ({ default: module.FilesApp })));
const NeuraApp = lazy(() => import("./NeuraApp").then((module) => ({ default: module.NeuraApp })));
const PreviewApp = lazy(() => import("./PreviewApp").then((module) => ({ default: module.PreviewApp })));
const SettingsApp = lazy(() => import("./SettingsApp").then((module) => ({ default: module.SettingsApp })));
const SkillsLiveApp = lazy(() => import("./SkillsLiveApp").then((module) => ({ default: module.SkillsLiveApp })));
const TerminalApp = lazy(() => import("./TerminalApp").then((module) => ({ default: module.TerminalApp })));

type Session = {
  authenticated: boolean;
  csrfToken?: string;
  providers?: Array<"local" | "microsoft">;
  user?: {
    id: string;
    email: string;
    handle: string;
    displayName: string;
    role: "admin" | "user";
    status: "active" | "pending" | "rejected" | "disabled";
  };
};

type Runtime = { status: string };
type DesktopApp = "neura" | "files" | "editor" | "preview" | "settings" | "terminal" | "automations" | "skills";
type WindowVisibility = "open" | "minimized";
type DesktopWindowState = { id: string; app: DesktopApp; visibility: WindowVisibility; order: number; preview?: WorkspacePreviewFile };

type DesktopDeviceState = {
  windows: DesktopWindowState[];
  editorPaths: string[];
  activeEditorId?: string;
};

type AppearanceDeviceState = {
  fontScale: number;
};

const DESKTOP_APPS = new Set<DesktopApp>(["neura", "files", "editor", "preview", "settings", "terminal", "automations", "skills"]);

function storedPreviewFile(value: unknown): WorkspacePreviewFile | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.name !== "string" || !raw.name || raw.name.length > 255 ||
      typeof raw.path !== "string" || !raw.path || raw.path.length > 4096 ||
      typeof raw.mimeType !== "string" || !raw.mimeType || raw.mimeType.length > 255 ||
      typeof raw.size !== "number" || !Number.isSafeInteger(raw.size) || raw.size < 0) return undefined;
  return { name: raw.name, path: raw.path, mimeType: raw.mimeType, size: raw.size };
}

function settingsLaunch(): { open: boolean; notice?: { tone: "success" | "error"; message: string } } {
  const parameters = new URLSearchParams(window.location.search);
  const success = parameters.get("success")?.slice(0, 240);
  const error = parameters.get("error")?.slice(0, 240);
  return {
    open: parameters.get("settings") === "personalization" || parameters.get("user-settings") === "1",
    ...(success ? { notice: { tone: "success" as const, message: success } } : error ? { notice: { tone: "error" as const, message: error } } : {}),
  };
}

function desktopDeviceState(userId: string): DesktopDeviceState | undefined {
  const stored = readDeviceState(userId, "desktop");
  if (!stored || typeof stored !== "object") return undefined;
  const raw = stored as Record<string, unknown>;
  if (!Array.isArray(raw.windows)) return undefined;
  const windows = raw.windows.flatMap((candidate, index): DesktopWindowState[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const value = candidate as Record<string, unknown>;
    const app = value.app === "user-settings" ? "settings" : value.app;
    if (typeof value.id !== "string" || !DESKTOP_APPS.has(app as DesktopApp)) return [];
    const id = value.id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100);
    if (!id) return [];
    const preview = app === "preview" ? storedPreviewFile(value.preview) : undefined;
    if (app === "preview" && !preview) return [];
    return [{
      id,
      app: app as DesktopApp,
      visibility: value.visibility === "minimized" ? "minimized" : "open",
      order: index + 1,
      ...(preview ? { preview } : {}),
    }];
  }).slice(0, 24);
  return {
    windows,
    editorPaths: Array.isArray(raw.editorPaths) ? raw.editorPaths.filter((path): path is string => typeof path === "string" && path.length <= 4096).slice(0, 20) : [],
    activeEditorId: typeof raw.activeEditorId === "string" ? raw.activeEditorId.slice(0, 4096) : undefined,
  };
}

function appearanceDeviceState(userId: string): AppearanceDeviceState {
  const stored = readDeviceState(userId, "appearance");
  const value = stored && typeof stored === "object" ? (stored as Record<string, unknown>).fontScale : undefined;
  return { fontScale: normalizeDesktopFontScale(value) };
}

function freshWindowId(app: DesktopApp): string {
  return `${app}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function raiseWindow(windows: DesktopWindowState[], windowId: string): DesktopWindowState[] {
  const ordered = [...windows].sort((left, right) => left.order - right.order);
  const target = ordered.find((window) => window.id === windowId);
  if (!target) return windows;
  if (target.visibility === "open" && ordered.at(-1)?.id === windowId) return windows;
  return [...ordered.filter((window) => window.id !== windowId), { ...target, visibility: "open" as const }]
    .map((window, index) => ({ ...window, order: index + 1 }));
}

const gateway = new NeuraGateway();
const automationsGateway = new AutomationsGateway();

function initials(value: string): string {
  const local = value.split("@")[0] || "NL";
  const words = local.split(/[._\-\s]+/).filter(Boolean);
  return (words.length > 1 ? words.slice(0, 2).map((word) => word[0]).join("") : local.slice(0, 2)).toUpperCase();
}

const EDITOR_ACCENTS: EditorAccent[] = ["cyan", "violet", "pink", "coral", "amber", "mint"];

function editorAccent(path: string): EditorAccent {
  let hash = 0;
  for (const character of path) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return EDITOR_ACCENTS[Math.abs(hash) % EDITOR_ACCENTS.length];
}

function editorLanguage(path: string): EditorLanguage {
  const name = path.split("/").at(-1)?.toLowerCase() ?? "";
  const extension = name.includes(".") ? name.split(".").at(-1) ?? "" : "";
  if (["ts", "tsx", "mts", "cts"].includes(extension)) return "typescript";
  if (["js", "jsx", "mjs", "cjs"].includes(extension)) return "javascript";
  if (["md", "mdx"].includes(extension)) return "markdown";
  if (["css", "scss", "sass", "less"].includes(extension)) return "css";
  if (["json", "jsonc"].includes(extension)) return "json";
  if (["html", "htm", "xml", "svg"].includes(extension)) return "html";
  if (extension === "py") return "python";
  if (["sh", "bash", "zsh", "fish"].includes(extension)) return "shell";
  if (["yaml", "yml", "toml"].includes(extension)) return "yaml";
  return "plaintext";
}

function toEditorDocument(file: WorkspaceTextFile): EditorDocument {
  return {
    id: file.item.path,
    name: file.item.name,
    path: file.item.path,
    language: editorLanguage(file.item.path),
    accent: editorAccent(file.item.path),
    content: file.content,
    savedContent: file.content,
    version: file.version,
  };
}

async function fetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  if (!response.ok) throw new Error(`Request failed with HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export function App() {
  const [session, setSession] = useState<Session>();
  const [runtime, setRuntime] = useState<string>("Starting");
  const [menuOpen, setMenuOpen] = useState(false);
  const [windows, setWindows] = useState<DesktopWindowState[]>([]);
  const [maximizedWindowIds, setMaximizedWindowIds] = useState<Set<string>>(() => new Set());
  const [dockMenu, setDockMenu] = useState<{ app: DesktopApp; x: number; y: number }>();
  const [persistenceUserId, setPersistenceUserId] = useState<string>();
  const [fontScale, setFontScale] = useState(DESKTOP_FONT_SCALE_DEFAULT);
  const [editorDocuments, setEditorDocuments] = useState<EditorDocument[]>([]);
  const [activeEditorId, setActiveEditorId] = useState<string>();
  const [pendingEditorRestore, setPendingEditorRestore] = useState<{ paths: string[]; activeId?: string }>();
  const [clock, setClock] = useState(new Date());
  const [toast, setToast] = useState<string>();
  const [neuraComposeRequest, setNeuraComposeRequest] = useState<{ id: string; targetWindowId: string; text: string }>();
  const [initialSettingsLaunch] = useState(settingsLaunch);
  const toastTimer = useRef<number | undefined>(undefined);
  const settingsLaunchHandled = useRef(false);
  const editorDocumentsRef = useRef(editorDocuments);
  const openingEditorPaths = useRef(new Set<string>());
  editorDocumentsRef.current = editorDocuments;
  const editorPathSignature = editorDocuments.map((document) => document.path).join("\n");

  const notify = useCallback((message: string) => {
    window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => setToast(undefined), 3200);
  }, []);

  useEffect(() => {
    let stopped = false;
    let runtimeRequestPending = false;
    const refreshRuntime = async () => {
      if (stopped || runtimeRequestPending) return;
      runtimeRequestPending = true;
      try {
        const workspace = await fetchJson<Runtime>("/api/workspace");
        if (!stopped) setRuntime(workspace.status);
      } catch {
        if (!stopped) setRuntime("offline");
      } finally {
        runtimeRequestPending = false;
      }
    };
    const refreshRuntimeWhenAvailable = () => {
      if (document.visibilityState === "visible" && navigator.onLine) void refreshRuntime();
    };

    gateway.start();
    void fetchJson<Session>("/api/session").then((payload) => {
      if (!payload.authenticated) window.location.assign("/login?error=Please+log+in");
      else {
        const userId = payload.user?.id;
        if (userId) {
          const restored = desktopDeviceState(userId);
          setFontScale(appearanceDeviceState(userId).fontScale);
          if (restored) {
            setWindows(restored.windows.filter((window) => window.app !== "automations" || payload.user?.role === "admin"));
            setPendingEditorRestore({ paths: restored.editorPaths, activeId: restored.activeEditorId });
          }
          setPersistenceUserId(userId);
        }
        setSession(payload);
      }
    }).catch(() => window.location.assign("/login?error=Please+log+in"));
    void refreshRuntime();
    const runtimeInterval = window.setInterval(() => void refreshRuntime(), 10_000);
    const clockInterval = window.setInterval(() => setClock(new Date()), 30_000);
    window.addEventListener("online", refreshRuntimeWhenAvailable);
    document.addEventListener("visibilitychange", refreshRuntimeWhenAvailable);
    return () => {
      stopped = true;
      window.clearInterval(runtimeInterval);
      window.clearInterval(clockInterval);
      window.removeEventListener("online", refreshRuntimeWhenAvailable);
      document.removeEventListener("visibilitychange", refreshRuntimeWhenAvailable);
    };
  }, []);

  useEffect(() => {
    if (!persistenceUserId || session?.user?.id !== persistenceUserId) return;
    if (pendingEditorRestore) return;
    writeDeviceState(persistenceUserId, "desktop", {
      windows,
      editorPaths: editorDocuments.map((document) => document.path),
      activeEditorId,
    } satisfies DesktopDeviceState);
  }, [activeEditorId, editorPathSignature, pendingEditorRestore, persistenceUserId, session, windows]);

  useEffect(() => {
    if (!persistenceUserId || session?.user?.id !== persistenceUserId) return;
    writeDeviceState(persistenceUserId, "appearance", { fontScale } satisfies AppearanceDeviceState);
  }, [fontScale, persistenceUserId, session?.user?.id]);

  useEffect(() => {
    const closeMenu = (event: MouseEvent) => {
      if (!(event.target as Element).closest(".account-menu")) setMenuOpen(false);
      if (!(event.target as Element).closest(".dock-context-menu")) setDockMenu(undefined);
    };
    const closeMenuWithKeyboard = (event: KeyboardEvent) => { if (event.key === "Escape") setDockMenu(undefined); };
    document.addEventListener("click", closeMenu);
    window.addEventListener("keydown", closeMenuWithKeyboard);
    return () => {
      document.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", closeMenuWithKeyboard);
    };
  }, []);

  const logout = async () => {
    if (!session?.csrfToken) return;
    try {
      const result = await fetchJson<{ redirectTo: string }>("/api/auth/logout", {
        method: "POST",
        headers: { "X-CSRF-Token": session.csrfToken },
        body: "{}",
      });
      window.location.assign(result.redirectTo);
    } catch {
      notify("Sign out failed. Please try again.");
    }
  };

  const newAppWindow = useCallback((app: DesktopApp) => {
    if (app === "automations" && session?.user?.role !== "admin") return;
    if (windows.length >= 24 || windows.filter((window) => window.app === app).length >= 8) {
      notify("Close a window before opening another one.");
      setDockMenu(undefined);
      return;
    }
    setWindows((current) => [...current, {
      id: freshWindowId(app),
      app,
      visibility: "open",
      order: current.length + 1,
    }]);
    setDockMenu(undefined);
  }, [notify, session?.user?.role, windows]);

  const revealApp = useCallback((app: DesktopApp) => {
    if (app === "automations" && session?.user?.role !== "admin") return;
    setDockMenu(undefined);
    setWindows((current) => {
      const existing = current.filter((window) => window.app === app);
      if (existing.length === 0) return current.length >= 24 ? current : [...current, { id: freshWindowId(app), app, visibility: "open", order: current.length + 1 }];
      const target = existing.sort((left, right) => right.order - left.order)[0];
      return raiseWindow(current, target.id);
    });
  }, [session?.user?.role]);

  useEffect(() => {
    if (!session?.user || !initialSettingsLaunch.open || settingsLaunchHandled.current) return;
    settingsLaunchHandled.current = true;
    revealApp("settings");
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.hash}`);
  }, [initialSettingsLaunch.open, revealApp, session?.user]);

  const toggleDockApp = useCallback((app: DesktopApp) => {
    if (app === "automations" && session?.user?.role !== "admin") return;
    setDockMenu(undefined);
    setWindows((current) => {
      const existing = current.filter((window) => window.app === app);
      if (existing.length === 0) return current.length >= 24 ? current : [...current, { id: freshWindowId(app), app, visibility: "open", order: current.length + 1 }];
      if (existing.some((window) => window.visibility === "open")) {
        return current.map((window) => window.app === app && window.visibility === "open" ? { ...window, visibility: "minimized" } : window);
      }
      const restored = current.map((window) => window.app === app ? { ...window, visibility: "open" as const } : window);
      const target = [...existing].sort((left, right) => right.order - left.order)[0];
      return raiseWindow(restored, target.id);
    });
  }, [session?.user?.role]);

  const activateWindow = useCallback((windowId: string) => {
    setWindows((current) => raiseWindow(current, windowId));
  }, []);

  const updateWindowMaximized = useCallback((windowId: string, maximized: boolean) => {
    setMaximizedWindowIds((current) => {
      if (current.has(windowId) === maximized) return current;
      const updated = new Set(current);
      if (maximized) updated.add(windowId);
      else updated.delete(windowId);
      return updated;
    });
  }, []);

  const minimizeWindow = useCallback((windowId: string) => {
    setWindows((current) => current.map((window) => window.id === windowId ? { ...window, visibility: "minimized" } : window));
  }, []);

  const discardWindowState = useCallback((window: DesktopWindowState) => {
    removeDeviceState(persistenceUserId, `window.${window.app}.${window.id}`);
    removeDeviceState(persistenceUserId, `${window.app}.${window.id}`);
  }, [persistenceUserId]);

  const closeWindow = useCallback((windowId: string) => {
    const target = windows.find((window) => window.id === windowId);
    if (target) discardWindowState(target);
    setWindows((current) => current.filter((window) => window.id !== windowId));
    updateWindowMaximized(windowId, false);
  }, [discardWindowState, updateWindowMaximized, windows]);

  const minimizeApp = useCallback((app: DesktopApp) => {
    setWindows((current) => current.map((window) => window.app === app ? { ...window, visibility: "minimized" } : window));
    setDockMenu(undefined);
  }, []);

  const closeApp = useCallback((app: DesktopApp) => {
    for (const window of windows) if (window.app === app) {
      discardWindowState(window);
      updateWindowMaximized(window.id, false);
    }
    setWindows((current) => current.filter((window) => window.app !== app));
    setDockMenu(undefined);
  }, [discardWindowState, updateWindowMaximized, windows]);

  const email = session?.user?.email ?? "Loading account…";
  const role = session?.user?.role ?? "member";
  const runtimeClass = runtime === "ready" ? "is-ready" : runtime === "offline" ? "is-offline" : "";

  const openEditorFile = useCallback(async (path: string) => {
    if (editorDocumentsRef.current.some((document) => document.id === path)) {
      setActiveEditorId(path);
      revealApp("editor");
      return;
    }
    if (openingEditorPaths.current.has(path)) return;
    openingEditorPaths.current.add(path);
    try {
      const document = toEditorDocument(await readWorkspaceTextFile(path));
      setEditorDocuments((current) => {
        const next = current.some((item) => item.id === document.id)
          ? current.map((item) => item.id === document.id ? document : item)
          : [...current, document];
        editorDocumentsRef.current = next;
        return next;
      });
      setActiveEditorId(document.id);
      revealApp("editor");
    } catch (error) {
      notify(error instanceof Error ? error.message : "The file could not be opened in Editor.");
    } finally {
      openingEditorPaths.current.delete(path);
    }
  }, [notify, revealApp]);

  const openPreviewFile = useCallback((file: WorkspacePreviewFile) => {
    const existing = windows.find((window) => window.app === "preview" && window.preview?.path === file.path);
    if (existing) {
      setWindows((current) => raiseWindow(current, existing.id));
      return;
    }
    if (windows.length >= 24 || windows.filter((window) => window.app === "preview").length >= 8) {
      notify("Close a preview window before opening another one.");
      return;
    }
    setWindows((current) => [...current, {
        id: freshWindowId("preview"),
        app: "preview",
        visibility: "open",
        order: current.length + 1,
        preview: file,
      }]);
  }, [notify, windows]);

  useEffect(() => {
    if (!pendingEditorRestore) return;
    let cancelled = false;
    void Promise.all(pendingEditorRestore.paths.map(async (path) => {
      try { return toEditorDocument(await readWorkspaceTextFile(path)); } catch { return undefined; }
    })).then((documents) => {
      if (cancelled) return;
      const restored = documents.filter((document): document is EditorDocument => Boolean(document));
      setEditorDocuments(restored);
      editorDocumentsRef.current = restored;
      setActiveEditorId(pendingEditorRestore.activeId && restored.some((document) => document.id === pendingEditorRestore.activeId)
        ? pendingEditorRestore.activeId
        : restored[0]?.id);
      setPendingEditorRestore(undefined);
    });
    return () => { cancelled = true; };
  }, [pendingEditorRestore]);

  const saveEditorDocument = useCallback(async (document: EditorDocument, content: string) => {
    if (!document.version) throw new Error("Reload this file before saving it.");
    const saved = toEditorDocument(await saveWorkspaceTextFile(document.path, content, document.version));
    setEditorDocuments((current) => {
      const next = current.map((item) => item.id === saved.id ? saved : item);
      editorDocumentsRef.current = next;
      return next;
    });
    notify(`${document.name} saved to the shared workspace.`);
  }, [notify]);

  const reloadEditorDocument = useCallback(async (document: EditorDocument) => {
    const reloaded = toEditorDocument(await readWorkspaceTextFile(document.path));
    setEditorDocuments((current) => {
      const next = current.map((item) => item.id === reloaded.id ? reloaded : item);
      editorDocumentsRef.current = next;
      return next;
    });
    return reloaded;
  }, []);

  const changeEditorDocument = useCallback((document: EditorDocument, content: string) => {
    setEditorDocuments((current) => {
      const next = current.map((item) => item.id === document.id ? { ...item, content } : item);
      editorDocumentsRef.current = next;
      return next;
    });
  }, []);

  const chooseFileFromEditor = (windowId: string) => {
    minimizeWindow(windowId);
    revealApp("files");
  };

  const composeInNeura = useCallback((text: string) => {
    const existing = windows.filter((window) => window.app === "neura").sort((left, right) => right.order - left.order)[0];
    if (!existing && windows.length >= 24) {
      notify("Close a window before opening Neura.");
      return;
    }
    const targetWindowId = existing?.id ?? freshWindowId("neura");
    setWindows((current) => existing
      ? raiseWindow(current, targetWindowId)
      : [...current, { id: targetWindowId, app: "neura", visibility: "open", order: current.length + 1 }]);
    setNeuraComposeRequest({ id: crypto.randomUUID(), targetWindowId, text });
  }, [notify, windows]);

  const openWindows = windows.filter((window) => window.visibility === "open").sort((left, right) => left.order - right.order);
  // Terminal windows remain mounted while minimized so their xterm canvas and
  // shared WebSocket continue from the same live view when restored.
  const mountedWindows = windows.filter((window) => window.visibility === "open" || window.app === "terminal").sort((left, right) => left.order - right.order);
  const activeWindowId = openWindows.at(-1)?.id;
  const focusMode = Boolean(activeWindowId && maximizedWindowIds.has(activeWindowId));
  const windowCount = (app: DesktopApp) => windows.filter((window) => window.app === app).length;
  const visibleWindowCount = (app: DesktopApp) => windows.filter((window) => window.app === app && window.visibility === "open").length;
  const openDockMenu = (app: DesktopApp, event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDockMenu({
      app,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 216)),
      y: Math.max(190, event.clientY - 8),
    });
  };

  return (
    <div
      className={`desktop${focusMode ? " has-maximized-window" : ""}${menuOpen ? " is-topbar-pinned" : ""}${dockMenu ? " is-dock-pinned" : ""}`}
      style={desktopTypographyStyle(fontScale)}
    >
      <picture className="desktop-wallpaper" aria-hidden="true">
        <source media="(max-width: 760px)" srcSet="/workspace/assets/wallpaper-mobile.png" />
        <source media="(max-width: 1180px)" srcSet="/workspace/assets/wallpaper-tablet.png" />
        <img src="/workspace/assets/wallpaper.png" alt="" fetchPriority="high" draggable="false" />
      </picture>
      <span className="shell-reveal-zone shell-reveal-zone--top" aria-hidden="true" />
      <a href="#desktop-canvas" className="skip-link">Skip to desktop</a>
      <header className="topbar">
        <a className="brand" href="/" aria-label="Neural Labs home"><span className="brand-mark">N</span><span>Neural Labs</span></a>
        <div className="topbar-actions">
          <div className={`runtime-state ${runtimeClass}`} title={`Shared workspace: ${runtime}`}><span className="runtime-dot" /><span className="runtime-label">{runtime === "ready" ? "Workspace ready" : runtime}</span></div>
          <time className="desktop-clock" dateTime={clock.toISOString()}>{new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(clock)}</time>
          <div className="account-menu">
            <button type="button" className="avatar-button" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><span>{initials(email)}</span></button>
            {menuOpen && <div className="account-popover">
              <div className="account-details"><strong>{email}</strong><span>{role}</span></div>
              <button type="button" onClick={() => void logout()}><LogOut />Sign out</button>
            </div>}
          </div>
        </div>
      </header>

      <main id="desktop-canvas" className="desktop-canvas">
        {mountedWindows.map((desktopWindow) => {
          const title = desktopWindow.app === "neura" ? "Neura" : desktopWindow.app === "files" ? "Files" : desktopWindow.app === "editor" ? "Editor" : desktopWindow.app === "preview" ? `Preview — ${desktopWindow.preview?.name ?? "File"}` : desktopWindow.app === "settings" ? "Settings" : desktopWindow.app === "automations" ? "Automations" : desktopWindow.app === "skills" ? "Skills" : "Terminal";
          const icon = desktopWindow.app === "neura" ? <WandSparkles /> : desktopWindow.app === "files" ? <Folder /> : desktopWindow.app === "editor" ? <FileCode2 /> : desktopWindow.app === "preview" ? <FileSearch2 /> : desktopWindow.app === "settings" ? <Settings /> : desktopWindow.app === "automations" ? <CalendarClock /> : desktopWindow.app === "skills" ? <Bot /> : <TerminalSquare />;
          return (
            <DesktopWindow
              key={desktopWindow.id}
              title={title}
              icon={icon}
              storageKey={`${desktopWindow.app}.${desktopWindow.id}`}
              storageNamespace={persistenceUserId}
              active={activeWindowId === desktopWindow.id}
              minimized={desktopWindow.visibility === "minimized"}
              zIndex={50 + desktopWindow.order}
              cascadeIndex={desktopWindow.order}
              controls="all"
              onActivate={() => activateWindow(desktopWindow.id)}
              onMaximizedChange={(maximized) => updateWindowMaximized(desktopWindow.id, maximized)}
              onMinimize={() => minimizeWindow(desktopWindow.id)}
              onClose={() => closeWindow(desktopWindow.id)}
            >
              <Suspense fallback={<div className="app-loading">Loading {title.toLowerCase()}…</div>}>
                {desktopWindow.app === "neura" && session?.user && session.csrfToken && <NeuraApp gateway={gateway} notify={notify} csrfToken={session.csrfToken} currentUser={session.user} storageNamespace={persistenceUserId} storageArea={`neura.${desktopWindow.id}`} composeRequest={neuraComposeRequest?.targetWindowId === desktopWindow.id ? neuraComposeRequest : undefined} />}
                {desktopWindow.app === "files" && <FilesApp notify={notify} onOpenFile={(path) => void openEditorFile(path)} onPreviewFile={openPreviewFile} storageNamespace={persistenceUserId} storageArea={`files.${desktopWindow.id}`} />}
                {desktopWindow.app === "editor" && (pendingEditorRestore ? <div className="app-loading">Restoring editor tabs…</div> : <EditorApp documents={editorDocuments} activeDocumentId={activeEditorId} workspaceName="Workspace" onChange={changeEditorDocument} onOpenFile={() => chooseFileFromEditor(desktopWindow.id)} onReload={reloadEditorDocument} onSave={saveEditorDocument} storageNamespace={persistenceUserId} storageArea={`editor.${desktopWindow.id}`} />)}
                {desktopWindow.app === "preview" && desktopWindow.preview && <PreviewApp file={desktopWindow.preview} />}
                {desktopWindow.app === "settings" && session?.user && session.csrfToken && <SettingsApp administrator={session.user.role === "admin"} csrfToken={session.csrfToken} currentUserId={session.user.id} user={session.user} providers={session.providers ?? []} initialNotice={initialSettingsLaunch.notice} initialSection={initialSettingsLaunch.open ? "personalization" : undefined} fontScale={fontScale} onFontScaleChange={setFontScale} onLogout={() => void logout()} storageNamespace={persistenceUserId} storageArea={`settings.${desktopWindow.id}`} />}
                {desktopWindow.app === "terminal" && <TerminalApp workspaceName="Workspace" notify={notify} storageNamespace={persistenceUserId} storageArea={`terminal.${desktopWindow.id}`} fontScale={fontScale} onFontScaleChange={setFontScale} />}
                {desktopWindow.app === "automations" && session?.user?.role === "admin" && <AutomationsLiveApp gateway={automationsGateway} notify={notify} workspaceName="Workspace" />}
                {desktopWindow.app === "skills" && <SkillsLiveApp reader={gateway} administrator={session?.user?.role === "admin" ? automationsGateway : undefined} canManage={session?.user?.role === "admin"} notify={notify} onComposeInNeura={composeInNeura} workspaceName="Workspace" />}
              </Suspense>
            </DesktopWindow>
          );
        })}
        <p className="desktop-context">Shared developer workspace</p>
      </main>

      <span className="shell-reveal-zone shell-reveal-zone--bottom" aria-hidden="true" />
      <nav className="dock" aria-label="Applications">
        <DockButton name="Neura" primary active={windowCount("neura") > 0} count={windowCount("neura")} onClick={() => toggleDockApp("neura")} onContextMenu={(event) => openDockMenu("neura", event)}><Sparkles /></DockButton>
        <DockButton name="Files" active={windowCount("files") > 0} count={windowCount("files")} onClick={() => toggleDockApp("files")} onContextMenu={(event) => openDockMenu("files", event)}><Folder /></DockButton>
        <DockButton name="Editor" active={windowCount("editor") > 0} count={windowCount("editor")} onClick={() => toggleDockApp("editor")} onContextMenu={(event) => openDockMenu("editor", event)}><FileCode2 /></DockButton>
        <DockButton name="Terminal" active={windowCount("terminal") > 0} count={windowCount("terminal")} onClick={() => toggleDockApp("terminal")} onContextMenu={(event) => openDockMenu("terminal", event)}><TerminalSquare /></DockButton>
        <span className="dock-separator" aria-hidden="true" />
        {role === "admin" && <DockButton name="Automations" active={windowCount("automations") > 0} count={windowCount("automations")} onClick={() => toggleDockApp("automations")} onContextMenu={(event) => openDockMenu("automations", event)}><CalendarClock /></DockButton>}
        <DockButton name="Skills" active={windowCount("skills") > 0} count={windowCount("skills")} onClick={() => toggleDockApp("skills")} onContextMenu={(event) => openDockMenu("skills", event)}><Bot /></DockButton>
        <DockButton name="Settings" active={windowCount("settings") > 0} count={windowCount("settings")} onClick={() => toggleDockApp("settings")} onContextMenu={(event) => openDockMenu("settings", event)}><Settings /></DockButton>
      </nav>
      {dockMenu && <div className="dock-context-menu" role="menu" aria-label={`${dockMenu.app} actions`} style={{ left: dockMenu.x, top: dockMenu.y }} onClick={(event) => event.stopPropagation()}>
        <strong>{dockMenu.app === "neura" ? "Neura" : dockMenu.app[0].toUpperCase() + dockMenu.app.slice(1)}<small>{windowCount(dockMenu.app)} window{windowCount(dockMenu.app) === 1 ? "" : "s"}</small></strong>
        <button type="button" role="menuitem" onClick={() => newAppWindow(dockMenu.app)}><CopyPlus />New window</button>
        {windowCount(dockMenu.app) > 0 && <button type="button" role="menuitem" onClick={() => visibleWindowCount(dockMenu.app) > 0 ? minimizeApp(dockMenu.app) : revealApp(dockMenu.app)}><Minimize2 />{visibleWindowCount(dockMenu.app) > 0 ? "Minimize" : "Restore"}</button>}
        {windowCount(dockMenu.app) > 0 && <button type="button" role="menuitem" className="is-danger" onClick={() => closeApp(dockMenu.app)}><X />Close {windowCount(dockMenu.app) > 1 ? "all windows" : "window"}</button>}
      </div>}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function DockButton({ name, primary, active, count = 0, onClick, onContextMenu, children }: { name: string; primary?: boolean; active?: boolean; count?: number; onClick: () => void; onContextMenu?: React.MouseEventHandler<HTMLButtonElement>; children: React.ReactNode }) {
  return <button type="button" className={`dock-button${primary ? " dock-button-primary" : ""}`} aria-label={name} aria-haspopup={onContextMenu ? "menu" : undefined} onClick={onClick} onContextMenu={onContextMenu}>{children}<span>{name}</span>{active && <i />}{count > 1 && <b aria-hidden="true">{count}</b>}</button>;
}
