"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
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
  readTextFile,
  removeProvider,
  renamePath,
  saveDesktopSettings,
  saveTextFile,
  sendMessage,
  testProvider,
  updateProvider,
  uploadFile,
  movePath,
  closeTerminalSession,
} from "@/lib/client/api";
import { BACKGROUND_PRESETS } from "@/lib/shared/providers";
import type {
  ConversationRecord,
  ConversationSummary,
  DirectoryListing,
  FileEntry,
  NeuraConfig,
  ProviderDraft,
  SettingsSnapshot,
} from "@/lib/shared/types";
import { DesktopWindowFrame, type WindowFrameState } from "@/components/desktop/window";
import {
  DOCK_APPS,
  FileExplorerPanel,
  NeuraPanel,
  PreviewPanel,
  SettingsPanel,
  TerminalPanel,
  TextEditorPanel,
} from "@/components/desktop/panels";
import {
  FileIcon,
  FolderIcon,
  SettingsIcon,
  SparkIcon,
  TerminalIcon,
} from "@/components/ui/icons";
import { Badge, Button, cn } from "@/components/ui/primitives";

type AppKind = "files" | "editor" | "terminal" | "neura" | "settings" | "preview";

interface WorkspaceWindow extends WindowFrameState {
  kind: AppKind;
  accent: string;
}

interface EditorWindowState {
  path: string | null;
  content: string;
  dirty: boolean;
  loading: boolean;
  error: string | null;
}

interface TerminalWindowState {
  sessionId: string;
}

interface PreviewWindowState {
  entry: FileEntry;
  fileText: string | null;
}

const SINGLETON_KINDS = new Set<AppKind>(["files", "neura", "settings"]);

function isTextLike(entry: FileEntry): boolean {
  return (
    entry.mimeType.startsWith("text/") ||
    entry.mimeType.includes("json") ||
    entry.mimeType.includes("javascript")
  );
}

function createWindowBase(
  kind: AppKind,
  title: string,
  accent: string,
  positionIndex: number
): WorkspaceWindow {
  const sizeByKind: Record<AppKind, { width: number; height: number }> = {
    files: { width: 960, height: 620 },
    editor: { width: 900, height: 640 },
    terminal: { width: 840, height: 560 },
    neura: { width: 980, height: 660 },
    settings: { width: 920, height: 680 },
    preview: { width: 820, height: 620 },
  };
  const size = sizeByKind[kind];
  return {
    id: crypto.randomUUID(),
    kind,
    title,
    accent,
    x: 72 + positionIndex * 28,
    y: 72 + positionIndex * 22,
    width: size.width,
    height: size.height,
    minimized: false,
    zIndex: 10 + positionIndex,
  };
}

