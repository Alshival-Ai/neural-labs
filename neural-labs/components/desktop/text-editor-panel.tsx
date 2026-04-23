"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { OnMount } from "@monaco-editor/react";
import { useTheme } from "next-themes";

import type {
  DesktopEditorTabState,
  DesktopEditorWindowState,
} from "@/components/desktop/app-types";
import {
  CloseIcon,
  FileIcon,
  PlusIcon,
  RefreshIcon,
  SidebarIcon,
  SparkIcon,
} from "@/components/ui/icons";
import { Button, cn, IconButton } from "@/components/ui/primitives";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
});

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  c: "c",
  cpp: "cpp",
  css: "css",
  go: "go",
  html: "html",
  java: "java",
  js: "javascript",
  json: "json",
  jsx: "javascript",
  md: "markdown",
  mjs: "javascript",
  py: "python",
  rs: "rust",
  sh: "shell",
  sql: "sql",
  ts: "typescript",
  tsx: "typescript",
  txt: "plaintext",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
};

const MIME_LANGUAGE_MAP: Record<string, string> = {
  "application/json": "json",
  "application/xml": "xml",
  "text/css": "css",
  "text/csv": "plaintext",
  "text/html": "html",
  "text/javascript": "javascript",
  "text/markdown": "markdown",
  "text/plain": "plaintext",
  "text/typescript": "typescript",
  "text/x-python": "python",
  "text/xml": "xml",
};

function getEditorLanguage(tab: DesktopEditorTabState | null): string {
  if (!tab) {
    return "plaintext";
  }

  const lowerName = tab.name.toLowerCase();
  const extension = lowerName.includes(".")
    ? lowerName.split(".").pop() ?? ""
    : "";
  if (extension && EXTENSION_LANGUAGE_MAP[extension]) {
    return EXTENSION_LANGUAGE_MAP[extension];
  }

  if (tab.mimeType && MIME_LANGUAGE_MAP[tab.mimeType]) {
    return MIME_LANGUAGE_MAP[tab.mimeType];
  }

  if (tab.mimeType?.startsWith("text/")) {
    return "plaintext";
  }

  return "plaintext";
}

function isTabDirty(tab: DesktopEditorTabState): boolean {
  return tab.content !== tab.savedContent;
}

function getTabPathLabel(tab: DesktopEditorTabState | null): string {
  if (!tab?.path) {
    return "Unsaved scratch file";
  }
  return `~/${tab.path}`;
}

interface EditorAction {
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  destructive?: boolean;
  run: () => void | Promise<void>;
}

