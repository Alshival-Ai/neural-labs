import {
  Bot,
  CalendarClock,
  ChevronRight,
  Code2,
  CopyPlus,
  FileSearch2,
  Folder,
  LogOut,
  Minimize2,
  PanelTopOpen,
  PictureInPicture2,
  Settings,
  Sparkles,
  TerminalSquare,
  WandSparkles,
  X,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";

import { DesktopWindow } from "./DesktopWindow";
import { readDeviceState, removeDeviceState, writeDeviceState } from "./deviceState";
import {
  DESKTOP_FONT_SCALE_DEFAULT,
  desktopTypographyStyle,
  normalizeDesktopFontScale,
} from "./fontScale";
import type { WorkspacePreviewFile } from "./filesApi";
import { NeuraGateway } from "./openclaw";
import { AutomationsGateway } from "./automationsGateway";
import { openPopoutSurface, type PopoutSurface } from "./popoutWindow";
import { createTerminal, type TerminalDescriptor } from "./terminalApi";
import type { VsCodeOpenRequest } from "./VsCodeApp";

const FilesApp = lazy(() => import("./FilesApp").then((module) => ({ default: module.FilesApp })));
const NeuraApp = lazy(() => import("./NeuraApp").then((module) => ({ default: module.NeuraApp })));
const PreviewApp = lazy(() => import("./PreviewApp").then((module) => ({ default: module.PreviewApp })));
const SettingsApp = lazy(() => import("./SettingsApp").then((module) => ({ default: module.SettingsApp })));
const SkillsLiveApp = lazy(() => import("./SkillsLiveApp").then((module) => ({ default: module.SkillsLiveApp })));
const TerminalApp = lazy(() => import("./TerminalApp").then((module) => ({ default: module.TerminalApp })));
const VsCodeApp = lazy(() => import("./VsCodeApp").then((module) => ({ default: module.VsCodeApp })));

type Session = {
  authenticated: boolean;
  csrfToken?: string;
  providers?: Array<"local" | "microsoft">;
  neura?: { agentId: string };
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
type PersonalOpenAIBootstrap = { agentId: string; authenticated: boolean; paused: boolean };
type ToastNotice = { message: string; action?: "open-personalization" };
type DesktopApp = "neura" | "files" | "preview" | "settings" | "terminal" | "vscode" | "automations" | "skills";
type WindowVisibility = "open" | "minimized" | "popped-out";
type DesktopWindowState = { id: string; app: DesktopApp; visibility: WindowVisibility; order: number; preview?: WorkspacePreviewFile };
type ManagedPopout = PopoutSurface & { handlePageHide: () => void };

type DesktopDeviceState = {
  windows: DesktopWindowState[];
};

type AppearanceDeviceState = {
  fontScale: number;
};

const DESKTOP_APPS = new Set<DesktopApp>(["neura", "files", "preview", "settings", "terminal", "vscode", "automations", "skills"]);

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
    const app = value.app === "user-settings" ? "settings" : value.app === "automations" ? "skills" : value.app === "editor" ? "vscode" : value.app;
    if (typeof value.id !== "string" || !DESKTOP_APPS.has(app as DesktopApp)) return [];
    const id = value.id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100);
    if (!id) return [];
    const preview = app === "preview" ? storedPreviewFile(value.preview) : undefined;
    if (app === "preview" && !preview) return [];
    return [{
      id,
      app: app as DesktopApp,
      visibility: value.visibility === "minimized" ? "minimized" : "open",
      order: typeof value.order === "number" && Number.isSafeInteger(value.order) && value.order > 0 ? value.order : index + 1,
      ...(preview ? { preview } : {}),
    }];
  }).slice(0, 24);
  return {
    windows: normalizeWindowOrder(windows),
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

function normalizeWindowOrder(windows: DesktopWindowState[]): DesktopWindowState[] {
  const ordered = [...windows].sort((left, right) => left.order - right.order);
  const alreadyNormalized = ordered.every((window, index) => windows[index]?.id === window.id && window.order === index + 1);
  return alreadyNormalized ? windows : ordered.map((window, index) => ({ ...window, order: index + 1 }));
}

function appendWindow(windows: DesktopWindowState[], window: Omit<DesktopWindowState, "order">): DesktopWindowState[] {
  const ordered = normalizeWindowOrder(windows);
  return [...ordered, { ...window, order: ordered.length + 1 }];
}

function raiseWindow(windows: DesktopWindowState[], windowId: string): DesktopWindowState[] {
  const ordered = normalizeWindowOrder(windows);
  const target = ordered.find((window) => window.id === windowId);
  if (!target) return windows;
  if (target.visibility === "open" && ordered.at(-1)?.id === windowId) return ordered;
  return [...ordered.filter((window) => window.id !== windowId), { ...target, visibility: target.visibility === "popped-out" ? "popped-out" as const : "open" as const }]
    .map((window, index) => ({ ...window, order: index + 1 }));
}

function desktopWindowTitle(window: DesktopWindowState): string {
  if (window.app === "neura") return "Neura";
  if (window.app === "files") return "Files";
  if (window.app === "preview") return `Preview — ${window.preview?.name ?? "File"}`;
  if (window.app === "settings") return "Settings";
  if (window.app === "automations") return "Automations";
  if (window.app === "skills") return "Skills & Automations";
  if (window.app === "vscode") return "VS Code";
  return "Terminal";
}

const gateway = new NeuraGateway();
const automationsGateway = new AutomationsGateway();

function initials(value: string): string {
  const local = value.split("@")[0] || "NL";
  const words = local.split(/[._\-\s]+/).filter(Boolean);
  return (words.length > 1 ? words.slice(0, 2).map((word) => word[0]).join("") : local.slice(0, 2)).toUpperCase();
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
  const [popoutTargets, setPopoutTargets] = useState<Map<string, ManagedPopout>>(() => new Map());
  const [maximizedWindowIds, setMaximizedWindowIds] = useState<Set<string>>(() => new Set());
  const [dockMenu, setDockMenu] = useState<{ app: DesktopApp; x: number; y: number }>();
  const [persistenceUserId, setPersistenceUserId] = useState<string>();
  const [fontScale, setFontScale] = useState(DESKTOP_FONT_SCALE_DEFAULT);
  const [clock, setClock] = useState(new Date());
  const [toast, setToast] = useState<ToastNotice>();
  const [neuraComposeRequest, setNeuraComposeRequest] = useState<{ id: string; targetWindowId: string; text: string }>();
  const [terminalOpenRequest, setTerminalOpenRequest] = useState<{ id: string; targetWindowId: string; session: TerminalDescriptor }>();
  const [skillsLaunchRequest, setSkillsLaunchRequest] = useState<{ id: string; targetWindowId: string; section: "mine" | "automations" }>();
  const [settingsLaunchRequest, setSettingsLaunchRequest] = useState<{ id: string; targetWindowId: string; section: "personalization" }>();
  const [vsCodeOpenRequest, setVsCodeOpenRequest] = useState<VsCodeOpenRequest & { targetWindowId: string }>();
  const [initialSettingsLaunch] = useState(settingsLaunch);
  const toastTimer = useRef<number | undefined>(undefined);
  const popoutTargetsRef = useRef(popoutTargets);
  const settingsLaunchHandled = useRef(false);
  popoutTargetsRef.current = popoutTargets;

  const notify = useCallback((message: string, action?: ToastNotice["action"]) => {
    window.clearTimeout(toastTimer.current);
    setToast({ message, action });
    toastTimer.current = window.setTimeout(() => setToast(undefined), action ? 12_000 : 3_200);
  }, []);

  const takePopout = useCallback((windowId: string): ManagedPopout | undefined => {
    const target = popoutTargetsRef.current.get(windowId);
    if (!target) return undefined;
    target.browserWindow.removeEventListener("beforeunload", target.handlePageHide);
    target.browserWindow.removeEventListener("pagehide", target.handlePageHide);
    const updated = new Map(popoutTargetsRef.current);
    updated.delete(windowId);
    popoutTargetsRef.current = updated;
    setPopoutTargets(updated);
    return target;
  }, []);

  const restorePoppedWindow = useCallback((windowId: string, closeBrowserWindow = true) => {
    const target = takePopout(windowId);
    setWindows((current) => raiseWindow(current.map((window) => window.id === windowId
      ? { ...window, visibility: "open" as const }
      : window), windowId));
    if (closeBrowserWindow && target && !target.browserWindow.closed) {
      window.setTimeout(() => target.browserWindow.close(), 0);
    }
  }, [takePopout]);

  const popOutWindow = useCallback((desktopWindow: DesktopWindowState) => {
    const existing = popoutTargetsRef.current.get(desktopWindow.id);
    if (existing && !existing.browserWindow.closed) {
      existing.browserWindow.focus();
      return;
    }
    const surface = openPopoutSurface(desktopWindowTitle(desktopWindow), desktopWindow.id);
    if (!surface) {
      notify("Your browser blocked the pop-out. Allow pop-ups for Neural Labs and try again.");
      return;
    }
    const handlePageHide = () => restorePoppedWindow(desktopWindow.id, false);
    const target: ManagedPopout = { ...surface, handlePageHide };
    surface.browserWindow.addEventListener("beforeunload", handlePageHide, { once: true });
    surface.browserWindow.addEventListener("pagehide", handlePageHide, { once: true });
    const updated = new Map(popoutTargetsRef.current).set(desktopWindow.id, target);
    popoutTargetsRef.current = updated;
    setPopoutTargets(updated);
    setWindows((current) => current.map((window) => window.id === desktopWindow.id
      ? { ...window, visibility: "popped-out" as const }
      : window));
  }, [notify, restorePoppedWindow]);

  useEffect(() => {
    const closePopouts = () => {
      for (const target of popoutTargetsRef.current.values()) {
        target.browserWindow.removeEventListener("beforeunload", target.handlePageHide);
        target.browserWindow.removeEventListener("pagehide", target.handlePageHide);
        if (!target.browserWindow.closed) target.browserWindow.close();
      }
      popoutTargetsRef.current = new Map();
    };
    window.addEventListener("beforeunload", closePopouts);
    return () => {
      window.removeEventListener("beforeunload", closePopouts);
      closePopouts();
    };
  }, []);

  useEffect(() => {
    let stopped = false;
    let runtimeRequestPending = false;
    let neuraBootstrapPending = false;
    let connectionToastShown = false;
    let expectedNeuraAgentId: string | undefined;
    let neuraBootstrapTimer: number | undefined;
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
    const bootstrapNeura = async () => {
      if (stopped || neuraBootstrapPending || !expectedNeuraAgentId) return;
      window.clearTimeout(neuraBootstrapTimer);
      neuraBootstrapTimer = undefined;
      neuraBootstrapPending = true;
      try {
        const account = await fetchJson<PersonalOpenAIBootstrap>("/api/account/openai");
        if (account.agentId !== expectedNeuraAgentId) throw new Error("The personal Neura agent does not match this session");
        if (!stopped) {
          gateway.setAgentId(account.agentId);
          gateway.start();
          if ((!account.authenticated || account.paused) && !connectionToastShown) {
            connectionToastShown = true;
            notify(account.authenticated
              ? "Resume your ChatGPT account to start using Neura."
              : "Connect your ChatGPT account to start using Neura.", "open-personalization");
          }
        }
      } catch {
        if (!stopped) neuraBootstrapTimer = window.setTimeout(() => void bootstrapNeura(), 4_000);
      } finally {
        neuraBootstrapPending = false;
      }
    };
    const refreshRuntimeWhenAvailable = () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        void refreshRuntime();
        void bootstrapNeura();
      }
    };

    void fetchJson<Session>("/api/session").then((payload) => {
      if (!payload.authenticated) window.location.assign("/login?error=Please+log+in");
      else {
        expectedNeuraAgentId = payload.neura?.agentId;
        void bootstrapNeura();
        const userId = payload.user?.id;
        if (userId) {
          const restored = desktopDeviceState(userId);
          setFontScale(appearanceDeviceState(userId).fontScale);
          if (restored) {
            const allowedWindows = restored.windows.filter((window) => window.app !== "automations" || payload.user?.role === "admin");
            setWindows(allowedWindows);
          } else {
            setWindows([{ id: freshWindowId("terminal"), app: "terminal", visibility: "open", order: 1 }]);
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
      window.clearTimeout(neuraBootstrapTimer);
      window.clearInterval(runtimeInterval);
      window.clearInterval(clockInterval);
      window.removeEventListener("online", refreshRuntimeWhenAvailable);
      document.removeEventListener("visibilitychange", refreshRuntimeWhenAvailable);
    };
  }, [notify]);

  useEffect(() => {
    if (!persistenceUserId || session?.user?.id !== persistenceUserId) return;
    writeDeviceState(persistenceUserId, "desktop", {
      windows: normalizeWindowOrder(windows).map((window) => window.visibility === "popped-out" ? { ...window, visibility: "open" as const } : window),
    } satisfies DesktopDeviceState);
  }, [persistenceUserId, session, windows]);

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
    setWindows((current) => appendWindow(current, {
      id: freshWindowId(app),
      app,
      visibility: "open",
    }));
    setDockMenu(undefined);
  }, [notify, session?.user?.role, windows]);

  const revealApp = useCallback((app: DesktopApp) => {
    if (app === "automations" && session?.user?.role !== "admin") return;
    setDockMenu(undefined);
    const popped = windows.filter((window) => window.app === app && window.visibility === "popped-out").sort((left, right) => right.order - left.order)[0];
    if (popped) {
      popoutTargetsRef.current.get(popped.id)?.browserWindow.focus();
      return;
    }
    setWindows((current) => {
      const existing = current.filter((window) => window.app === app);
      if (existing.length === 0) return current.length >= 24 ? current : appendWindow(current, { id: freshWindowId(app), app, visibility: "open" });
      const target = existing.sort((left, right) => right.order - left.order)[0];
      return raiseWindow(current, target.id);
    });
  }, [session?.user?.role, windows]);

  useEffect(() => {
    if (!session?.user || !initialSettingsLaunch.open || settingsLaunchHandled.current) return;
    settingsLaunchHandled.current = true;
    revealApp("settings");
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.hash}`);
  }, [initialSettingsLaunch.open, revealApp, session?.user]);

  const toggleDockApp = useCallback((app: DesktopApp) => {
    if (app === "automations" && session?.user?.role !== "admin") return;
    setDockMenu(undefined);
    const appWindows = windows.filter((window) => window.app === app);
    const popped = appWindows.filter((window) => window.visibility === "popped-out").sort((left, right) => right.order - left.order)[0];
    if (popped && !appWindows.some((window) => window.visibility === "open")) {
      popoutTargetsRef.current.get(popped.id)?.browserWindow.focus();
      return;
    }
    setWindows((current) => {
      const existing = current.filter((window) => window.app === app);
      if (existing.length === 0) return current.length >= 24 ? current : appendWindow(current, { id: freshWindowId(app), app, visibility: "open" });
      const open = existing.filter((window) => window.visibility === "open").sort((left, right) => left.order - right.order);
      const frontmost = current.filter((window) => window.visibility === "open").sort((left, right) => left.order - right.order).at(-1);
      if (open.length > 0 && frontmost?.app === app) {
        return current.map((window) => window.app === app && window.visibility === "open" ? { ...window, visibility: "minimized" } : window);
      }
      if (open.length > 0) return raiseWindow(current, open.at(-1)!.id);
      const restored = current.map((window) => window.app === app ? { ...window, visibility: "open" as const } : window);
      const target = [...existing].sort((left, right) => right.order - left.order)[0];
      return raiseWindow(restored, target.id);
    });
  }, [session?.user?.role, windows]);

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
    const popout = takePopout(windowId);
    if (popout && !popout.browserWindow.closed) window.setTimeout(() => popout.browserWindow.close(), 0);
    setWindows((current) => normalizeWindowOrder(current.filter((window) => window.id !== windowId)));
    updateWindowMaximized(windowId, false);
  }, [discardWindowState, takePopout, updateWindowMaximized, windows]);

  const minimizeApp = useCallback((app: DesktopApp) => {
    setWindows((current) => current.map((window) => window.app === app && window.visibility === "open" ? { ...window, visibility: "minimized" } : window));
    setDockMenu(undefined);
  }, []);

  const closeApp = useCallback((app: DesktopApp) => {
    for (const window of windows) if (window.app === app) {
      discardWindowState(window);
      updateWindowMaximized(window.id, false);
      const popout = takePopout(window.id);
      if (popout && !popout.browserWindow.closed) globalThis.window.setTimeout(() => popout.browserWindow.close(), 0);
    }
    setWindows((current) => normalizeWindowOrder(current.filter((window) => window.app !== app)));
    setDockMenu(undefined);
  }, [discardWindowState, takePopout, updateWindowMaximized, windows]);

  const restoreAppPopouts = useCallback((app: DesktopApp) => {
    for (const window of windows) {
      if (window.app === app && window.visibility === "popped-out") restorePoppedWindow(window.id);
    }
    setDockMenu(undefined);
  }, [restorePoppedWindow, windows]);

  const email = session?.user?.email ?? "Loading account…";
  const role = session?.user?.role ?? "member";
  const runtimeClass = runtime === "ready" ? "is-ready" : runtime === "offline" ? "is-offline" : "";

  const openInVsCode = useCallback((path: string) => {
    const existing = windows.filter((window) => window.app === "vscode").sort((left, right) => right.order - left.order)[0];
    if (!existing && windows.length >= 24) {
      notify("Close a window before opening VS Code.");
      return;
    }
    const targetWindowId = existing?.id ?? freshWindowId("vscode");
    setWindows((current) => existing
      ? raiseWindow(current, targetWindowId)
      : appendWindow(current, { id: targetWindowId, app: "vscode", visibility: "open" }));
    setVsCodeOpenRequest({ id: crypto.randomUUID(), targetWindowId, path });
    if (existing?.visibility === "popped-out") popoutTargetsRef.current.get(existing.id)?.browserWindow.focus();
  }, [notify, windows]);

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
    setWindows((current) => appendWindow(current, {
        id: freshWindowId("preview"),
        app: "preview",
        visibility: "open",
        preview: file,
      }));
  }, [notify, windows]);

  const composeInNeura = useCallback((text: string) => {
    const existing = windows.filter((window) => window.app === "neura").sort((left, right) => right.order - left.order)[0];
    if (!existing && windows.length >= 24) {
      notify("Close a window before opening Neura.");
      return;
    }
    const targetWindowId = existing?.id ?? freshWindowId("neura");
    setWindows((current) => existing
      ? raiseWindow(current, targetWindowId)
      : appendWindow(current, { id: targetWindowId, app: "neura", visibility: "open" }));
    setNeuraComposeRequest({ id: crypto.randomUUID(), targetWindowId, text });
  }, [notify, windows]);

  const openTeamChatTerminal = useCallback(async (channel: { id: string; name: string }, requestedSession?: TerminalDescriptor): Promise<TerminalDescriptor | undefined> => {
    const existingWindow = windows.filter((window) => window.app === "terminal").sort((left, right) => right.order - left.order)[0];
    if (!existingWindow && windows.length >= 24) {
      notify("Close a window before opening the Team Terminal.");
      return undefined;
    }
    try {
      const terminal = requestedSession
        ?? await createTerminal({ scope: "team", channelId: channel.id, title: `#${channel.name}` });
      const targetWindowId = existingWindow?.id ?? freshWindowId("terminal");
      setWindows((current) => existingWindow
        ? raiseWindow(current, targetWindowId)
        : appendWindow(current, { id: targetWindowId, app: "terminal", visibility: "open" }));
      setTerminalOpenRequest({ id: crypto.randomUUID(), targetWindowId, session: terminal });
      if (existingWindow?.visibility === "popped-out") popoutTargetsRef.current.get(existingWindow.id)?.browserWindow.focus();
      notify(`${terminal.title} is ready for #${channel.name}.`);
      return terminal;
    } catch (error) {
      notify(error instanceof Error ? error.message : "The Team Chat terminal could not be opened.");
      return undefined;
    }
  }, [notify, windows]);

  const openSkillsSection = useCallback((section: "mine" | "automations") => {
    const existing = windows.filter((window) => window.app === "skills" || window.app === "automations").sort((left, right) => right.order - left.order)[0];
    if (!existing && windows.length >= 24) { notify("Close a window before opening Skills."); return; }
    const targetWindowId = existing?.id ?? freshWindowId("skills");
    setWindows((current) => {
      const normalized = current.map((window) => window.id === targetWindowId && window.app === "automations" ? { ...window, app: "skills" as const } : window);
      return existing ? raiseWindow(normalized, targetWindowId) : appendWindow(normalized, { id: targetWindowId, app: "skills", visibility: "open" });
    });
    setSkillsLaunchRequest({ id: crypto.randomUUID(), targetWindowId, section });
    if (existing?.visibility === "popped-out") popoutTargetsRef.current.get(existing.id)?.browserWindow.focus();
    setDockMenu(undefined);
  }, [notify, windows]);

  const openPersonalizationSettings = useCallback(() => {
    const existing = windows.filter((window) => window.app === "settings").sort((left, right) => right.order - left.order)[0];
    if (!existing && windows.length >= 24) { notify("Close a window before opening Settings."); return; }
    const targetWindowId = existing?.id ?? freshWindowId("settings");
    setWindows((current) => existing
      ? raiseWindow(current, targetWindowId)
      : appendWindow(current, { id: targetWindowId, app: "settings", visibility: "open" }));
    setSettingsLaunchRequest({ id: crypto.randomUUID(), targetWindowId, section: "personalization" });
    if (existing?.visibility === "popped-out") popoutTargetsRef.current.get(existing.id)?.browserWindow.focus();
    window.clearTimeout(toastTimer.current);
    setToast(undefined);
  }, [notify, windows]);

  const openWindows = windows.filter((window) => window.visibility === "open").sort((left, right) => left.order - right.order);
  // Live socket-backed apps remain mounted while minimized so their session,
  // transcript, scroll position, and embedded browser state survive restore.
  const mountedWindows = windows.filter((window) => window.visibility === "open" || window.visibility === "popped-out" || window.app === "neura" || window.app === "terminal" || window.app === "vscode" || window.app === "skills" || window.app === "automations").sort((left, right) => left.order - right.order);
  const activeWindowId = openWindows.at(-1)?.id;
  const focusMode = Boolean(activeWindowId && maximizedWindowIds.has(activeWindowId));
  const windowCount = (app: DesktopApp) => windows.filter((window) => window.app === app).length;
  const visibleWindowCount = (app: DesktopApp) => windows.filter((window) => window.app === app && window.visibility === "open").length;
  const poppedOutWindowCount = (app: DesktopApp) => windows.filter((window) => window.app === app && window.visibility === "popped-out").length;
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
          const title = desktopWindowTitle(desktopWindow);
          const icon = desktopWindow.app === "neura" ? <WandSparkles /> : desktopWindow.app === "files" ? <Folder /> : desktopWindow.app === "preview" ? <FileSearch2 /> : desktopWindow.app === "settings" ? <Settings /> : desktopWindow.app === "automations" ? <CalendarClock /> : desktopWindow.app === "skills" ? <Bot /> : desktopWindow.app === "vscode" ? <Code2 /> : <TerminalSquare />;
          return (
            <DesktopWindow
              key={desktopWindow.id}
              title={title}
              icon={icon}
              storageKey={`${desktopWindow.app}.${desktopWindow.id}`}
              storageNamespace={persistenceUserId}
              active={activeWindowId === desktopWindow.id}
              minimized={desktopWindow.visibility === "minimized"}
              popoutContainer={popoutTargets.get(desktopWindow.id)?.mountNode}
              surfaceStyle={desktopTypographyStyle(fontScale)}
              zIndex={50 + desktopWindow.order}
              cascadeIndex={desktopWindow.order}
              controls="all"
              onActivate={() => activateWindow(desktopWindow.id)}
              onMaximizedChange={(maximized) => updateWindowMaximized(desktopWindow.id, maximized)}
              onMinimize={() => minimizeWindow(desktopWindow.id)}
              onPopOut={() => popOutWindow(desktopWindow)}
              onPopIn={() => restorePoppedWindow(desktopWindow.id)}
              onClose={() => closeWindow(desktopWindow.id)}
            >
              <Suspense fallback={<div className="app-loading">Loading {title.toLowerCase()}…</div>}>
                {desktopWindow.app === "neura" && session?.user && session.csrfToken && <NeuraApp gateway={gateway} notify={notify} csrfToken={session.csrfToken} currentUser={session.user} storageNamespace={persistenceUserId} storageArea={`neura.${desktopWindow.id}`} composeRequest={neuraComposeRequest?.targetWindowId === desktopWindow.id ? neuraComposeRequest : undefined} onPreviewFile={openPreviewFile} onOpenTeamTerminal={openTeamChatTerminal} />}
                {desktopWindow.app === "files" && <FilesApp notify={notify} onOpenInVsCode={openInVsCode} onPreviewFile={openPreviewFile} storageNamespace={persistenceUserId} storageArea={`files.${desktopWindow.id}`} />}
                {desktopWindow.app === "preview" && desktopWindow.preview && <PreviewApp file={desktopWindow.preview} />}
                {desktopWindow.app === "settings" && session?.user && session.csrfToken && <SettingsApp administrator={session.user.role === "admin"} csrfToken={session.csrfToken} currentUserId={session.user.id} user={session.user} providers={session.providers ?? []} initialNotice={initialSettingsLaunch.notice} initialSection={initialSettingsLaunch.open ? "personalization" : undefined} sectionRequest={settingsLaunchRequest?.targetWindowId === desktopWindow.id ? settingsLaunchRequest : undefined} fontScale={fontScale} onFontScaleChange={setFontScale} onLogout={() => void logout()} storageNamespace={persistenceUserId} storageArea={`settings.${desktopWindow.id}`} />}
                {desktopWindow.app === "terminal" && <TerminalApp workspaceName="Workspace" notify={notify} storageNamespace={persistenceUserId} storageArea={`terminal.${desktopWindow.id}`} fontScale={fontScale} onFontScaleChange={setFontScale} openRequest={terminalOpenRequest?.targetWindowId === desktopWindow.id ? terminalOpenRequest : undefined} />}
                {desktopWindow.app === "vscode" && <VsCodeApp notify={notify} openRequest={vsCodeOpenRequest?.targetWindowId === desktopWindow.id ? vsCodeOpenRequest : undefined} />}
                {(desktopWindow.app === "skills" || desktopWindow.app === "automations") && session?.user && <SkillsLiveApp reader={gateway} administrator={session.user.role === "admin" ? automationsGateway : undefined} canManage={session.user.role === "admin"} currentUser={{ id: session.user.id, displayName: session.user.displayName, role: session.user.role }} initialSection={skillsLaunchRequest?.targetWindowId === desktopWindow.id ? skillsLaunchRequest.section : "mine"} sectionRequestId={skillsLaunchRequest?.targetWindowId === desktopWindow.id ? skillsLaunchRequest.id : undefined} notify={notify} onComposeInNeura={composeInNeura} workspaceName="Workspace" />}
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
        <DockButton name="VS Code" active={windowCount("vscode") > 0} count={windowCount("vscode")} onClick={() => toggleDockApp("vscode")} onContextMenu={(event) => openDockMenu("vscode", event)}><Code2 /></DockButton>
        <DockButton name="Terminal" active={windowCount("terminal") > 0} count={windowCount("terminal")} onClick={() => toggleDockApp("terminal")} onContextMenu={(event) => openDockMenu("terminal", event)}><TerminalSquare /></DockButton>
        <span className="dock-separator" aria-hidden="true" />
        <DockButton name="Automations" active={windowCount("skills") > 0} count={windowCount("skills")} onClick={() => openSkillsSection("automations")}><CalendarClock /></DockButton>
        <DockButton name="Skills" active={windowCount("skills") > 0} count={windowCount("skills")} onClick={() => openSkillsSection("mine")} onContextMenu={(event) => openDockMenu("skills", event)}><Bot /></DockButton>
        <DockButton name="Settings" active={windowCount("settings") > 0} count={windowCount("settings")} onClick={() => toggleDockApp("settings")} onContextMenu={(event) => openDockMenu("settings", event)}><Settings /></DockButton>
      </nav>
      {dockMenu && <div className="dock-context-menu" role="menu" aria-label={`${dockMenu.app} actions`} style={{ left: dockMenu.x, top: dockMenu.y }} onClick={(event) => event.stopPropagation()}>
        <strong>{dockMenu.app === "neura" ? "Neura" : dockMenu.app === "vscode" ? "VS Code" : dockMenu.app[0].toUpperCase() + dockMenu.app.slice(1)}<small>{poppedOutWindowCount(dockMenu.app) > 0 ? `${poppedOutWindowCount(dockMenu.app)} popped out` : `${windowCount(dockMenu.app)} window${windowCount(dockMenu.app) === 1 ? "" : "s"}`}</small></strong>
        <button type="button" role="menuitem" onClick={() => newAppWindow(dockMenu.app)}><CopyPlus />New window</button>
        {poppedOutWindowCount(dockMenu.app) > 0 && <button type="button" role="menuitem" onClick={() => restoreAppPopouts(dockMenu.app)}><PanelTopOpen />Bring {poppedOutWindowCount(dockMenu.app) > 1 ? "pop-outs" : "pop-out"} back</button>}
        {windowCount(dockMenu.app) > 0 && <button type="button" role="menuitem" onClick={() => visibleWindowCount(dockMenu.app) > 0 ? minimizeApp(dockMenu.app) : revealApp(dockMenu.app)}>{visibleWindowCount(dockMenu.app) > 0 ? <Minimize2 /> : poppedOutWindowCount(dockMenu.app) > 0 ? <PictureInPicture2 /> : <Minimize2 />}{visibleWindowCount(dockMenu.app) > 0 ? "Minimize" : poppedOutWindowCount(dockMenu.app) > 0 ? "Focus pop-out" : "Restore"}</button>}
        {windowCount(dockMenu.app) > 0 && <button type="button" role="menuitem" className="is-danger" onClick={() => closeApp(dockMenu.app)}><X />Close {windowCount(dockMenu.app) > 1 ? "all windows" : "window"}</button>}
      </div>}
      {toast && <div className={`toast${toast.action ? " toast--action" : ""}`} role="status">
        {toast.action === "open-personalization"
          ? <button type="button" className="toast-action" onClick={openPersonalizationSettings} aria-label="Open ChatGPT account settings in Personalization"><span>{toast.message}</span><strong>Open Personalization <ChevronRight /></strong></button>
          : toast.message}
      </div>}
    </div>
  );
}

function DockButton({ name, primary, active, count = 0, onClick, onContextMenu, children }: { name: string; primary?: boolean; active?: boolean; count?: number; onClick: () => void; onContextMenu?: React.MouseEventHandler<HTMLButtonElement>; children: React.ReactNode }) {
  const appClass = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return <button type="button" className={`dock-button dock-button--${appClass}${primary ? " dock-button-primary" : ""}`} aria-label={name} aria-haspopup={onContextMenu ? "menu" : undefined} onClick={onClick} onContextMenu={onContextMenu}>{children}<span>{name}</span>{active && <i />}{count > 1 && <b aria-hidden="true">{count}</b>}</button>;
}
