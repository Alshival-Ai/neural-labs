"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from "react";
import { useTheme } from "next-themes";

import type {
  TerminalLayoutState,
  TerminalPaneState,
  TerminalTabState,
} from "@/components/desktop/app-types";
import {
  CloseIcon,
  PlusIcon,
  RefreshIcon,
  TerminalIcon,
} from "@/components/ui/icons";
import { Button, cn } from "@/components/ui/primitives";

function reorderTabs(
  tabs: TerminalTabState[],
  sourceTabId: string,
  targetTabId: string
): TerminalTabState[] {
  if (sourceTabId === targetTabId) {
    return tabs;
  }

  const sourceIndex = tabs.findIndex((tab) => tab.tabId === sourceTabId);
  const targetIndex = tabs.findIndex((tab) => tab.tabId === targetTabId);
  if (sourceIndex === -1 || targetIndex === -1) {
    return tabs;
  }

  const nextTabs = [...tabs];
  const [movedTab] = nextTabs.splice(sourceIndex, 1);
  if (!movedTab) {
    return tabs;
  }

  nextTabs.splice(targetIndex, 0, movedTab);
  return nextTabs;
}

function TerminalPaneSurface({
  sessionId,
  isActive,
  onFocus,
}: {
  sessionId: string;
  isActive: boolean;
  onFocus: () => void;
}) {
  const { resolvedTheme } = useTheme();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const fitAddonRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const inputBufferRef = useRef("");
  const inputFlushTimerRef = useRef<number | null>(null);
  const disconnectNoticeRef = useRef(false);

  const sendSocketMessage = useCallback((payload: object) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    socket.send(JSON.stringify(payload));
    return true;
  }, []);

  const flushInput = useCallback(() => {
    const data = inputBufferRef.current;
    if (!data) {
      return;
    }

    if (!sendSocketMessage({ type: "input", data })) {
      return;
    }

    inputBufferRef.current = "";
  }, [sendSocketMessage]);

  const terminalTheme = useMemo(
    () =>
      resolvedTheme === "light"
        ? {
            background: "#fcfdff",
            foreground: "#0f172a",
            cursor: "#0f172a",
            cursorAccent: "#fcfdff",
            selectionBackground: "rgba(42, 104, 255, 0.22)",
          }
        : {
            background: "#0b0d12",
            foreground: "#f8fafc",
            cursor: "#f8fafc",
            cursorAccent: "#0b0d12",
            selectionBackground: "rgba(148, 163, 184, 0.28)",
          },
    [resolvedTheme]
  );

  const resizeTerminal = useCallback(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    const host = hostRef.current;
    if (!terminal || !fitAddon || !host) {
      return;
    }

    if (host.clientWidth < 20 || host.clientHeight < 20) {
      return;
    }

    fitAddon.fit();
    if (terminal.cols <= 1 || terminal.rows <= 1) {
      return;
    }

    sendSocketMessage({
      type: "resize",
      cols: terminal.cols,
      rows: terminal.rows,
    });
  }, [sendSocketMessage]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    let isDisposed = false;
    let socket: WebSocket | null = null;
    let inputSubscription: { dispose: () => void } | null = null;

    const onWindowResize = () => {
      resizeTerminal();
    };

    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (isDisposed) {
        return;
      }

      host.replaceChildren();

      const terminal = new Terminal({
        cursorBlink: true,
        convertEol: true,
        fontSize: 13,
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace",
        theme: terminalTheme,
        allowProposedApi: false,
        scrollback: 6000,
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(host);

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;

      terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
        if (event.type !== "keydown") {
          return true;
        }

        const key = event.key.toLowerCase();
        const usesModifier = event.ctrlKey || event.metaKey;

        if (usesModifier && event.shiftKey && key === "c") {
          event.preventDefault();
          const selection = terminal.getSelection();
          if (selection) {
            void navigator.clipboard.writeText(selection);
          }
          return false;
        }

        if (usesModifier && key === "v") {
          event.preventDefault();
          void navigator.clipboard
            .readText()
            .then((text) => {
              inputBufferRef.current += text;
              flushInput();
            })
            .catch(() => {});
          return false;
        }

        return true;
      });

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(
        `${protocol}//${window.location.host}/api/neural-labs/terminal/sessions/${sessionId}/socket`
      );
      socketRef.current = socket;
      disconnectNoticeRef.current = false;

      socket.addEventListener("open", () => {
        if (isDisposed) {
          return;
        }
        flushInput();
        resizeTerminal();
      });

      socket.addEventListener("message", (event) => {
        if (isDisposed) {
          return;
        }

        try {
          const payload = JSON.parse(String(event.data)) as { text?: string; type?: string };
          if (payload.text) {
            terminal.write(payload.text);
          }
          if (payload.type === "exit") {
            terminal.writeln("\r\n[terminal exited]");
          }
          if (payload.type === "error" && payload.text) {
            terminal.writeln(`\r\n[${payload.text}]`);
          }
        } catch {
          // Ignore malformed chunks.
        }
      });

      const showDisconnectNotice = () => {
        if (isDisposed || disconnectNoticeRef.current) {
          return;
        }
        disconnectNoticeRef.current = true;
        terminal.writeln("\r\n[terminal stream disconnected]");
      };

      socket.addEventListener("close", showDisconnectNotice);
      socket.addEventListener("error", showDisconnectNotice);

      inputSubscription = terminal.onData((data) => {
        inputBufferRef.current += data;
        if (inputFlushTimerRef.current !== null) {
          return;
        }
        inputFlushTimerRef.current = window.setTimeout(() => {
          inputFlushTimerRef.current = null;
          flushInput();
        }, 25);
      });

      const resizeObserver = new ResizeObserver(() => {
        resizeTerminal();
      });
      resizeObserver.observe(host);
      resizeObserverRef.current = resizeObserver;

      window.addEventListener("resize", onWindowResize);
      resizeTerminal();
    })().catch(() => {
      if (!isDisposed) {
        host.textContent = "Unable to initialize terminal surface.";
      }
    });

    return () => {
      isDisposed = true;
      inputSubscription?.dispose();
      socketRef.current = null;
      window.removeEventListener("resize", onWindowResize);

      if (inputFlushTimerRef.current !== null) {
        window.clearTimeout(inputFlushTimerRef.current);
        inputFlushTimerRef.current = null;
      }
      if (inputBufferRef.current.length > 0) {
        flushInput();
      }
      socket?.close();

      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      host.replaceChildren();
    };
  }, [flushInput, resizeTerminal, sessionId, terminalTheme]);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    const timer = window.setTimeout(() => {
      resizeTerminal();
    }, 60);

    return () => window.clearTimeout(timer);
  }, [isActive, resizeTerminal]);

  return (
    <div
      className="nl-terminal-app__pane-surface"
      onMouseDown={onFocus}
      onFocus={onFocus}
      role="button"
      tabIndex={0}
    >
      <div ref={hostRef} className="nl-terminal-app__xterm-host" />
    </div>
  );
}

