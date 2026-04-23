"use client";

export interface DesktopEditorTabState {
  tabId: string;
  path: string | null;
  name: string;
  mimeType: string | null;
  content: string;
  savedContent: string;
  isLoading: boolean;
  isSaving: boolean;
  errorMessage: string | null;
  lastSavedAt: number | null;
}

export interface DesktopEditorWindowState {
  tabs: DesktopEditorTabState[];
  activeTabId: string;
  isSidebarOpen: boolean;
}

export type TerminalSplitMode = "none" | "horizontal" | "vertical";

export interface TerminalPaneState {
  paneId: string;
  sessionId: string;
}

export interface TerminalTabState {
  tabId: string;
  title: string;
  splitMode: TerminalSplitMode;
  panes: TerminalPaneState[];
  activePaneId: string;
}

export interface TerminalLayoutState {
  tabs: TerminalTabState[];
  activeTabId: string;
}

export interface DesktopTerminalWindowState {
  layout: TerminalLayoutState | null;
  isInitializing: boolean;
}