export function TextEditorPanel({
  windowState,
  currentDirectory,
  onToggleSidebar,
  onCreateScratchTab,
  onSetActiveTab,
  onCloseTab,
  onChangeTabContent,
  onSaveTab,
  onSaveTabAs,
  onReloadTab,
}: {
  windowState: DesktopEditorWindowState;
  currentDirectory: string;
  onToggleSidebar: () => void;
  onCreateScratchTab: () => void;
  onSetActiveTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onChangeTabContent: (tabId: string, content: string) => void;
  onSaveTab: (tabId: string) => Promise<void> | void;
  onSaveTabAs: (tabId: string, targetPath: string) => Promise<void> | void;
  onReloadTab: (tabId: string) => Promise<void> | void;
}) {
  const { resolvedTheme } = useTheme();
  const editorRef = useRef<Parameters<NonNullable<OnMount>>[0] | null>(null);
  const actionsMenuRef = useRef<HTMLDivElement | null>(null);
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 });
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const [isSaveAsOpen, setIsSaveAsOpen] = useState(false);
  const [saveAsValue, setSaveAsValue] = useState("");
  const [saveAsError, setSaveAsError] = useState<string | null>(null);

  const activeTab =
    windowState.tabs.find((tab) => tab.tabId === windowState.activeTabId) ??
    windowState.tabs[0] ??
    null;
  const activeLanguage = getEditorLanguage(activeTab);

  useEffect(() => {
    let cancelled = false;

    if (typeof window === "undefined") {
      return;
    }

    void (async () => {
      const [{ loader }, monaco] = await Promise.all([
        import("@monaco-editor/react"),
        import("monaco-editor"),
      ]);
      if (cancelled) {
        return;
      }
      loader.config({ monaco });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeTab || !isSaveAsOpen) {
      return;
    }

    setSaveAsValue(
      activeTab.path ??
        (currentDirectory ? `${currentDirectory}/untitled.txt` : "untitled.txt")
    );
    setSaveAsError(null);
  }, [activeTab, currentDirectory, isSaveAsOpen]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    window.requestAnimationFrame(() => {
      editor.focus();
    });
  }, [activeTab?.tabId]);

  useEffect(() => {
    if (!isActionsOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (actionsMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      setIsActionsOpen(false);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsActionsOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isActionsOpen]);

  const handleSave = async () => {
    if (!activeTab) {
      return;
    }

    if (!activeTab.path) {
      setIsSaveAsOpen(true);
      return;
    }

    await onSaveTab(activeTab.tabId);
  };

  const handleReload = async () => {
    if (!activeTab || !activeTab.path) {
      return;
    }

    if (isTabDirty(activeTab)) {
      const shouldReload = window.confirm(
        `Discard unsaved changes in ${activeTab.name} and reload from disk?`
      );
      if (!shouldReload) {
        return;
      }
    }

    await onReloadTab(activeTab.tabId);
  };

  const handleCloseTab = (tab: DesktopEditorTabState) => {
    if (isTabDirty(tab)) {
      const shouldClose = window.confirm(
        `Close ${tab.name} and discard unsaved changes?`
      );
      if (!shouldClose) {
        return;
      }
    }

    onCloseTab(tab.tabId);
  };

  const submitSaveAs = async () => {
    if (!activeTab) {
      return;
    }

    const trimmedPath = saveAsValue.trim().replace(/^\/+/, "");
    if (!trimmedPath) {
      setSaveAsError("File name cannot be empty.");
      return;
    }

    try {
      await onSaveTabAs(activeTab.tabId, trimmedPath);
      setIsSaveAsOpen(false);
      setSaveAsError(null);
    } catch (error) {
      setSaveAsError(
        error instanceof Error ? error.message : "Unable to save file."
      );
    }
  };

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void handleSave();
    });

    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS,
      () => {
        setIsSaveAsOpen(true);
      }
    );

    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyP,
      () => {
        setIsActionsOpen(true);
      }
    );

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyB, () => {
      onToggleSidebar();
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyR, () => {
      void handleReload();
    });

    setCursorPosition({
      line: editor.getPosition()?.lineNumber ?? 1,
      column: editor.getPosition()?.column ?? 1,
    });

    editor.onDidChangeCursorPosition((event) => {
      setCursorPosition({
        line: event.position.lineNumber,
        column: event.position.column,
      });
    });
  };

  const statusText = useMemo(() => {
    if (!activeTab) {
      return "Idle";
    }
    if (activeTab.isLoading) {
      return "Loading";
    }
    if (activeTab.isSaving) {
      return "Saving";
    }
    if (isTabDirty(activeTab)) {
      return "Unsaved";
    }
    if (activeTab.lastSavedAt) {
      return "Saved";
    }
    return activeTab.path ? "Ready" : "Scratch";
  }, [activeTab]);

  const actions = useMemo<EditorAction[]>(
    () => [
      {
        id: "save",
        label: "Save",
        shortcut: "Ctrl+S",
        disabled: !activeTab || activeTab.isLoading || activeTab.isSaving,
        run: () => void handleSave(),
      },
      {
        id: "save-as",
        label: "Save As",
        shortcut: "Ctrl+Shift+S",
        disabled: !activeTab || activeTab.isLoading || activeTab.isSaving,
        run: () => setIsSaveAsOpen(true),
      },
      {
        id: "reload",
        label: "Reload From Disk",
        shortcut: "Ctrl+R",
        disabled: !activeTab?.path || activeTab.isLoading || activeTab.isSaving,
        run: () => void handleReload(),
      },
      {
        id: "new-scratch",
        label: "New Scratch File",
        run: () => onCreateScratchTab(),
      },
      {
        id: "toggle-sidebar",
        label: windowState.isSidebarOpen ? "Hide Sidebar" : "Show Sidebar",
        shortcut: "Ctrl+B",
        run: () => onToggleSidebar(),
      },
      {
        id: "close-tab",
        label: "Close Current Tab",
        disabled: !activeTab,
        destructive: Boolean(activeTab && isTabDirty(activeTab)),
        run: () => {
          if (activeTab) {
            handleCloseTab(activeTab);
          }
        },
      },
    ],
    [activeTab, onCreateScratchTab, onToggleSidebar, windowState.isSidebarOpen]
  );

  return (
    <div className="nl-panel nl-panel--editor nl-editor-app">
      {windowState.isSidebarOpen ? (
        <aside className="nl-editor-app__sidebar">
          <div className="nl-editor-app__sidebar-header">
            <strong>Open Files</strong>
            <IconButton label="New scratch file" onClick={onCreateScratchTab}>
              <PlusIcon className="nl-inline-icon" />
            </IconButton>
          </div>
          <div className="nl-editor-app__sidebar-list">
            {windowState.tabs.map((tab) => {
              const active = tab.tabId === activeTab?.tabId;
              return (
                <button
                  key={tab.tabId}
                  type="button"
                  className={cn(
                    "nl-editor-app__sidebar-item",
                    active && "nl-editor-app__sidebar-item--active"
                  )}
                  onClick={() => onSetActiveTab(tab.tabId)}
                >
                  <FileIcon className="nl-list-item__icon" />
                  <span className="nl-editor-app__sidebar-meta">
                    <strong>{tab.name}</strong>
                    <span>{tab.path ? `~/${tab.path}` : "Unsaved scratch"}</span>
                  </span>
                  {isTabDirty(tab) ? <span className="nl-editor-app__dirty-dot" /> : null}
                  <span
                    role="button"
                    tabIndex={0}
                    className="nl-editor-app__tab-close"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleCloseTab(tab);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        handleCloseTab(tab);
                      }
                    }}
                  >
                    <CloseIcon className="nl-inline-icon" />
                  </span>
                </button>
              );
            })}
          </div>
        </aside>
      ) : null}

      <div className="nl-editor-app__main">
        <div className="nl-panel__toolbar nl-editor-app__toolbar">
          <div className="nl-editor-app__toolbar-left">
            <div className="nl-editor-app__path-chip">
              {activeTab ? getTabPathLabel(activeTab) : "No active document"}
            </div>
            <div className="nl-editor-app__status-chip">{statusText}</div>
          </div>
          <div className="nl-toolbar-actions">
            <IconButton
              label={windowState.isSidebarOpen ? "Hide sidebar" : "Show sidebar"}
              onClick={onToggleSidebar}
            >
              <SidebarIcon className="nl-inline-icon" />
            </IconButton>
            <IconButton label="New scratch file" onClick={onCreateScratchTab}>
              <PlusIcon className="nl-inline-icon" />
            </IconButton>
            <IconButton
              label="Reload file"
              onClick={() => void handleReload()}
              disabled={!activeTab?.path || activeTab.isLoading || activeTab.isSaving}
            >
              <RefreshIcon className="nl-inline-icon" />
            </IconButton>
            <Button
              variant="ghost"
              onClick={() => setIsActionsOpen((current) => !current)}
            >
              <SparkIcon className="nl-inline-icon" />
              Actions
            </Button>
            <Button
              onClick={() => void handleSave()}
              disabled={!activeTab || activeTab.isLoading || activeTab.isSaving}
            >
              Save
            </Button>
          </div>
        </div>

        <div className="nl-editor-app__tab-rail">
          {windowState.tabs.map((tab) => {
            const active = tab.tabId === activeTab?.tabId;
            return (
              <button
                key={tab.tabId}
                type="button"
                className={cn("nl-editor-app__tab", active && "nl-editor-app__tab--active")}
                onClick={() => onSetActiveTab(tab.tabId)}
              >
                <FileIcon className="nl-inline-icon" />
                <span>{tab.name}</span>
                {isTabDirty(tab) ? <span className="nl-editor-app__dirty-dot" /> : null}
                <span
                  role="button"
                  tabIndex={0}
                  className="nl-editor-app__tab-close"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleCloseTab(tab);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      handleCloseTab(tab);
                    }
                  }}
                >
                  <CloseIcon className="nl-inline-icon" />
                </span>
              </button>
            );
          })}
        </div>

        {activeTab?.errorMessage ? (
          <div className="nl-error-banner">{activeTab.errorMessage}</div>
        ) : null}

        <div className="nl-editor-app__canvas">
          {isActionsOpen ? (
            <div ref={actionsMenuRef} className="nl-editor-app__actions-menu">
              {actions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  className={cn(
                    "nl-editor-app__actions-item",
                    action.destructive && "nl-editor-app__actions-item--danger"
                  )}
                  disabled={action.disabled}
                  onClick={() => {
                    setIsActionsOpen(false);
                    void action.run();
                  }}
                >
                  <span>{action.label}</span>
                  {action.shortcut ? (
                    <span className="nl-editor-app__actions-shortcut">
                      {action.shortcut}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
          {activeTab ? (
            <MonacoEditor
              key={activeTab.tabId}
              path={activeTab.path ?? activeTab.name}
              value={activeTab.content}
              language={activeLanguage}
              theme={resolvedTheme === "dark" ? "vs-dark" : "vs"}
              onMount={handleEditorMount}
              onChange={(value) => onChangeTabContent(activeTab.tabId, value ?? "")}
              loading={<div className="nl-editor-app__loading">Loading editor...</div>}
              options={{
                automaticLayout: true,
                fontSize: 14,
                fontLigatures: true,
                lineNumbers: "on",
                minimap: { enabled: true },
                roundedSelection: true,
                scrollBeyondLastLine: false,
                smoothScrolling: true,
                tabSize: 2,
                useShadowDOM: false,
                wordWrap: "on",
                padding: { top: 14, bottom: 14 },
              }}
            />
          ) : (
            <div className="nl-empty-state">No active editor tab.</div>
          )}
        </div>

        <div className="nl-editor-app__footer">
          <span>
            {activeTab
              ? `${activeLanguage} · ${getTabPathLabel(activeTab)}`
              : "No active document"}
          </span>
          <span>
            Ln {cursorPosition.line}, Col {cursorPosition.column}
          </span>
        </div>
      </div>

      {isSaveAsOpen ? (
        <div className="nl-editor-app__modal-overlay">
          <div className="nl-editor-app__modal">
            <h3>Save File As</h3>
            <p>Choose a workspace path for the current document.</p>
            <input
              autoFocus
              type="text"
              value={saveAsValue}
              onChange={(event) => {
                setSaveAsValue(event.target.value);
                if (saveAsError) {
                  setSaveAsError(null);
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submitSaveAs();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setIsSaveAsOpen(false);
                  setSaveAsError(null);
                }
              }}
              className="nl-input"
              placeholder="folder/filename.txt"
            />
            {saveAsError ? <div className="nl-status-note">{saveAsError}</div> : null}
            <div className="nl-editor-app__modal-actions">
              <Button
                variant="ghost"
                onClick={() => {
                  setIsSaveAsOpen(false);
                  setSaveAsError(null);
                }}
              >
                Cancel
              </Button>
              <Button onClick={() => void submitSaveAs()}>Save</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
