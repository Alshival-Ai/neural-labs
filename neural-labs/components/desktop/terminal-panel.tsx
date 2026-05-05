"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useTheme } from "next-themes";

import type {
  TerminalLayoutState,
  TerminalPaneState,
  TerminalTabState,
} from "@/components/desktop/app-types";
import {
  closeTerminalSession,
  createTerminalSession,
  createTerminalWsToken,
} from "@/lib/client/api";
import {
  CloseIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  TerminalIcon,
} from "@/components/ui/icons";
import { cn } from "@/components/ui/primitives";

type TerminalConnectionState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "exited"
  | "reconnecting";

interface TerminalPaneMeta {
  cols: number;
  rows: number;
  state: TerminalConnectionState;
}

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
  onAddTab,
  onCloseActiveTab,
  onMetaChange,
  onSessionRecovered,
}: {
  sessionId: string;
  isActive: boolean;
  onFocus: () => void;
  onAddTab: () => Promise<void> | void;
  onCloseActiveTab: () => Promise<void> | void;
  onMetaChange?: (meta: TerminalPaneMeta) => void;
  onSessionRecovered?: (nextSessionId: string) => void;
}) {
  const { resolvedTheme } = useTheme();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const fitAddonRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
  const searchAddonRef = useRef<import("@xterm/addon-search").SearchAddon | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const inputBufferRef = useRef("");
  const inputFlushTimerRef = useRef<number | null>(null);
  const disconnectNoticeRef = useRef(false);
  const [connectionState, setConnectionState] =
    useState<TerminalConnectionState>("connecting");
  const [terminalSize, setTerminalSize] = useState({ cols: 0, rows: 0 });
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const terminalSizeRef = useRef(terminalSize);
  const connectionStateRef = useRef(connectionState);
  const onMetaChangeRef = useRef(onMetaChange);
  const onAddTabRef = useRef(onAddTab);
  const onCloseActiveTabRef = useRef(onCloseActiveTab);
  const onSessionRecoveredRef = useRef(onSessionRecovered);

  useEffect(() => {
    onMetaChangeRef.current = onMetaChange;
    onAddTabRef.current = onAddTab;
    onCloseActiveTabRef.current = onCloseActiveTab;
    onSessionRecoveredRef.current = onSessionRecovered;
  }, [onAddTab, onCloseActiveTab, onMetaChange, onSessionRecovered]);

  const publishMeta = useCallback(
    (meta: Partial<TerminalPaneMeta>) => {
      const nextMeta = {
        cols: meta.cols ?? terminalRef.current?.cols ?? terminalSizeRef.current.cols,
        rows: meta.rows ?? terminalRef.current?.rows ?? terminalSizeRef.current.rows,
        state: meta.state ?? connectionStateRef.current,
      };
      terminalSizeRef.current = { cols: nextMeta.cols, rows: nextMeta.rows };
      connectionStateRef.current = nextMeta.state;
      setTerminalSize({ cols: nextMeta.cols, rows: nextMeta.rows });
      setConnectionState(nextMeta.state);
      onMetaChangeRef.current?.(nextMeta);
    },
    []
  );

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
            background: "#ffffff",
            foreground: "#0f172a",
            cursor: "#0f172a",
            cursorAccent: "#ffffff",
            selectionBackground: "rgba(42, 104, 255, 0.22)",
          }
        : {
            background: "#070d17",
            foreground: "#f8fafc",
            cursor: "#f8fafc",
            cursorAccent: "#070d17",
            selectionBackground: "rgba(148, 163, 184, 0.28)",
          },
    [resolvedTheme]
  );

  const copySelection = useCallback(() => {
    const selection = terminalRef.current?.getSelection();
    if (selection) {
      void navigator.clipboard.writeText(selection);
    }
  }, []);

  const pasteFromClipboard = useCallback(() => {
    void navigator.clipboard
      .readText()
      .then((text) => {
        if (!text) {
          return;
        }
        inputBufferRef.current += text;
        flushInput();
      })
      .catch(() => {});
  }, [flushInput]);

  const clearTerminal = useCallback(() => {
    terminalRef.current?.clear();
  }, []);

  const reconnectTerminal = useCallback(() => {
    publishMeta({ state: "reconnecting" });
    socketRef.current?.close();
    setConnectionAttempt((current) => current + 1);
  }, [publishMeta]);

  const restartTerminal = useCallback(async () => {
    publishMeta({ state: "reconnecting" });
    try {
      await closeTerminalSession(sessionId);
    } catch {
      // The existing session may already be gone.
    }
    const nextSession = await createTerminalSession(terminalSizeRef.current);
    onSessionRecoveredRef.current?.(nextSession.id);
  }, [publishMeta, sessionId]);

  const runSearch = useCallback(
    (direction: "next" | "previous" = "next", value = searchValue) => {
      const query = value.trim();
      if (!query) {
        return;
      }
      if (direction === "next") {
        searchAddonRef.current?.findNext(query);
        return;
      }
      searchAddonRef.current?.findPrevious(query);
    },
    [searchValue]
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

    publishMeta({ cols: terminal.cols, rows: terminal.rows });
    sendSocketMessage({
      type: "resize",
      cols: terminal.cols,
      rows: terminal.rows,
    });
  }, [publishMeta, sendSocketMessage]);

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
      const [{ Terminal }, { FitAddon }, { SearchAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
        import("@xterm/addon-search"),
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
      const searchAddon = new SearchAddon();
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(searchAddon);
      terminal.open(host);

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;
      searchAddonRef.current = searchAddon;

      terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
        if (event.type !== "keydown") {
          return true;
        }

        const key = event.key.toLowerCase();
        const usesModifier = event.ctrlKey || event.metaKey;

        if (usesModifier && event.shiftKey && key === "t") {
          event.preventDefault();
          void onAddTabRef.current();
          return false;
        }

        if (usesModifier && event.shiftKey && key === "w") {
          event.preventDefault();
          void onCloseActiveTabRef.current();
          return false;
        }

        if (usesModifier && event.shiftKey && key === "f") {
          event.preventDefault();
          setIsSearchOpen(true);
          return false;
        }

        if (usesModifier && event.shiftKey && key === "c") {
          event.preventDefault();
          copySelection();
          return false;
        }

        if (usesModifier && key === "v") {
          event.preventDefault();
          pasteFromClipboard();
          return false;
        }

        return true;
      });

      let tokenPayload: { token: string; ws_path: string };
      let currentSessionId = sessionId.trim();
      if (!currentSessionId) {
        const recoveredSession = await createTerminalSession({
          cols: terminal.cols,
          rows: terminal.rows,
        });
        currentSessionId = recoveredSession.id;
        onSessionRecoveredRef.current?.(recoveredSession.id);
      }

      try {
        tokenPayload = await createTerminalWsToken(currentSessionId);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (!/terminal session not found|terminal_id is required/i.test(message)) {
          throw error;
        }

        const recoveredSession = await createTerminalSession({
          cols: terminal.cols,
          rows: terminal.rows,
        });
        onSessionRecoveredRef.current?.(recoveredSession.id);
        tokenPayload = await createTerminalWsToken(recoveredSession.id);
      }
      if (isDisposed) {
        return;
      }

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsPath =
        tokenPayload.ws_path ||
        `/api/neural-labs/terminal/ws?terminal_token=${encodeURIComponent(
          tokenPayload.token
        )}`;
      socket = new WebSocket(`${protocol}//${window.location.host}${wsPath}`);
      socketRef.current = socket;
      disconnectNoticeRef.current = false;
      publishMeta({ state: "connecting" });

      socket.addEventListener("open", () => {
        if (isDisposed) {
          return;
        }
        publishMeta({ state: "connected" });
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
            publishMeta({ state: "exited" });
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
        publishMeta({ state: "disconnected" });
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
    })().catch((error) => {
      console.error("[terminal-pane] initialization failed", error);
      if (!isDisposed) {
        host.textContent =
          error instanceof Error && error.message
            ? error.message
            : "Unable to initialize terminal surface.";
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
      searchAddonRef.current = null;
      host.replaceChildren();
    };
  }, [
    connectionAttempt,
    copySelection,
    flushInput,
    pasteFromClipboard,
    publishMeta,
    resizeTerminal,
    sessionId,
    terminalTheme,
  ]);

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
      <div className="nl-terminal-app__pane-toolbar" aria-label="Terminal pane tools">
        <span
          className={cn(
            "nl-terminal-app__state",
            `nl-terminal-app__state--${connectionState}`
          )}
        >
          {connectionState}
        </span>
        <span className="nl-terminal-app__size">
          {terminalSize.cols || "--"} x {terminalSize.rows || "--"}
        </span>
        <button
          type="button"
          className="nl-terminal-app__tool"
          onClick={() => setIsSearchOpen((current) => !current)}
          title="Search"
          aria-label="Search terminal"
        >
          <SearchIcon className="nl-inline-icon" />
        </button>
        <button
          type="button"
          className="nl-terminal-app__tool"
          onClick={reconnectTerminal}
          title="Reconnect"
          aria-label="Reconnect terminal stream"
        >
          <RefreshIcon className="nl-inline-icon" />
        </button>
        <button
          type="button"
          className="nl-terminal-app__tool"
          onClick={() => void restartTerminal()}
          title="Restart shell"
          aria-label="Restart shell"
        >
          <TerminalIcon className="nl-inline-icon" />
        </button>
      </div>
      {isSearchOpen ? (
        <form
          className="nl-terminal-app__search"
          onSubmit={(event) => {
            event.preventDefault();
            runSearch("next");
          }}
        >
          <input
            value={searchValue}
            onChange={(event) => {
              const nextValue = event.target.value;
              setSearchValue(nextValue);
              runSearch("next", nextValue);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setIsSearchOpen(false);
              }
            }}
            placeholder="Search terminal"
            autoFocus
          />
          <button type="button" onClick={() => runSearch("previous")}>
            Prev
          </button>
          <button type="submit">Next</button>
          <button type="button" onClick={() => setIsSearchOpen(false)}>
            <CloseIcon className="nl-inline-icon" />
          </button>
        </form>
      ) : null}
      <div ref={hostRef} className="nl-terminal-app__xterm-host" />
      <div className="nl-terminal-app__quick-actions" aria-label="Terminal quick actions">
        <button type="button" onClick={copySelection}>
          Copy
        </button>
        <button type="button" onClick={pasteFromClipboard}>
          Paste
        </button>
        <button type="button" onClick={clearTerminal}>
          Clear
        </button>
      </div>
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
  onRecoverPaneSession,
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
  onRecoverPaneSession: (tabId: string, paneId: string, sessionId: string) => void;
}) {
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [paneMetaById, setPaneMetaById] = useState<Record<string, TerminalPaneMeta>>({});
  const [splitRatioByTabId, setSplitRatioByTabId] = useState<Record<string, number>>({});

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
  const tabCount = layout?.tabs.length ?? 0;
  const activeSplitLabel =
    activeTab?.splitMode === "vertical"
      ? "Split right"
      : activeTab?.splitMode === "horizontal"
        ? "Split down"
        : "Single pane";
  const activePaneMeta = activePane ? paneMetaById[activePane.paneId] : null;
  const activePaneStatus = activePaneMeta?.state ?? "connecting";
  const activePaneSize =
    activePaneMeta && activePaneMeta.cols > 0 && activePaneMeta.rows > 0
      ? `${activePaneMeta.cols} x ${activePaneMeta.rows}`
      : "-- x --";

  const handlePaneMetaChange = useCallback(
    (paneId: string, meta: TerminalPaneMeta) => {
      setPaneMetaById((current) => {
        const existing = current[paneId];
        if (
          existing?.cols === meta.cols &&
          existing.rows === meta.rows &&
          existing.state === meta.state
        ) {
          return current;
        }
        return { ...current, [paneId]: meta };
      });
    },
    []
  );

  const handleSplitResizeStart = (
    event: ReactPointerEvent<HTMLDivElement>,
    tab: TerminalTabState
  ) => {
    const splitElement = event.currentTarget.parentElement;
    if (!splitElement) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = splitElement.getBoundingClientRect();
    const isVertical = tab.splitMode === "vertical";

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const position = isVertical
        ? moveEvent.clientX - rect.left
        : moveEvent.clientY - rect.top;
      const total = isVertical ? rect.width : rect.height;
      if (total <= 0) {
        return;
      }
      const ratio = Math.min(75, Math.max(25, (position / total) * 100));
      setSplitRatioByTabId((current) => ({
        ...current,
        [tab.tabId]: ratio,
      }));
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  };

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
        <div className="nl-terminal-app__topbar">
          <div className="nl-terminal-app__brand">
            <span className="nl-terminal-app__brand-mark">
              <TerminalIcon className="nl-inline-icon" />
            </span>
            <span className="nl-terminal-app__brand-copy">
              <strong>Terminal</strong>
              <span>{activeTab?.title ?? "No active shell"}</span>
            </span>
          </div>

          <div className="nl-terminal-app__actions" aria-label="Terminal actions">
            <button
              type="button"
              className="nl-terminal-app__action"
              disabled={!activeTab}
              onClick={() => {
                if (activeTab) {
                  onRenameTab(activeTab.tabId);
                }
              }}
            >
              Rename
            </button>
            <button
              type="button"
              className="nl-terminal-app__action"
              disabled={!activeTab}
              onClick={() => {
                if (activeTab) {
                  void onDuplicateTab(activeTab.tabId);
                }
              }}
            >
              Duplicate
            </button>
            <button
              type="button"
              className="nl-terminal-app__action"
              disabled={!canSplitActiveTab || !activeTab}
              onClick={() => {
                if (activeTab) {
                  void onSplitTab(activeTab.tabId, "vertical");
                }
              }}
            >
              Split Right
            </button>
            <button
              type="button"
              className="nl-terminal-app__action"
              disabled={!canSplitActiveTab || !activeTab}
              onClick={() => {
                if (activeTab) {
                  void onSplitTab(activeTab.tabId, "horizontal");
                }
              }}
            >
              Split Down
            </button>
            <button
              type="button"
              className="nl-terminal-app__action nl-terminal-app__action--danger"
              disabled={!activeTab}
              onClick={() => {
                if (activeTab) {
                  void onCloseTab(activeTab.tabId);
                }
              }}
            >
              Close
            </button>
          </div>
        </div>

        <div className="nl-terminal-app__tab-rail">
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
                <span className="nl-terminal-app__tab-dot" />
                <span className="nl-terminal-app__tab-title">
                  {tab.title || `Terminal ${index + 1}`}
                </span>
                <button
                  type="button"
                  className="nl-terminal-app__tab-close"
                  aria-label={`Close ${tab.title || `Terminal ${index + 1}`}`}
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
                onAddTab={onAddTab}
                onCloseActiveTab={() => onCloseTab(activeTab.tabId)}
                onFocus={() => onSetActivePane(activeTab.tabId, activePane.paneId)}
                onMetaChange={(meta) => handlePaneMetaChange(activePane.paneId, meta)}
                onSessionRecovered={(nextSessionId) =>
                  onRecoverPaneSession(activeTab.tabId, activePane.paneId, nextSessionId)
                }
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
            style={
              {
                "--terminal-split-ratio": `${
                  splitRatioByTabId[activeTab.tabId] ?? 50
                }%`,
              } as CSSProperties
            }
          >
            {activeTab.panes.map((pane, index) => {
              const isActivePane = pane.paneId === activePane?.paneId;
              return (
                <Fragment key={pane.paneId}>
                  {index === 1 ? (
                    <div
                      className="nl-terminal-app__split-divider"
                      role="separator"
                      aria-orientation={
                        activeTab.splitMode === "vertical" ? "vertical" : "horizontal"
                      }
                      onPointerDown={(event) =>
                        handleSplitResizeStart(event, activeTab)
                      }
                    />
                  ) : null}
                  <div
                    className={cn(
                      "nl-terminal-app__pane",
                      isActivePane && "nl-terminal-app__pane--active"
                    )}
                    onMouseDown={() => onSetActivePane(activeTab.tabId, pane.paneId)}
                  >
                    <div className="nl-terminal-app__pane-header">
                      <span>
                        Pane {index + 1}
                        {paneMetaById[pane.paneId]
                          ? ` / ${paneMetaById[pane.paneId].state}`
                          : ""}
                      </span>
                      <button
                        type="button"
                        className="nl-terminal-app__pane-close"
                        aria-label={`Close pane ${index + 1}`}
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
                        onAddTab={onAddTab}
                        onCloseActiveTab={() => onCloseTab(activeTab.tabId)}
                        onFocus={() => onSetActivePane(activeTab.tabId, pane.paneId)}
                        onMetaChange={(meta) => handlePaneMetaChange(pane.paneId, meta)}
                        onSessionRecovered={(nextSessionId) =>
                          onRecoverPaneSession(activeTab.tabId, pane.paneId, nextSessionId)
                        }
                      />
                    </div>
                  </div>
                </Fragment>
              );
            })}
          </div>
        )}
      </div>

      <div className="nl-terminal-app__footer">
        <span>
          {activeTab
            ? `${activeSplitLabel} / ${activePaneStatus} / ${activePaneSize}`
            : "No active tab"}
        </span>
        <span>
          {tabCount} {tabCount === 1 ? "tab" : "tabs"}
          {activeTab ? ` / ${activeTab.panes.length} ${activeTab.panes.length === 1 ? "pane" : "panes"}` : ""}
        </span>
      </div>
    </div>
  );
}
