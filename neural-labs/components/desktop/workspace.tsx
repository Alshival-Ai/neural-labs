"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";

import {
  closeTerminalSession,
  createConversation as createConversationRequest,
  createDirectory,
  createProvider,
  createTerminalSession,
  deleteConversation,
  deletePath,
  fetchNeuraConfig,
  fetchSettings,
  getConversation,
  getFileUrl,
  listConversations,
  listFiles,
  logout as logoutRequest,
  readTextFile,
  removeProvider,
  renamePath,
  saveDesktopSettings,
  saveTextFile,
  sendMessage,
  setDesktopBackgroundFromFile,
  testProvider,
  updateProfile,
  updateProvider,
  uploadFile,
  movePath,
} from "@/lib/client/api";
import { getBackgroundPresetClassName } from "@/lib/shared/providers";
import type {
  AuthViewer,
  ConversationRecord,
  ConversationSummary,
  DesktopBackgroundId,
  DirectoryListing,
  FileEntry,
  NeuraConfig,
  SettingsSnapshot,
} from "@/lib/shared/types";
import {
  DesktopWindowFrame,
  type WindowFrameState,
  type WindowSnapZone,
} from "@/components/desktop/window";
import {
  DOCK_APPS,
  FileExplorerPanel,
  NeuraPanel,
  PreviewPanel,
  SettingsPanel,
  TerminalPanel,
  TextEditorPanel,
} from "@/components/desktop/panels";
import type {
  DesktopEditorTabState,
  DesktopEditorWindowState,
  DesktopTerminalWindowState,
  TerminalLayoutState,
  TerminalPaneState,
  TerminalTabState,
} from "@/components/desktop/app-types";
import { cn } from "@/components/ui/primitives";

type AppKind = "files" | "editor" | "terminal" | "neura" | "settings" | "preview";

interface WorkspaceBounds {
  width: number;
  height: number;
}

interface WorkspaceWindow extends WindowFrameState {
  kind: AppKind;
  accent: string;
}

interface PreviewWindowState {
  entry: FileEntry;
  fileText: string | null;
}

const CUSTOM_BACKGROUND_DIRECTORY = ".neural-labs/backgrounds";
const USER_AVATAR_DIRECTORY = ".neural-labs/profile";
const WINDOW_GAP = 12;
const SNAP_THRESHOLD = 28;
const MIN_WINDOW_WIDTH = 420;
const MIN_WINDOW_HEIGHT = 280;

function createLocalId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createScratchEditorTab(): DesktopEditorTabState {
  return {
    tabId: createLocalId(),
    path: null,
    name: "untitled.txt",
    mimeType: "text/plain",
    content: "",
    savedContent: "",
    isLoading: false,
    isSaving: false,
    errorMessage: null,
    lastSavedAt: null,
  };
}

function createDefaultEditorWindowState(): DesktopEditorWindowState {
  const initialTab = createScratchEditorTab();
  return {
    tabs: [initialTab],
    activeTabId: initialTab.tabId,
    isSidebarOpen: true,
  };
}

function createTabFromSession(
  sessionId: string,
  existingTabs: TerminalTabState[],
  title?: string
): TerminalTabState {
  const tabId = createLocalId();
  const paneId = createLocalId();
  return {
    tabId,
    title: title || `Terminal ${existingTabs.length + 1}`,
    splitMode: "none",
    panes: [{ paneId, sessionId }],
    activePaneId: paneId,
  };
}

function getSessionIdsFromLayout(layout: TerminalLayoutState | null): string[] {
  if (!layout) {
    return [];
  }

  const sessionIds = new Set<string>();
  layout.tabs.forEach((tab) => {
    tab.panes.forEach((pane) => sessionIds.add(pane.sessionId));
  });

  return Array.from(sessionIds);
}

function getCustomBackgroundFileName(file: File): string {
  if (file.type === "image/png") {
    return "custom-background.png";
  }
  if (file.type === "image/jpeg") {
    return "custom-background.jpg";
  }
  if (file.type === "image/webp") {
    return "custom-background.webp";
  }
  if (file.type === "image/gif") {
    return "custom-background.gif";
  }

  const extension = file.name.includes(".")
    ? `.${file.name.split(".").pop()?.toLowerCase() ?? "png"}`
    : ".png";
  return `custom-background${extension}`;
}

function getAvatarFileName(file: File): string {
  if (file.type === "image/png") {
    return "avatar.png";
  }
  if (file.type === "image/jpeg") {
    return "avatar.jpg";
  }
  if (file.type === "image/webp") {
    return "avatar.webp";
  }
  if (file.type === "image/gif") {
    return "avatar.gif";
  }

  const extension = file.name.includes(".")
    ? `.${file.name.split(".").pop()?.toLowerCase() ?? "png"}`
    : ".png";
  return `avatar${extension}`;
}

function getViewerInitials(email: string): string {
  const value = email.trim();
  if (!value) {
    return "U";
  }
  return value.slice(0, 2).toUpperCase();
}

function isTextLike(entry: FileEntry): boolean {
  return (
    entry.mimeType.startsWith("text/") ||
    entry.mimeType.includes("json") ||
    entry.mimeType.includes("javascript")
  );
}

function isPreviewable(entry: FileEntry): boolean {
  return (
    isTextLike(entry) ||
    entry.mimeType.startsWith("image/") ||
    entry.mimeType === "application/pdf" ||
    entry.mimeType.startsWith("text/html")
  );
}

function getSnappedBounds(
  zone: WindowSnapZone,
  workspaceBounds: WorkspaceBounds
) {
  const width = Math.max(
    MIN_WINDOW_WIDTH,
    Math.floor((workspaceBounds.width - WINDOW_GAP * 3) / 2)
  );
  const height = Math.max(
    MIN_WINDOW_HEIGHT,
    Math.floor((workspaceBounds.height - WINDOW_GAP * 3) / 2)
  );
  const fullWidth = Math.max(
    MIN_WINDOW_WIDTH,
    workspaceBounds.width - WINDOW_GAP * 2
  );
  const fullHeight = Math.max(
    MIN_WINDOW_HEIGHT,
    workspaceBounds.height - WINDOW_GAP * 2
  );
  const rightX = Math.max(
    WINDOW_GAP,
    workspaceBounds.width - width - WINDOW_GAP
  );
  const bottomY = Math.max(
    WINDOW_GAP,
    workspaceBounds.height - height - WINDOW_GAP
  );

  switch (zone) {
    case "left":
      return { x: WINDOW_GAP, y: WINDOW_GAP, width, height: fullHeight };
    case "right":
      return { x: rightX, y: WINDOW_GAP, width, height: fullHeight };
    case "top":
      return { x: WINDOW_GAP, y: WINDOW_GAP, width: fullWidth, height };
    case "bottom":
      return { x: WINDOW_GAP, y: bottomY, width: fullWidth, height };
    case "top-left":
      return { x: WINDOW_GAP, y: WINDOW_GAP, width, height };
    case "top-right":
      return { x: rightX, y: WINDOW_GAP, width, height };
    case "bottom-left":
      return { x: WINDOW_GAP, y: bottomY, width, height };
    case "bottom-right":
      return { x: rightX, y: bottomY, width, height };
  }
}