export function NeuralLabsWorkspace() {
  const [settings, setSettings] = useState<SettingsSnapshot | null>(null);
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [windows, setWindows] = useState<WorkspaceWindow[]>([]);
  const [editorWindows, setEditorWindows] = useState<Record<string, EditorWindowState>>({});
  const [terminalWindows, setTerminalWindows] = useState<Record<string, TerminalWindowState>>({});
  const [previewWindows, setPreviewWindows] = useState<Record<string, PreviewWindowState>>({});
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversation, setActiveConversation] = useState<ConversationRecord | null>(null);
  const [neuraConfig, setNeuraConfig] = useState<NeuraConfig | null>(null);
  const [notice, setNotice] = useState<string>("");
  const zCounter = useRef(30);

  const backgroundStyle = useMemo(() => {
    const preset =
      BACKGROUND_PRESETS.find((entry) => entry.id === settings?.desktop.backgroundId) ??
      BACKGROUND_PRESETS[0];
    return preset.className;
  }, [settings?.desktop.backgroundId]);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const [nextSettings, nextListing, config, conversationIndex] = await Promise.all([
          fetchSettings(),
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

        const initialWindows = [
          createWindowBase("files", "Files", "#63a8ff", 0),
          createWindowBase("neura", "Neura", "#f1c75b", 1),
        ];
        setWindows(initialWindows);

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
    const theme = settings?.desktop.theme ?? "dark";
    const resolvedTheme =
      theme === "system"
        ? window.matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark"
        : theme;
    document.documentElement.dataset.theme = resolvedTheme;
  }, [settings?.desktop.theme]);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timeoutId = window.setTimeout(() => setNotice(""), 3200);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

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
        window.id === windowId ? { ...window, ...position } : window
      )
    );
  }

  async function refreshListing(targetPath = listing?.path ?? "") {
    setListing(await listFiles(targetPath));
  }

  function openOrFocusSingleton(kind: AppKind, title: string, accent: string) {
    const existing = windows.find((window) => window.kind === kind);
    if (existing) {
      focusWindow(existing.id);
      return existing.id;
    }
    const nextWindow = createWindowBase(kind, title, accent, windows.length);
    setWindows((current) => [...current, nextWindow]);
    return nextWindow.id;
  }

  async function openEditor(path: string | null, title?: string) {
    const existing = windows.find(
      (window) => window.kind === "editor" && editorWindows[window.id]?.path === path
    );
    if (existing) {
      focusWindow(existing.id);
      return;
    }

    const nextWindow = createWindowBase(
      "editor",
      title || (path ? path.split("/").pop() || path : "Scratch Pad"),
      "#ff9b5d",
      windows.length
    );
    setWindows((current) => [...current, nextWindow]);
    setEditorWindows((current) => ({
      ...current,
      [nextWindow.id]: {
        path,
        content: "",
        dirty: false,
        loading: Boolean(path),
        error: null,
      },
    }));

    if (path) {
      try {
        const content = await readTextFile(path);
        setEditorWindows((current) => ({
          ...current,
          [nextWindow.id]: {
            path,
            content,
            dirty: false,
            loading: false,
            error: null,
          },
        }));
      } catch (error) {
        setEditorWindows((current) => ({
          ...current,
          [nextWindow.id]: {
            path,
            content: "",
            dirty: false,
            loading: false,
            error: error instanceof Error ? error.message : "Unable to open file",
          },
        }));
      }
    } else {
      setEditorWindows((current) => ({
        ...current,
        [nextWindow.id]: {
          path: null,
          content: "# New note\n",
          dirty: true,
          loading: false,
          error: null,
        },
      }));
    }
  }

  async function openTerminal() {
    const session = await createTerminalSession();
    const nextWindow = createWindowBase(
      "terminal",
      `Terminal ${Object.keys(terminalWindows).length + 1}`,
      "#82f4b2",
      windows.length
    );
    setWindows((current) => [...current, nextWindow]);
    setTerminalWindows((current) => ({
      ...current,
      [nextWindow.id]: { sessionId: session.id },
    }));
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
      const nextListing = await listFiles(entry.path);
      setListing(nextListing);
      return;
    }

    if (isTextLike(entry)) {
      await openEditor(entry.path, entry.name);
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

  async function closeWindow(windowId: string) {
    const target = windows.find((window) => window.id === windowId);
    if (!target) {
      return;
    }

    if (target.kind === "terminal" && terminalWindows[windowId]?.sessionId) {
      await closeTerminalSession(terminalWindows[windowId].sessionId);
      setTerminalWindows((current) => {
        const next = { ...current };
        delete next[windowId];
        return next;
      });
    }

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

  async function saveEditor(windowId: string) {
    const state = editorWindows[windowId];
    if (!state) {
      return;
    }
    if (!state.path) {
      const nextPath = window.prompt("Save as", "notes/new-note.md");
      if (!nextPath) {
        return;
      }
      await saveEditorAs(windowId, nextPath);
      return;
    }

    setEditorWindows((current) => ({
      ...current,
      [windowId]: { ...current[windowId], loading: true, error: null },
    }));
    try {
      await saveTextFile(state.path, state.content);
      setEditorWindows((current) => ({
        ...current,
        [windowId]: { ...current[windowId], dirty: false, loading: false },
      }));
      await refreshListing();
      setNotice("File saved.");
    } catch (error) {
      setEditorWindows((current) => ({
        ...current,
        [windowId]: {
          ...current[windowId],
          loading: false,
          error: error instanceof Error ? error.message : "Unable to save file",
        },
      }));
    }
  }

  async function saveEditorAs(windowId: string, nextPath: string) {
    const state = editorWindows[windowId];
    if (!state) {
      return;
    }
    setEditorWindows((current) => ({
      ...current,
      [windowId]: { ...current[windowId], loading: true, error: null },
    }));

    try {
      await saveTextFile(nextPath, state.content);
      setEditorWindows((current) => ({
        ...current,
        [windowId]: {
          ...current[windowId],
          path: nextPath,
          dirty: false,
          loading: false,
        },
      }));
      setWindows((current) =>
        current.map((window) =>
          window.id === windowId
            ? { ...window, title: nextPath.split("/").pop() || nextPath }
            : window
        )
      );
      await refreshListing();
      setNotice("File saved.");
    } catch (error) {
      setEditorWindows((current) => ({
        ...current,
        [windowId]: {
          ...current[windowId],
          loading: false,
          error: error instanceof Error ? error.message : "Unable to save file",
        },
      }));
    }
  }

  return (
    <div className="nl-shell">
      <div className="nl-desktop" style={{ backgroundImage: backgroundStyle }}>
        <header className="nl-topbar">
          <div>
            <h1>Neural Labs</h1>
            <p>Standalone desktop workspace</p>
          </div>
          <div className="nl-topbar__status">
            {settings?.providers.find((provider) => provider.isDefault) ? (
              <Badge accent="success">
                Default Model: {settings.providers.find((provider) => provider.isDefault)?.model}
              </Badge>
            ) : (
              <Badge accent="warn">Configure a provider in Desktop Settings</Badge>
            )}
          </div>
        </header>

        <main className="nl-workspace">
          {windows.map((window) => {
            const active = window.zIndex === Math.max(...windows.map((entry) => entry.zIndex));

            return (
              <DesktopWindowFrame
                key={window.id}
                windowState={window}
                active={active}
                accent={window.accent}
                onFocus={() => focusWindow(window.id)}
                onMove={(position) => updateWindowPosition(window.id, position)}
                onClose={() => void closeWindow(window.id)}
                onMinimize={() =>
                  setWindows((current) =>
                    current.map((entry) =>
                      entry.id === window.id ? { ...entry, minimized: true } : entry
                    )
                  )
                }
              >
                {window.kind === "files" ? (
                  <FileExplorerPanel
                    listing={listing}
                    onNavigate={async (path) => setListing(await listFiles(path))}
                    onOpenEntry={(entry) => void openEntry(entry)}
                    onRefresh={() => void refreshListing()}
                    onCreateDirectory={async (name) => {
                      await createDirectory(listing?.path ?? "", name);
                      await refreshListing();
                    }}
                    onUpload={async (files) => {
                      for (const file of Array.from(files)) {
                        await uploadFile(listing?.path ?? "", file);
                      }
                      await refreshListing();
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
                  />
                ) : null}

                {window.kind === "editor" ? (
                  <TextEditorPanel
                    path={editorWindows[window.id]?.path ?? null}
                    content={editorWindows[window.id]?.content ?? ""}
                    dirty={editorWindows[window.id]?.dirty ?? false}
                    loading={editorWindows[window.id]?.loading ?? false}
                    error={editorWindows[window.id]?.error ?? null}
                    onChange={(content) =>
                      setEditorWindows((current) => ({
                        ...current,
                        [window.id]: {
                          ...current[window.id],
                          content,
                          dirty: true,
                        },
                      }))
                    }
                    onSave={() => saveEditor(window.id)}
                    onSaveAs={(path) => saveEditorAs(window.id, path)}
                  />
                ) : null}

                {window.kind === "terminal" && terminalWindows[window.id] ? (
                  <TerminalPanel
                    sessionId={terminalWindows[window.id].sessionId}
                    onCloseSession={async () => {
                      await closeTerminalSession(terminalWindows[window.id].sessionId);
                      await closeWindow(window.id);
                    }}
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
                    snapshot={settings}
                    onSaveDesktopSettings={async (payload) => {
                      await saveDesktopSettings(payload);
                      setSettings(await fetchSettings());
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
                  />
                ) : null}
              </DesktopWindowFrame>
            );
          })}
        </main>

        <nav className="nl-dock">
          {DOCK_APPS.map((app) => {
            const Icon = app.icon;
            const activeWindow = windows.find((window) => window.kind === app.kind);

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
                    openOrFocusSingleton("files", "Files", app.accent);
                    return;
                  }
                  if (app.kind === "neura") {
                    openOrFocusSingleton("neura", "Neura", app.accent);
                    return;
                  }
                  if (app.kind === "settings") {
                    openOrFocusSingleton("settings", "Desktop Settings", app.accent);
                    return;
                  }
                  if (app.kind === "editor") {
                    void openEditor(null, "Scratch Pad");
                    return;
                  }
                  if (app.kind === "terminal") {
                    void openTerminal();
                  }
                }}
              >
                <Icon className="nl-dock__icon" />
                <span>{app.label}</span>
              </button>
            );
          })}
        </nav>

        <aside className="nl-desktop-cards">
          <button
            type="button"
            className="nl-quick-app"
            onDoubleClick={() => openOrFocusSingleton("files", "Files", "#63a8ff")}
          >
            <FolderIcon className="nl-quick-app__icon" />
            <span>Workspace</span>
          </button>
          <button
            type="button"
            className="nl-quick-app"
            onDoubleClick={() => openOrFocusSingleton("neura", "Neura", "#f1c75b")}
          >
            <SparkIcon className="nl-quick-app__icon" />
            <span>Neura</span>
          </button>
          <button
            type="button"
            className="nl-quick-app"
            onDoubleClick={() => void openEditor(null, "Scratch Pad")}
          >
            <FileIcon className="nl-quick-app__icon" />
            <span>Scratch Pad</span>
          </button>
          <button
            type="button"
            className="nl-quick-app"
            onDoubleClick={() => void openTerminal()}
          >
            <TerminalIcon className="nl-quick-app__icon" />
            <span>Terminal</span>
          </button>
          <button
            type="button"
            className="nl-quick-app"
            onDoubleClick={() =>
              openOrFocusSingleton("settings", "Desktop Settings", "#e0d7ff")
            }
          >
            <SettingsIcon className="nl-quick-app__icon" />
            <span>Settings</span>
          </button>
        </aside>
      </div>

      {notice ? <div className="nl-toast">{notice}</div> : null}
    </div>
  );
}