export function TerminalPanel({
  layout,
  isInitializing,
  onAddTab,
  onSetActiveTab,
  onSetActivePane,
  onCloseTab,
  onClosePane,
  onSplitTab,
  onDuplicateTab,
  onRenameTab,
  onReorderTabs,
}: {
  layout: TerminalLayoutState | null;
  isInitializing: boolean;
  onAddTab: () => Promise<void> | void;
  onSetActiveTab: (tabId: string) => void;
  onSetActivePane: (tabId: string, paneId: string) => void;
  onCloseTab: (tabId: string) => Promise<void> | void;
  onClosePane: (tabId: string, paneId: string) => Promise<void> | void;
  onSplitTab: (tabId: string, direction: "horizontal" | "vertical") => Promise<void> | void;
  onDuplicateTab: (tabId: string) => Promise<void> | void;
  onRenameTab: (tabId: string) => void;
  onReorderTabs: (tabs: TerminalTabState[]) => void;
}) {
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);

  const activeTab = useMemo(() => {
    if (!layout) {
      return null;
    }
    return layout.tabs.find((tab) => tab.tabId === layout.activeTabId) ?? layout.tabs[0] ?? null;
  }, [layout]);

  const activePane = useMemo(() => {
    if (!activeTab) {
      return null;
    }
    return (
      activeTab.panes.find((pane) => pane.paneId === activeTab.activePaneId) ??
      activeTab.panes[0] ??
      null
    );
  }, [activeTab]);

  const canSplitActiveTab = Boolean(activeTab && activeTab.panes.length === 1);

  const handleTabDrop = (
    event: ReactDragEvent<HTMLElement>,
    targetTabId: string
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (!layout || !draggedTabId || draggedTabId === targetTabId) {
      setDraggedTabId(null);
      return;
    }
    onReorderTabs(reorderTabs(layout.tabs, draggedTabId, targetTabId));
    setDraggedTabId(null);
  };

  return (
    <div className="nl-panel nl-panel--terminal nl-terminal-app">
      <div className="nl-terminal-app__header">
        <div className="nl-terminal-app__tabs">
          {(layout?.tabs ?? []).map((tab, index) => {
            const isActive = tab.tabId === activeTab?.tabId;
            return (
              <div
                key={tab.tabId}
                role="button"
                tabIndex={0}
                draggable
                className={cn(
                  "nl-terminal-app__tab",
                  isActive && "nl-terminal-app__tab--active"
                )}
                onClick={() => onSetActiveTab(tab.tabId)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSetActiveTab(tab.tabId);
                  }
                }}
                onMouseDown={(event) => {
                  if (event.button === 1) {
                    event.preventDefault();
                    void onCloseTab(tab.tabId);
                  }
                }}
                onDragStart={(event) => {
                  setDraggedTabId(tab.tabId);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", tab.tabId);
                }}
                onDragOver={(event) => {
                  if (draggedTabId && draggedTabId !== tab.tabId) {
                    event.preventDefault();
                  }
                }}
                onDrop={(event) => handleTabDrop(event, tab.tabId)}
                onDragEnd={() => setDraggedTabId(null)}
              >
                <TerminalIcon className="nl-inline-icon" />
                <span className="nl-terminal-app__tab-title">
                  {tab.title || `Terminal ${index + 1}`}
                </span>
                <button
                  type="button"
                  className="nl-terminal-app__tab-close"
                  onClick={(event) => {
                    event.stopPropagation();
                    void onCloseTab(tab.tabId);
                  }}
                >
                  <CloseIcon className="nl-inline-icon" />
                </button>
              </div>
            );
          })}
          <button
            type="button"
            className="nl-terminal-app__new-tab"
            onClick={() => void onAddTab()}
            aria-label="New terminal tab"
          >
            <PlusIcon className="nl-inline-icon" />
          </button>
        </div>

        <div className="nl-terminal-app__actions">
          <Button
            variant="ghost"
            disabled={!activeTab}
            onClick={() => {
              if (activeTab) {
                onRenameTab(activeTab.tabId);
              }
            }}
          >
            Rename
          </Button>
          <Button
            variant="ghost"
            disabled={!activeTab}
            onClick={() => {
              if (activeTab) {
                void onDuplicateTab(activeTab.tabId);
              }
            }}
          >
            Duplicate
          </Button>
          <Button
            variant="ghost"
            disabled={!canSplitActiveTab || !activeTab}
            onClick={() => {
              if (activeTab) {
                void onSplitTab(activeTab.tabId, "vertical");
              }
            }}
          >
            Split Right
          </Button>
          <Button
            variant="ghost"
            disabled={!canSplitActiveTab || !activeTab}
            onClick={() => {
              if (activeTab) {
                void onSplitTab(activeTab.tabId, "horizontal");
              }
            }}
          >
            Split Down
          </Button>
          <Button
            variant="ghost"
            disabled={!activeTab}
            onClick={() => {
              if (activeTab) {
                void onCloseTab(activeTab.tabId);
              }
            }}
          >
            <RefreshIcon className="nl-inline-icon" />
            Close Tab
          </Button>
        </div>
      </div>

      <div className="nl-terminal-app__body">
        {isInitializing ? (
          <div className="nl-empty-state">Initializing terminal window...</div>
        ) : !layout || layout.tabs.length === 0 || !activeTab ? (
          <div className="nl-empty-state">No terminal tabs are open.</div>
        ) : activeTab.splitMode === "none" ? (
          <div
            className="nl-terminal-app__single-pane"
            onMouseDown={() => activePane && onSetActivePane(activeTab.tabId, activePane.paneId)}
          >
            {activePane ? (
              <TerminalPaneSurface
                sessionId={activePane.sessionId}
                isActive
                onFocus={() => onSetActivePane(activeTab.tabId, activePane.paneId)}
              />
            ) : null}
          </div>
        ) : (
          <div
            className={cn(
              "nl-terminal-app__split",
              activeTab.splitMode === "vertical"
                ? "nl-terminal-app__split--vertical"
                : "nl-terminal-app__split--horizontal"
            )}
          >
            {activeTab.panes.map((pane, index) => {
              const isActivePane = pane.paneId === activePane?.paneId;
              return (
                <div
                  key={pane.paneId}
                  className={cn(
                    "nl-terminal-app__pane",
                    isActivePane && "nl-terminal-app__pane--active"
                  )}
                  onMouseDown={() => onSetActivePane(activeTab.tabId, pane.paneId)}
                >
                  <div className="nl-terminal-app__pane-header">
                    <span>Pane {index + 1}</span>
                    <button
                      type="button"
                      className="nl-terminal-app__pane-close"
                      onClick={(event) => {
                        event.stopPropagation();
                        void onClosePane(activeTab.tabId, pane.paneId);
                      }}
                    >
                      <CloseIcon className="nl-inline-icon" />
                    </button>
                  </div>
                  <div className="nl-terminal-app__pane-body">
                    <TerminalPaneSurface
                      sessionId={pane.sessionId}
                      isActive={isActivePane}
                      onFocus={() => onSetActivePane(activeTab.tabId, pane.paneId)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="nl-terminal-app__footer">
        <span>Keyboard input goes directly to the active terminal pane.</span>
        <span>{layout?.tabs.length ?? 0} tab(s)</span>
      </div>
    </div>
  );
}