function getMaximizedBounds(workspaceBounds: WorkspaceBounds) {
  return {
    x: WINDOW_GAP,
    y: WINDOW_GAP,
    width: Math.max(MIN_WINDOW_WIDTH, workspaceBounds.width - WINDOW_GAP * 2),
    height: Math.max(MIN_WINDOW_HEIGHT, workspaceBounds.height - WINDOW_GAP * 2),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function clampWindowToWorkspace(
  windowState: WorkspaceWindow,
  workspaceBounds: WorkspaceBounds
): WorkspaceWindow {
  if (workspaceBounds.width <= 0 || workspaceBounds.height <= 0) {
    return windowState;
  }

  if (windowState.maximized) {
    return {
      ...windowState,
      ...getMaximizedBounds(workspaceBounds),
    };
  }

  if (windowState.snappedZone) {
    return {
      ...windowState,
      ...getSnappedBounds(windowState.snappedZone, workspaceBounds),
    };
  }

  const maxWidth = Math.max(
    MIN_WINDOW_WIDTH,
    workspaceBounds.width - WINDOW_GAP * 2
  );
  const maxHeight = Math.max(
    MIN_WINDOW_HEIGHT,
    workspaceBounds.height - WINDOW_GAP * 2
  );
  const width = clamp(windowState.width, MIN_WINDOW_WIDTH, maxWidth);
  const height = clamp(windowState.height, MIN_WINDOW_HEIGHT, maxHeight);
  const x = clamp(
    windowState.x,
    WINDOW_GAP,
    Math.max(WINDOW_GAP, workspaceBounds.width - width - WINDOW_GAP)
  );
  const y = clamp(
    windowState.y,
    WINDOW_GAP,
    Math.max(WINDOW_GAP, workspaceBounds.height - height - WINDOW_GAP)
  );

  return { ...windowState, x, y, width, height };
}

function createWindowBase(
  kind: AppKind,
  title: string,
  accent: string,
  positionIndex: number
): WorkspaceWindow {
  const sizeByKind: Record<AppKind, { width: number; height: number }> = {
    files: { width: 760, height: 620 },
    editor: { width: 1080, height: 700 },
    terminal: { width: 980, height: 640 },
    neura: { width: 980, height: 720 },
    settings: { width: 760, height: 620 },
    preview: { width: 820, height: 620 },
  };
  const size = sizeByKind[kind];
  return {
    id: createLocalId(),
    kind,
    title,
    accent,
    x: 72 + positionIndex * 28,
    y: 72 + positionIndex * 22,
    width: size.width,
    height: size.height,
    minimized: false,
    maximized: false,
    snappedZone: null,
    restoreBounds: null,
    zIndex: 10 + positionIndex,
  };
}

export function NeuralLabsWorkspace({
  viewer,
  initialSettings,
}: {
  viewer: AuthViewer;
  initialSettings: SettingsSnapshot | null;
}) {
  const { setTheme } = useTheme();
  const [currentViewer, setCurrentViewer] = useState<AuthViewer>(viewer);
  const [settings, setSettings] = useState<SettingsSnapshot | null>(initialSettings);
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [fileBackHistory, setFileBackHistory] = useState<string[]>([]);
  const [fileForwardHistory, setFileForwardHistory] = useState<string[]>([]);
  const [windows, setWindows] = useState<WorkspaceWindow[]>([]);
  const [editorWindows, setEditorWindows] = useState<
    Record<string, DesktopEditorWindowState>
  >({});
  const [terminalWindows, setTerminalWindows] = useState<
    Record<string, DesktopTerminalWindowState>
  >({});
  const [previewWindows, setPreviewWindows] = useState<Record<string, PreviewWindowState>>({});
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversation, setActiveConversation] = useState<ConversationRecord | null>(null);
  const [neuraConfig, setNeuraConfig] = useState<NeuraConfig | null>(null);
  const [notice, setNotice] = useState<string>("");
  const [avatarMenuOpen, setAvatarMenuOpen] = useState(false);
  const [workspaceBounds, setWorkspaceBounds] = useState({ width: 1280, height: 720 });
  const workspaceRef = useRef<HTMLElement | null>(null);
  const avatarMenuRef = useRef<HTMLDivElement | null>(null);
  const windowsRef = useRef<WorkspaceWindow[]>([]);
  const editorWindowsRef = useRef<Record<string, DesktopEditorWindowState>>({});
  const terminalWindowsRef = useRef<Record<string, DesktopTerminalWindowState>>({});
  const zCounter = useRef(30);

  const backgroundStyle = useMemo(() => {
    const customPath = settings?.desktop.customBackgroundPath;
    const backgroundId = settings?.desktop.backgroundId;
    if (backgroundId?.startsWith("custom:") && customPath) {
      return `linear-gradient(rgba(6,16,24,0.18), rgba(6,16,24,0.28)), url("${getFileUrl(
        customPath
      )}")`;
    }

    return getBackgroundPresetClassName(settings?.desktop.backgroundId);
  }, [settings?.desktop.backgroundId, settings?.desktop.customBackgroundPath]);

  const avatarUrl = useMemo(
    () =>
      currentViewer.avatarPath ? getFileUrl(currentViewer.avatarPath) : null,
    [currentViewer.avatarPath]
  );

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const settingsPromise = initialSettings
          ? Promise.resolve(initialSettings)
          : fetchSettings();
        const [nextSettings, nextListing, config, conversationIndex] = await Promise.all([
          settingsPromise,
          listFiles(""),
          fetchNeuraConfig(),
          listConversations(),
        ]);
        if (cancelled) {
          return;
        }
        setSettings(nextSettings);
        setListing(nextListing);
        setNeuraConfig(config);
        setConversations(conversationIndex.conversations);

        if (conversationIndex.conversations[0]) {
          setActiveConversation(
            await getConversation(conversationIndex.conversations[0].id)
          );
        }
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Unable to load Neural Labs");
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!avatarMenuRef.current?.contains(event.target as Node)) {
        setAvatarMenuOpen(false);
      }
    }

    if (avatarMenuOpen) {
      window.addEventListener("mousedown", handlePointerDown);
    }

    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [avatarMenuOpen]);

  useEffect(() => {
    void setTheme(settings?.desktop.theme ?? "dark");
  }, [setTheme, settings?.desktop.theme]);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timeoutId = window.setTimeout(() => setNotice(""), 3200);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  useEffect(() => {
    windowsRef.current = windows;
  }, [windows]);

  useEffect(() => {
    editorWindowsRef.current = editorWindows;
  }, [editorWindows]);

  useEffect(() => {
    terminalWindowsRef.current = terminalWindows;
  }, [terminalWindows]);

  useEffect(() => {
    const workspaceNode = workspaceRef.current;
    if (!workspaceNode) {
      return;
    }

    const syncBounds = () => {
      setWorkspaceBounds({
        width: workspaceNode.clientWidth,
        height: workspaceNode.clientHeight,
      });
    };

    syncBounds();
    const observer = new ResizeObserver(syncBounds);
    observer.observe(workspaceNode);
    return () => observer.disconnect();
  }, []);

  function focusWindow(windowId: string) {
    zCounter.current += 1;
    setWindows((current) =>
      current.map((window) =>
        window.id === windowId
          ? { ...window, zIndex: zCounter.current, minimized: false }
          : window
      )
    );
  }

  function updateWindowPosition(windowId: string, position: { x: number; y: number }) {
    setWindows((current) =>
      current.map((window) =>
        window.id === windowId
          ? {
              ...window,
              ...position,
              maximized: false,
              snappedZone: null,
              restoreBounds: null,
            }
          : window
      )
    );
  }

  function updateWindowBounds(
    windowId: string,
    bounds: { x: number; y: number; width: number; height: number }
  ) {
    setWindows((current) =>
      current.map((window) =>
        window.id === windowId
          ? {
              ...window,
              ...bounds,
              maximized: false,
              snappedZone: null,
              restoreBounds: null,
            }
          : window
      )
    );
  }

  function applyWindowSnap(windowId: string, snappedZone: WindowSnapZone) {
    setWindows((current) =>
      current.map((window) => {
        if (window.id !== windowId) {
          return window;
        }

        const restoreBounds = window.restoreBounds ?? {
          x: window.x,
          y: window.y,
          width: window.width,
          height: window.height,
          snappedZone: window.snappedZone,
        };

        return {
          ...window,
          ...getSnappedBounds(snappedZone, workspaceBounds),
          maximized: false,
          snappedZone,
          restoreBounds,
        };
      })
    );
  }

  function toggleWindowMaximize(windowId: string) {
    setWindows((current) =>
      current.map((window) => {
        if (window.id !== windowId) {
          return window;
        }

        if (window.maximized) {
          const restoreBounds = window.restoreBounds;
          return restoreBounds
            ? clampWindowToWorkspace(
                {
                  ...window,
                  x: restoreBounds.x,
                  y: restoreBounds.y,
                  width: restoreBounds.width,
                  height: restoreBounds.height,
                  maximized: false,
                  snappedZone: restoreBounds.snappedZone,
                  restoreBounds: null,
                },
                workspaceBounds
              )
            : { ...window, maximized: false, snappedZone: null };
        }

        return {
          ...window,
          ...getMaximizedBounds(workspaceBounds),
          maximized: true,
          snappedZone: null,
          restoreBounds: {
            x: window.x,
            y: window.y,
            width: window.width,
            height: window.height,
            snappedZone: window.snappedZone,
          },
        };
      })
    );
  }

  useEffect(() => {
    setWindows((current) =>
      current.map((window) => clampWindowToWorkspace(window, workspaceBounds))
    );
  }, [workspaceBounds]);

  async function refreshListing(targetPath = listing?.path ?? "") {
    setListing(await listFiles(targetPath));
  }

  async function navigateFiles(path: string, options?: { preserveForward?: boolean }) {
    const currentPath = listing?.path ?? "";
    if (path === currentPath) {
      return;
    }
    setListing(await listFiles(path));
    setFileBackHistory((current) => [...current, currentPath]);
    if (!options?.preserveForward) {
      setFileForwardHistory([]);
    }
  }

  async function navigateBack() {
    const previousPath = fileBackHistory[fileBackHistory.length - 1];
    if (previousPath === undefined) {
      return;
    }
    const currentPath = listing?.path ?? "";
    setFileBackHistory((current) => current.slice(0, -1));
    setFileForwardHistory((current) => [currentPath, ...current]);
    setListing(await listFiles(previousPath));
  }

  async function navigateForward() {
    const [nextPath, ...rest] = fileForwardHistory;
    if (nextPath === undefined) {
      return;
    }
    const currentPath = listing?.path ?? "";
    setFileForwardHistory(rest);
    setFileBackHistory((current) => [...current, currentPath]);
    setListing(await listFiles(nextPath));
  }

  async function navigateUp() {
    const currentPath = listing?.path ?? "";
    if (!currentPath) {
      return;
    }
    const segments = currentPath.split("/").filter(Boolean);
    segments.pop();
    await navigateFiles(segments.join("/"));
  }

  async function applyDesktopBackground(
    backgroundId: DesktopBackgroundId,
    customBackgroundPath?: string | null
  ) {
    await saveDesktopSettings({
      backgroundId,
      customBackgroundPath:
        customBackgroundPath === undefined
          ? settings?.desktop.customBackgroundPath ?? null
          : customBackgroundPath,
    });
    setSettings(await fetchSettings());
  }

  function openOrFocusSingleton(kind: AppKind, title: string, accent: string) {
    const existing = [...windows]
      .filter((window) => window.kind === kind)
      .sort((left, right) => right.zIndex - left.zIndex)[0];
    if (existing) {
      focusWindow(existing.id);
      return existing.id;
    }
    const nextWindow = createWindowBase(kind, title, accent, windows.length);
    setWindows((current) => [...current, nextWindow]);
    return nextWindow.id;
  }

  function focusOrRestoreLatestWindow(kind: AppKind) {
    const latestWindow = [...windows]
      .filter((window) => window.kind === kind)
      .sort((left, right) => right.zIndex - left.zIndex)[0];

    if (!latestWindow) {
      return false;
    }

    focusWindow(latestWindow.id);
    return true;
  }

  function createEditorWindow(): string {
    const nextWindow = createWindowBase(
      "editor",
      "Text Editor",
      "#ff9b5d",
      windowsRef.current.length
    );
    setWindows((current) => [...current, nextWindow]);
    setEditorWindows((current) => ({
      ...current,
      [nextWindow.id]: createDefaultEditorWindowState(),
    }));
    return nextWindow.id;
  }

  function getLatestWindowByKind(kind: AppKind): WorkspaceWindow | null {
    const latest = [...windowsRef.current]
      .filter((window) => window.kind === kind)
      .sort((left, right) => right.zIndex - left.zIndex)[0];
    return latest ?? null;
  }

  function updateEditorWindowState(
    windowId: string,
    update: (state: DesktopEditorWindowState) => DesktopEditorWindowState
  ) {
    setEditorWindows((current) => {
      const state = current[windowId];
      if (!state) {
        return current;
      }
      return {
        ...current,
        [windowId]: update(state),
      };
    });
  }

  function updateTerminalWindowState(
    windowId: string,
    update: (state: DesktopTerminalWindowState) => DesktopTerminalWindowState
  ) {
    setTerminalWindows((current) => {
      const state = current[windowId];
      if (!state) {
        return current;
      }
      return {
        ...current,
        [windowId]: update(state),
      };
    });
  }

  async function loadEditorTabContent(
    windowId: string,
    tabId: string,
    path: string
  ) {
    try {
      const content = await readTextFile(path);
      updateEditorWindowState(windowId, (state) => ({
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.tabId === tabId
            ? {
                ...tab,
                content,
                savedContent: content,
                isLoading: false,
                errorMessage: null,
              }
            : tab
        ),
      }));
    } catch (error) {
      updateEditorWindowState(windowId, (state) => ({
        ...state,
        tabs: state.tabs.map((tab) =>
          tab.tabId === tabId
            ? {
                ...tab,
                content: "",
                savedContent: "",
                isLoading: false,
                errorMessage:
                  error instanceof Error ? error.message : "Unable to open file",
              }
            : tab
        ),
      }));
    }
  }

  async function openEditor(path: string | null) {
    const latestEditorWindow = getLatestWindowByKind("editor");
    const targetWindowId = latestEditorWindow?.id ?? createEditorWindow();
    if (latestEditorWindow) {
      focusWindow(targetWindowId);
    }

    if (!path) {
      const scratchTab = createScratchEditorTab();
      updateEditorWindowState(targetWindowId, (state) => {
        const replaceScratch =
          state.tabs.length === 1 &&
          state.tabs[0]?.path === null &&
          state.tabs[0]?.content === "" &&
          state.tabs[0]?.savedContent === "";
        return {
          ...state,
          tabs: replaceScratch ? [scratchTab] : [...state.tabs, scratchTab],
          activeTabId: scratchTab.tabId,
        };
      });
      return;
    }

    const existingTab = editorWindowsRef.current[targetWindowId]?.tabs.find(
      (tab) => tab.path === path
    );
    if (existingTab) {
      updateEditorWindowState(targetWindowId, (state) => ({
        ...state,
        activeTabId: existingTab.tabId,
      }));
      return;
    }

    const loadingTab: DesktopEditorTabState = {
      tabId: createLocalId(),
      path,
      name: path.split("/").pop() || path,
      mimeType: null,
      content: "",
      savedContent: "",
      isLoading: true,
      isSaving: false,
      errorMessage: null,
      lastSavedAt: null,
    };

    updateEditorWindowState(targetWindowId, (state) => {
      const replaceScratch =
        state.tabs.length === 1 &&
        state.tabs[0]?.path === null &&
        state.tabs[0]?.content === "" &&
        state.tabs[0]?.savedContent === "";
      return {
        ...state,
        tabs: replaceScratch ? [loadingTab] : [...state.tabs, loadingTab],
        activeTabId: loadingTab.tabId,
      };
    });
    await loadEditorTabContent(targetWindowId, loadingTab.tabId, path);
  }

  async function openTerminalTab(windowId: string, title?: string) {
    const session = await createTerminalSession();
    let attached = false;

    updateTerminalWindowState(windowId, (state) => {
      const existingTabs = state.layout?.tabs ?? [];
      const newTab = createTabFromSession(session.id, existingTabs, title);
      attached = true;
      return {
        ...state,
        isInitializing: false,
        layout: {
          tabs: [...existingTabs, newTab],
          activeTabId: newTab.tabId,
        },
      };
    });

    if (!attached) {
      await closeTerminalSession(session.id);
    }
  }

  async function openTerminal() {
    const nextWindow = createWindowBase(
      "terminal",
      "Terminal",
      "#82f4b2",
      windowsRef.current.length
    );
    setWindows((current) => [...current, nextWindow]);
    setTerminalWindows((current) => ({
      ...current,
      [nextWindow.id]: {
        layout: null,
        isInitializing: true,
      },
    }));

    try {
      await openTerminalTab(nextWindow.id);
    } catch (error) {
      updateTerminalWindowState(nextWindow.id, (state) => ({
        ...state,
        isInitializing: false,
      }));
      setNotice(
        error instanceof Error ? error.message : "Unable to open terminal tab"
      );
    }
  }

  async function openPreview(entry: FileEntry) {
    const existing = windows.find(
      (window) => window.kind === "preview" && previewWindows[window.id]?.entry.path === entry.path
    );
    if (existing) {
      focusWindow(existing.id);
      return;
    }

    const nextWindow = createWindowBase(
      "preview",
      entry.name,
      "#9ad6ff",
      windows.length
    );
    setWindows((current) => [...current, nextWindow]);
    setPreviewWindows((current) => ({
      ...current,
      [nextWindow.id]: {
        entry,
        fileText: isTextLike(entry) ? null : null,
      },
    }));

    if (isTextLike(entry)) {
      try {
        const content = await readTextFile(entry.path);
        setPreviewWindows((current) => ({
          ...current,
          [nextWindow.id]: {
            entry,
            fileText: content,
          },
        }));
      } catch (error) {
        setPreviewWindows((current) => ({
          ...current,
          [nextWindow.id]: {
            entry,
            fileText:
              error instanceof Error ? error.message : "Unable to render preview",
          },
        }));
      }
    }
  }

  async function openEntry(entry: FileEntry) {
    if (entry.isDirectory) {
      await navigateFiles(entry.path);
      return;
    }

    if (isTextLike(entry)) {
      await openEditor(entry.path);
      return;
    }

    await openPreview(entry);
  }

  async function loadConversation(conversationId: string) {
    const conversation = await getConversation(conversationId);
    setActiveConversation(conversation);
  }

  async function syncNeuraState() {
    const [index, config] = await Promise.all([
      listConversations(),
      fetchNeuraConfig(),
    ]);
    setConversations(index.conversations);
    setNeuraConfig(config);
  }

  async function closeTerminalTab(windowId: string, tabId: string) {
    const tab = terminalWindowsRef.current[windowId]?.layout?.tabs.find(
      (candidate) => candidate.tabId === tabId
    );
    if (!tab) {
      return;
    }

    await Promise.allSettled(
      tab.panes.map((pane) => closeTerminalSession(pane.sessionId))
    );

    updateTerminalWindowState(windowId, (state) => {
      const layout = state.layout;
      if (!layout) {
        return state;
      }
      const remainingTabs = layout.tabs.filter((candidate) => candidate.tabId !== tabId);
      const nextActiveTabId =
        layout.activeTabId === tabId
          ? remainingTabs[
              Math.max(0, layout.tabs.findIndex((candidate) => candidate.tabId === tabId) - 1)
            ]?.tabId ?? remainingTabs[0]?.tabId ?? ""
          : layout.activeTabId;

      return {
        ...state,
        layout: {
          tabs: remainingTabs,
          activeTabId: nextActiveTabId,
        },
      };
    });
  }

  async function closeTerminalPane(
    windowId: string,
    tabId: string,
    paneId: string
  ) {
    const tab = terminalWindowsRef.current[windowId]?.layout?.tabs.find(
      (candidate) => candidate.tabId === tabId
    );
    if (!tab) {
      return;
    }

    if (tab.panes.length <= 1) {
      await closeTerminalTab(windowId, tabId);
      return;
    }

    const pane = tab.panes.find((candidate) => candidate.paneId === paneId);
    if (!pane) {
      return;
    }

    await closeTerminalSession(pane.sessionId);
    updateTerminalWindowState(windowId, (state) => {
      const layout = state.layout;
      if (!layout) {
        return state;
      }

      return {
        ...state,
        layout: {
          ...layout,
          tabs: layout.tabs.map((candidate) => {
            if (candidate.tabId !== tabId) {
              return candidate;
            }
            const remainingPanes = candidate.panes.filter((item) => item.paneId !== paneId);
            const nextActivePaneId =
              candidate.activePaneId === paneId
                ? remainingPanes[0]?.paneId ?? ""
                : candidate.activePaneId;
            return {
              ...candidate,
              panes: remainingPanes,
              activePaneId: nextActivePaneId,
              splitMode: remainingPanes.length > 1 ? candidate.splitMode : "none",
            };
          }),
        },
      };
    });
  }

  async function splitTerminalTab(
    windowId: string,
    tabId: string,
    direction: "horizontal" | "vertical"
  ) {
    const tab = terminalWindowsRef.current[windowId]?.layout?.tabs.find(
      (candidate) => candidate.tabId === tabId
    );
    if (!tab || tab.panes.length !== 1) {
      return;
    }

    const session = await createTerminalSession();
    const newPane: TerminalPaneState = {
      paneId: createLocalId(),
      sessionId: session.id,
    };

    updateTerminalWindowState(windowId, (state) => {
      const layout = state.layout;
      if (!layout) {
        return state;
      }
      return {
        ...state,
        layout: {
          ...layout,
          tabs: layout.tabs.map((candidate) =>
            candidate.tabId === tabId
              ? {
                  ...candidate,
                  splitMode: direction,
                  panes: [...candidate.panes, newPane],
                  activePaneId: newPane.paneId,
                }
              : candidate
          ),
        },
      };
    });
  }

  async function duplicateTerminalTab(windowId: string, tabId: string) {
    const tab = terminalWindowsRef.current[windowId]?.layout?.tabs.find(
      (candidate) => candidate.tabId === tabId
    );
    if (!tab) {
      return;
    }

    await openTerminalTab(windowId, `${tab.title} Copy`);
  }

  function renameTerminalTab(windowId: string, tabId: string) {
    const tab = terminalWindowsRef.current[windowId]?.layout?.tabs.find(
      (candidate) => candidate.tabId === tabId
    );
    if (!tab) {
      return;
    }

    const nextTitle = window.prompt("Rename terminal tab", tab.title)?.trim();
    if (!nextTitle) {
      return;
    }

    updateTerminalWindowState(windowId, (state) => {
      const layout = state.layout;
      if (!layout) {
        return state;
      }
      return {
        ...state,
        layout: {
          ...layout,
          tabs: layout.tabs.map((candidate) =>
            candidate.tabId === tabId ? { ...candidate, title: nextTitle } : candidate
          ),
        },
      };
    });
  }

  function closeEditorTab(windowId: string, tabId: string) {
    updateEditorWindowState(windowId, (state) => {
      const remainingTabs = state.tabs.filter((tab) => tab.tabId !== tabId);
      if (remainingTabs.length === 0) {
        const scratchTab = createScratchEditorTab();
        return {
          ...state,
          tabs: [scratchTab],
          activeTabId: scratchTab.tabId,
        };
      }

      const nextActiveTabId =
        state.activeTabId === tabId
          ? remainingTabs[
              Math.max(0, state.tabs.findIndex((tab) => tab.tabId === tabId) - 1)
            ]?.tabId ?? remainingTabs[0].tabId
          : state.activeTabId;
      return {
        ...state,
        tabs: remainingTabs,
        activeTabId: nextActiveTabId,
      };
    });
  }

  function createScratchTab(windowId: string) {
    const scratchTab = createScratchEditorTab();
    updateEditorWindowState(windowId, (state) => ({
      ...state,
      tabs: [...state.tabs, scratchTab],
      activeTabId: scratchTab.tabId,
    }));
  }

  async function saveEditorTab(windowId: string, tabId: string) {
    const tab = editorWindowsRef.current[windowId]?.tabs.find(
      (candidate) => candidate.tabId === tabId
    );
    if (!tab?.path) {
      return;
    }

    updateEditorWindowState(windowId, (state) => ({
      ...state,
      tabs: state.tabs.map((candidate) =>
        candidate.tabId === tabId
          ? { ...candidate, isSaving: true, errorMessage: null }
          : candidate
      ),
    }));

    try {
      await saveTextFile(tab.path, tab.content);
      updateEditorWindowState(windowId, (state) => ({
        ...state,
        tabs: state.tabs.map((candidate) =>
          candidate.tabId === tabId
            ? {
                ...candidate,
                savedContent: candidate.content,
                isSaving: false,
                errorMessage: null,
                lastSavedAt: Date.now(),
              }
            : candidate
        ),
      }));
      await refreshListing();
      setNotice("File saved.");
    } catch (error) {
      updateEditorWindowState(windowId, (state) => ({
        ...state,
        tabs: state.tabs.map((candidate) =>
          candidate.tabId === tabId
            ? {
                ...candidate,
                isSaving: false,
                errorMessage:
                  error instanceof Error ? error.message : "Unable to save file",
              }
            : candidate
        ),
      }));
      throw error;
    }
  }

  async function saveEditorTabAs(
    windowId: string,
    tabId: string,
    nextPath: string
  ) {
    const trimmedPath = nextPath.trim().replace(/^\/+/, "");
    if (!trimmedPath) {
      throw new Error("File name cannot be empty.");
    }

    updateEditorWindowState(windowId, (state) => ({
      ...state,
      tabs: state.tabs.map((candidate) =>
        candidate.tabId === tabId
          ? { ...candidate, isSaving: true, errorMessage: null }
          : candidate
      ),
    }));

    try {
      const tab = editorWindowsRef.current[windowId]?.tabs.find(
        (candidate) => candidate.tabId === tabId
      );
      if (!tab) {
        throw new Error("Unable to find editor tab");
      }

      await saveTextFile(trimmedPath, tab.content);
      updateEditorWindowState(windowId, (state) => ({
        ...state,
        tabs: state.tabs.map((candidate) =>
          candidate.tabId === tabId
            ? {
                ...candidate,
                path: trimmedPath,
                name: trimmedPath.split("/").pop() || trimmedPath,
                savedContent: candidate.content,
                isSaving: false,
                errorMessage: null,
                lastSavedAt: Date.now(),
              }
            : candidate
        ),
      }));
      await refreshListing();
      setNotice("File saved.");
    } catch (error) {
      updateEditorWindowState(windowId, (state) => ({
        ...state,
        tabs: state.tabs.map((candidate) =>
          candidate.tabId === tabId
            ? {
                ...candidate,
                isSaving: false,
                errorMessage:
                  error instanceof Error ? error.message : "Unable to save file",
              }
            : candidate
        ),
      }));
      throw error;
    }
  }

  async function reloadEditorTab(windowId: string, tabId: string) {
    const tab = editorWindowsRef.current[windowId]?.tabs.find(
      (candidate) => candidate.tabId === tabId
    );
    if (!tab?.path) {
      return;
    }

    updateEditorWindowState(windowId, (state) => ({
      ...state,
      tabs: state.tabs.map((candidate) =>
        candidate.tabId === tabId
          ? { ...candidate, isLoading: true, errorMessage: null }
          : candidate
      ),
    }));
    await loadEditorTabContent(windowId, tabId, tab.path);
  }

  async function closeWindow(windowId: string) {
    const target = windowsRef.current.find((window) => window.id === windowId);
    if (!target) {
      return;
    }

    if (target.kind === "editor") {
      const hasDirtyTabs =
        editorWindowsRef.current[windowId]?.tabs.some(
          (tab) => tab.content !== tab.savedContent
        ) ?? false;
      if (hasDirtyTabs) {
        const shouldClose = window.confirm(
          "Close this editor window and discard unsaved changes?"
        );
        if (!shouldClose) {
          return;
        }
      }
    }

    if (target.kind === "terminal") {
      const sessionIds = getSessionIdsFromLayout(
        terminalWindowsRef.current[windowId]?.layout ?? null
      );
      await Promise.allSettled(sessionIds.map((sessionId) => closeTerminalSession(sessionId)));
    }

    setTerminalWindows((current) => {
      if (!(windowId in current)) {
        return current;
      }
      const next = { ...current };
      delete next[windowId];
      return next;
    });

    setEditorWindows((current) => {
      if (!(windowId in current)) {
        return current;
      }
      const next = { ...current };
      delete next[windowId];
      return next;
    });

    setPreviewWindows((current) => {
      if (!(windowId in current)) {
        return current;
      }
      const next = { ...current };
      delete next[windowId];
      return next;
    });

    setWindows((current) => current.filter((window) => window.id !== windowId));
  }

  return (
    <div className="nl-shell">
      <div className="nl-desktop" style={{ backgroundImage: backgroundStyle }}>
        <header className="nl-topbar">
          <div className="nl-topbar__brand">
            <img
              src="/brand/alshival-brain-256.png"
              alt="Alshival.Ai"
              className="nl-topbar__brand-logo"
            />
            <h1>Neural Labs</h1>
          </div>

          <div className="nl-topbar__actions">
            <div ref={avatarMenuRef} className="nl-topbar__avatar-menu">
              <button
                type="button"
                className="nl-topbar__avatar-button"
                aria-haspopup="menu"
                aria-expanded={avatarMenuOpen}
                onClick={() => setAvatarMenuOpen((current) => !current)}
              >
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={currentViewer.email}
                    className="nl-topbar__avatar-image"
                  />
                ) : (
                  <span className="nl-topbar__avatar-fallback">
                    {getViewerInitials(currentViewer.email)}
                  </span>
                )}
              </button>

              {avatarMenuOpen ? (
                <div className="nl-topbar__dropdown" role="menu">
                  <div className="nl-topbar__dropdown-header">
                    <strong>{currentViewer.email}</strong>
                    <span>{currentViewer.role}</span>
                  </div>
                  <button
                    type="button"
                    className="nl-topbar__dropdown-item"
                    onClick={() => {
                      setAvatarMenuOpen(false);
                      void (async () => {
                        await logoutRequest();
                        window.location.href = "/login";
                      })();
                    }}
                  >
                    Sign out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main ref={workspaceRef} className="nl-workspace">
          {windows.map((window) => {
            const active = window.zIndex === Math.max(...windows.map((entry) => entry.zIndex));

            return (
              <DesktopWindowFrame
                key={window.id}
                windowState={window}
                workspaceBounds={workspaceBounds}
                active={active}
                accent={window.accent}
                onFocus={() => focusWindow(window.id)}
                onMove={(position) => updateWindowPosition(window.id, position)}
                onResize={(bounds) => updateWindowBounds(window.id, bounds)}
                onSnap={(zone) => applyWindowSnap(window.id, zone)}
                onClose={() => void closeWindow(window.id)}
                onMinimize={() =>
                  setWindows((current) =>
                    current.map((entry) =>
                      entry.id === window.id ? { ...entry, minimized: true } : entry
                    )
                  )
                }
                onToggleMaximize={() => toggleWindowMaximize(window.id)}
              >
                {window.kind === "files" ? (
                  <FileExplorerPanel
                    listing={listing}
                    isLoading={listing === null}
                    canGoBack={fileBackHistory.length > 0}
                    canGoForward={fileForwardHistory.length > 0}
                    canGoUp={Boolean(listing?.path)}
                    canPreviewEntry={(entry) => isPreviewable(entry)}
                    canOpenInTextEditor={(entry) => isTextLike(entry)}
                    onNavigate={(path) => void navigateFiles(path)}
                    onNavigateBack={() => void navigateBack()}
                    onNavigateForward={() => void navigateForward()}
                    onNavigateUp={() => void navigateUp()}
                    onOpenEntry={(entry) => void openEntry(entry)}
                    onPreviewEntry={(entry) => void openPreview(entry)}
                    onOpenInTextEditor={(entry) => void openEditor(entry.path)}
                    onDownloadEntry={(entry) => {
                      const link = document.createElement("a");
                      link.href = getFileUrl(entry.path);
                      link.download = entry.name;
                      link.rel = "noopener";
                      document.body.appendChild(link);
                      link.click();
                      link.remove();
                    }}
                    onRefresh={() => void refreshListing()}
                    onCreateDirectory={async (name) => {
                      await createDirectory(listing?.path ?? "", name);
                      await refreshListing();
                    }}
                    onUpload={async (files, destinationPath) => {
                      for (const file of Array.from(files)) {
                        await uploadFile(destinationPath, file);
                      }
                      await refreshListing(destinationPath);
                    }}
                    onRename={async (entry, name) => {
                      await renamePath(entry.path, name);
                      await refreshListing();
                    }}
                    onMove={async (entry, destination) => {
                      await movePath(entry.path, destination);
                      await refreshListing(destination);
                    }}
                    onDelete={async (entry) => {
                      await deletePath(entry.path);
                      await refreshListing();
                    }}
                    onSetAsBackground={async (entry) => {
                      const result = await setDesktopBackgroundFromFile(entry.path);
                      await applyDesktopBackground(`custom:${result.path}`, result.path);
                      await refreshListing(listing?.path ?? "");
                      setNotice("Desktop background updated.");
                    }}
                  />
                ) : null}

                {window.kind === "editor" ? (
                  <TextEditorPanel
                    windowState={
                      editorWindows[window.id] ?? createDefaultEditorWindowState()
                    }
                    currentDirectory={listing?.path ?? ""}
                    onToggleSidebar={() =>
                      updateEditorWindowState(window.id, (state) => ({
                        ...state,
                        isSidebarOpen: !state.isSidebarOpen,
                      }))
                    }
                    onCreateScratchTab={() => createScratchTab(window.id)}
                    onSetActiveTab={(tabId) =>
                      updateEditorWindowState(window.id, (state) => ({
                        ...state,
                        activeTabId: tabId,
                      }))
                    }
                    onCloseTab={(tabId) => closeEditorTab(window.id, tabId)}
                    onChangeTabContent={(tabId, content) =>
                      updateEditorWindowState(window.id, (state) => ({
                        ...state,
                        tabs: state.tabs.map((tab) =>
                          tab.tabId === tabId ? { ...tab, content, errorMessage: null } : tab
                        ),
                      }))
                    }
                    onSaveTab={(tabId) => saveEditorTab(window.id, tabId)}
                    onSaveTabAs={(tabId, path) => saveEditorTabAs(window.id, tabId, path)}
                    onReloadTab={(tabId) => reloadEditorTab(window.id, tabId)}
                  />
                ) : null}

                {window.kind === "terminal" && terminalWindows[window.id] ? (
                  <TerminalPanel
                    layout={terminalWindows[window.id].layout}
                    isInitializing={terminalWindows[window.id].isInitializing}
                    onAddTab={() => openTerminalTab(window.id)}
                    onSetActiveTab={(tabId) =>
                      updateTerminalWindowState(window.id, (state) => ({
                        ...state,
                        layout: state.layout
                          ? {
                              ...state.layout,
                              activeTabId: tabId,
                            }
                          : null,
                      }))
                    }
                    onSetActivePane={(tabId, paneId) =>
                      updateTerminalWindowState(window.id, (state) => ({
                        ...state,
                        layout: state.layout
                          ? {
                              ...state.layout,
                              tabs: state.layout.tabs.map((tab) =>
                                tab.tabId === tabId
                                  ? { ...tab, activePaneId: paneId }
                                  : tab
                              ),
                            }
                          : null,
                      }))
                    }
                    onCloseTab={(tabId) => closeTerminalTab(window.id, tabId)}
                    onClosePane={(tabId, paneId) =>
                      closeTerminalPane(window.id, tabId, paneId)
                    }
                    onSplitTab={(tabId, direction) =>
                      splitTerminalTab(window.id, tabId, direction)
                    }
                    onDuplicateTab={(tabId) => duplicateTerminalTab(window.id, tabId)}
                    onRenameTab={(tabId) => renameTerminalTab(window.id, tabId)}
                    onReorderTabs={(tabs) =>
                      updateTerminalWindowState(window.id, (state) => ({
                        ...state,
                        layout: state.layout
                          ? {
                              ...state.layout,
                              tabs,
                              activeTabId: tabs.some(
                                (tab) => tab.tabId === state.layout?.activeTabId
                              )
                                ? state.layout.activeTabId
                                : tabs[0]?.tabId ?? "",
                            }
                          : null,
                      }))
                    }
                    onRecoverPaneSession={(tabId, paneId, sessionId) =>
                      updateTerminalWindowState(window.id, (state) => ({
                        ...state,
                        layout: state.layout
                          ? {
                              ...state.layout,
                              tabs: state.layout.tabs.map((tab) =>
                                tab.tabId !== tabId
                                  ? tab
                                  : {
                                      ...tab,
                                      panes: tab.panes.map((pane) =>
                                        pane.paneId === paneId
                                          ? { ...pane, sessionId }
                                          : pane
                                      ),
                                    }
                              ),
                            }
                          : null,
                      }))
                    }
                  />
                ) : null}

                {window.kind === "preview" && previewWindows[window.id] ? (
                  <PreviewPanel
                    entry={previewWindows[window.id].entry}
                    fileUrl={getFileUrl(previewWindows[window.id].entry.path)}
                    fileText={previewWindows[window.id].fileText}
                  />
                ) : null}

                {window.kind === "neura" ? (
                  <NeuraPanel
                    conversations={conversations}
                    activeConversation={activeConversation}
                    assistantName={neuraConfig?.assistantName ?? "Neura"}
                    defaultModel={neuraConfig?.defaultModel ?? "No default model"}
                    defaultProviderName={neuraConfig?.defaultProviderName ?? null}
                    onCreateConversation={async () => {
                      const conversation = await createConversationRequest();
                      await syncNeuraState();
                      setActiveConversation(conversation);
                    }}
                    onSelectConversation={async (id) => {
                      await loadConversation(id);
                    }}
                    onDeleteConversation={async (id) => {
                      await deleteConversation(id);
                      await syncNeuraState();
                      setActiveConversation(null);
                    }}
                    onSendMessage={async (content) => {
                      if (!activeConversation) {
                        return;
                      }
                      const updated = await sendMessage(activeConversation.summary.id, content);
                      setActiveConversation(updated);
                      await syncNeuraState();
                    }}
                  />
                ) : null}

                {window.kind === "settings" ? (
                  <SettingsPanel
                    viewer={currentViewer}
                    avatarUrl={avatarUrl}
                    snapshot={settings}
                    customBackgroundUrl={
                      settings?.desktop.customBackgroundPath
                        ? getFileUrl(settings.desktop.customBackgroundPath)
                        : null
                    }
                    onSaveDesktopSettings={async (payload) => {
                      await saveDesktopSettings(payload);
                      setSettings(await fetchSettings());
                    }}
                    onUploadCustomBackground={async (file) => {
                      if (!file.type.startsWith("image/")) {
                        throw new Error("Choose an image file for the desktop background");
                      }
                      const uploadName = getCustomBackgroundFileName(file);
                      const upload = await uploadFile(
                        CUSTOM_BACKGROUND_DIRECTORY,
                        new File([file], uploadName, {
                          type: file.type || undefined,
                        })
                      );
                      await applyDesktopBackground(`custom:${upload.path}`, upload.path);
                      await refreshListing(listing?.path ?? "");
                      setNotice("Custom background uploaded.");
                    }}
                    onSelectCustomBackground={async () => {
                      const customPath = settings?.desktop.customBackgroundPath;
                      if (!customPath) {
                        throw new Error("Upload a custom background first");
                      }
                      await applyDesktopBackground(`custom:${customPath}`, customPath);
                    }}
                    onDeleteCustomBackground={async () => {
                      const customPath = settings?.desktop.customBackgroundPath;
                      if (!customPath) {
                        return;
                      }
                      await deletePath(customPath);
                      await saveDesktopSettings({
                        backgroundId: "sunrise-grid",
                        customBackgroundPath: null,
                      });
                      setSettings(await fetchSettings());
                      await refreshListing(listing?.path ?? "");
                      setNotice("Custom background deleted.");
                    }}
                    onCreateProvider={async (draft) => {
                      await createProvider(draft);
                      setSettings(await fetchSettings());
                      await syncNeuraState();
                    }}
                    onUpdateProvider={async (providerId, draft) => {
                      await updateProvider(providerId, draft);
                      setSettings(await fetchSettings());
                      await syncNeuraState();
                    }}
                    onDeleteProvider={async (providerId) => {
                      await removeProvider(providerId);
                      setSettings(await fetchSettings());
                      await syncNeuraState();
                    }}
                    onMakeDefault={async (providerId) => {
                      await updateProvider(providerId, { makeDefault: true });
                      setSettings(await fetchSettings());
                      await syncNeuraState();
                    }}
                    onTestProvider={async (providerId) => {
                      const result = await testProvider(providerId);
                      return result.message;
                    }}
                    onUploadAvatar={async (file) => {
                      if (!file.type.startsWith("image/")) {
                        throw new Error("Choose an image file for the avatar");
                      }
                      const previousAvatarPath = currentViewer.avatarPath;
                      const upload = await uploadFile(
                        USER_AVATAR_DIRECTORY,
                        new File([file], getAvatarFileName(file), {
                          type: file.type || undefined,
                        })
                      );
                      const result = await updateProfile({ avatarPath: upload.path });
                      setCurrentViewer(result.viewer);
                      if (
                        previousAvatarPath &&
                        previousAvatarPath !== upload.path
                      ) {
                        await deletePath(previousAvatarPath).catch(() => undefined);
                      }
                      await refreshListing(listing?.path ?? "");
                      setNotice("Avatar updated.");
                    }}
                    onRemoveAvatar={async () => {
                      const avatarPath = currentViewer.avatarPath;
                      if (!avatarPath) {
                        return;
                      }
                      const result = await updateProfile({ avatarPath: null });
                      setCurrentViewer(result.viewer);
                      await deletePath(avatarPath).catch(() => undefined);
                      await refreshListing(listing?.path ?? "");
                      setNotice("Avatar removed.");
                    }}
                  />
                ) : null}
              </DesktopWindowFrame>
            );
          })}
        </main>

        <nav className="nl-dock">
          {DOCK_APPS.map((app) => {
            const Icon = "icon" in app ? app.icon : null;
            const activeWindow =
              app.kind === "vscode"
                ? null
                : windows.find((window) => window.kind === app.kind);

            return (
              <button
                key={app.kind}
                type="button"
                className={cn(
                  "nl-dock__button",
                  activeWindow && "nl-dock__button--active"
                )}
                title={app.label}
                onClick={() => {
                  if (app.kind === "files") {
                    if (!focusOrRestoreLatestWindow("files")) {
                      openOrFocusSingleton("files", "Files", app.accent);
                    }
                    return;
                  }
                  if (app.kind === "neura") {
                    if (!focusOrRestoreLatestWindow("neura")) {
                      openOrFocusSingleton("neura", "Neura", app.accent);
                    }
                    return;
                  }
                  if (app.kind === "settings") {
                    if (!focusOrRestoreLatestWindow("settings")) {
                      openOrFocusSingleton("settings", "Desktop Settings", app.accent);
                    }
                    return;
                  }
                  if (app.kind === "editor") {
                    if (!focusOrRestoreLatestWindow("editor")) {
                      void openEditor(null);
                    }
                    return;
                  }
                  if (app.kind === "terminal") {
                    if (!focusOrRestoreLatestWindow("terminal")) {
                      void openTerminal();
                    }
                    return;
                  }
                  if (app.kind === "vscode") {
                    window.open("/vscode/", "_blank", "noopener,noreferrer");
                  }
                }}
              >
                {Icon ? (
                  <Icon className="nl-dock__icon" />
                ) : "iconSrc" in app ? (
                  <img className="nl-dock__image" src={app.iconSrc} alt="" />
                ) : null}
                <span>{app.label}</span>
              </button>
            );
          })}
        </nav>

      </div>

      {notice ? <div className="nl-toast">{notice}</div> : null}
    </div>
  );
}
