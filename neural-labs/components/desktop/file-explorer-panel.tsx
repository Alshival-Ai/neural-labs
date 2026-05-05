"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
} from "react";

import { cn } from "@/components/ui/primitives";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  FileIcon,
  FolderIcon,
  GridIcon,
  ListIcon,
  PlusIcon,
  RefreshIcon,
  UploadIcon,
} from "@/components/ui/icons";
import { listFiles } from "@/lib/client/api";
import type { DirectoryListing, FileEntry } from "@/lib/shared/types";

const CONTEXT_MENU_MARGIN_PX = 8;
const SHOW_HIDDEN_STORAGE_KEY = "neural-labs-desktop-explorer-show-hidden-v1";
const FAVORITES_STORAGE_KEY = "neural-labs-desktop-explorer-favorites-v1";
const DEFAULT_FAVORITE_PATHS = [""];

interface ContextMenuState {
  entry: FileEntry | null;
  x: number;
  y: number;
}

type ExplorerViewMode = "icon" | "list";

function isHiddenEntry(entry: FileEntry): boolean {
  return entry.name.startsWith(".");
}

function getParentPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function getPathSegments(path: string): { label: string; path: string }[] {
  const parts = path.split("/").filter(Boolean);
  return parts.map((part, index) => ({
    label: part,
    path: parts.slice(0, index + 1).join("/"),
  }));
}

function getAncestorPaths(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  const ancestors: string[] = [];
  for (let index = 1; index <= parts.length; index += 1) {
    ancestors.push(parts.slice(0, index).join("/"));
  }
  return ancestors;
}

function formatPathLabel(path: string): string {
  return path ? `~/${path}` : "~";
}

function normalizePath(path: string): string {
  return path.replace(/^\/+/, "").replace(/\/+$/, "");
}

function createDirectoryEntry(path: string, name: string): FileEntry {
  return {
    name,
    path,
    isDirectory: true,
    size: 0,
    modifiedAt: "",
    mimeType: "inode/directory",
  };
}

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) {
    return "0 B";
  }

  if (size < 1024) {
    return `${size} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = size / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatModifiedAt(modifiedAt: string): string {
  const timestamp = new Date(modifiedAt);
  if (Number.isNaN(timestamp.getTime())) {
    return "Unknown";
  }
  return timestamp.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function sortEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort((left, right) => {
    if (left.isDirectory !== right.isDirectory) {
      return left.isDirectory ? -1 : 1;
    }
    return left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
}

function eventHasExternalFiles(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

function isInvalidDestination(sourcePath: string, destinationPath: string): boolean {
  if (sourcePath === destinationPath) {
    return true;
  }
  if (getParentPath(sourcePath) === destinationPath) {
    return true;
  }
  return destinationPath.startsWith(`${sourcePath}/`);
}

function toFileList(files: File[]): FileList {
  const transfer = new DataTransfer();
  files.forEach((file) => transfer.items.add(file));
  return transfer.files;
}

function ExplorerTreeRow({
  entry,
  depth,
  isExpanded,
  isSelected,
  isDropTarget,
  onSelect,
  onToggle,
  onOpenMenu,
  onDragStartEntry,
  onDragEndEntry,
  onDragOverDirectory,
  onDropDirectory,
}: {
  entry: FileEntry;
  depth: number;
  isExpanded: boolean;
  isSelected: boolean;
  isDropTarget: boolean;
  onSelect: (entry: FileEntry) => void;
  onToggle: (entry: FileEntry) => void;
  onOpenMenu: (event: MouseEvent<HTMLElement>, entry: FileEntry) => void;
  onDragStartEntry: (entry: FileEntry) => void;
  onDragEndEntry: () => void;
  onDragOverDirectory: (event: DragEvent<HTMLElement>, entry: FileEntry) => void;
  onDropDirectory: (event: DragEvent<HTMLElement>, entry: FileEntry) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      className={cn(
        "nl-file-tree__row",
        isSelected && "nl-file-tree__row--selected",
        isDropTarget && "nl-file-tree__row--drop"
      )}
      style={{ paddingLeft: `calc(${depth} * 0.95rem + 0.65rem)` }}
      onClick={() => onSelect(entry)}
      onDoubleClick={() => onToggle(entry)}
      onContextMenu={(event) => onOpenMenu(event, entry)}
      onDragStart={() => onDragStartEntry(entry)}
      onDragEnd={onDragEndEntry}
      onDragOver={(event) => onDragOverDirectory(event, entry)}
      onDrop={(event) => onDropDirectory(event, entry)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggle(entry);
        }
      }}
    >
      <span className="nl-file-tree__chevron">{isExpanded ? "▾" : "▸"}</span>
      <span className="nl-file-tree__icon-wrap">
        <FolderIcon className="nl-file-tree__icon nl-file-tree__icon--folder" />
      </span>
      <span className="nl-file-tree__label">{entry.name}</span>
    </div>
  );
}

function ExplorerTreeBranch({
  path,
  depth,
  entriesByPath,
  expandedPaths,
  loadingPaths,
  selectedPath,
  dropTargetPath,
  onSelect,
  onToggle,
  onOpenMenu,
  onDragStartEntry,
  onDragEndEntry,
  onDragOverDirectory,
  onDropDirectory,
}: {
  path: string;
  depth: number;
  entriesByPath: Record<string, FileEntry[]>;
  expandedPaths: Set<string>;
  loadingPaths: Set<string>;
  selectedPath: string | null;
  dropTargetPath: string | null;
  onSelect: (entry: FileEntry) => void;
  onToggle: (entry: FileEntry) => void;
  onOpenMenu: (event: MouseEvent<HTMLElement>, entry: FileEntry) => void;
  onDragStartEntry: (entry: FileEntry) => void;
  onDragEndEntry: () => void;
  onDragOverDirectory: (event: DragEvent<HTMLElement>, entry: FileEntry) => void;
  onDropDirectory: (event: DragEvent<HTMLElement>, entry: FileEntry) => void;
}) {
  const entries = (entriesByPath[path] ?? []).filter((entry) => entry.isDirectory);
  return (
    <>
      {entries.map((entry) => {
        const isExpanded = expandedPaths.has(entry.path);
        const isChildLoading = loadingPaths.has(entry.path);
        return (
          <div key={entry.path}>
            <ExplorerTreeRow
              entry={entry}
              depth={depth}
              isExpanded={isExpanded}
              isSelected={selectedPath === entry.path}
              isDropTarget={dropTargetPath === entry.path}
              onSelect={onSelect}
              onToggle={onToggle}
              onOpenMenu={onOpenMenu}
              onDragStartEntry={onDragStartEntry}
              onDragEndEntry={onDragEndEntry}
              onDragOverDirectory={onDragOverDirectory}
              onDropDirectory={onDropDirectory}
            />
            {isExpanded ? (
              <ExplorerTreeBranch
                path={entry.path}
                depth={depth + 1}
                entriesByPath={entriesByPath}
                expandedPaths={expandedPaths}
                loadingPaths={loadingPaths}
                selectedPath={selectedPath}
                dropTargetPath={dropTargetPath}
                onSelect={onSelect}
                onToggle={onToggle}
                onOpenMenu={onOpenMenu}
                onDragStartEntry={onDragStartEntry}
                onDragEndEntry={onDragEndEntry}
                onDragOverDirectory={onDragOverDirectory}
                onDropDirectory={onDropDirectory}
              />
            ) : null}
            {isExpanded && isChildLoading ? (
              <div
                className="nl-file-tree__hint"
                style={{ paddingLeft: `calc(${depth + 1} * 0.95rem + 1.85rem)` }}
              >
                Loading...
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

export function FileExplorerPanel({
  listing,
  isLoading,
  canGoBack,
  canGoForward,
  canGoUp,
  canPreviewEntry,
  canOpenInTextEditor,
  onNavigate,
  onNavigateBack,
  onNavigateForward,
  onNavigateUp,
  onOpenEntry,
  onPreviewEntry,
  onOpenInTextEditor,
  onDownloadEntry,
  onRefresh,
  onCreateDirectory,
  onUpload,
  onRename,
  onMove,
  onDelete,
  onSetAsBackground,
}: {
  listing: DirectoryListing | null;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  canGoUp: boolean;
  canPreviewEntry: (entry: FileEntry) => boolean;
  canOpenInTextEditor: (entry: FileEntry) => boolean;
  onNavigate: (path: string) => void;
  onNavigateBack: () => void;
  onNavigateForward: () => void;
  onNavigateUp: () => void;
  onOpenEntry: (entry: FileEntry) => void;
  onPreviewEntry: (entry: FileEntry) => void;
  onOpenInTextEditor: (entry: FileEntry) => void;
  onDownloadEntry: (entry: FileEntry) => void;
  onRefresh: () => void;
  onCreateDirectory: (name: string) => Promise<void>;
  onUpload: (files: FileList, destinationPath: string) => Promise<void>;
  onRename: (entry: FileEntry, name: string) => Promise<void>;
  onMove: (entry: FileEntry, destination: string) => Promise<void>;
  onDelete: (entry: FileEntry) => Promise<void>;
  onSetAsBackground: (entry: FileEntry) => Promise<void>;
}) {
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  const [viewMode, setViewMode] = useState<ExplorerViewMode>("icon");
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [anchorPath, setAnchorPath] = useState<string | null>(null);
  const [selectedTreePath, setSelectedTreePath] = useState<string | null>(null);
  const [entriesByPath, setEntriesByPath] = useState<Record<string, FileEntry[]>>({});
  const [expandedPaths, setExpandedPaths] = useState<string[]>([]);
  const [loadingPaths, setLoadingPaths] = useState<string[]>([]);
  const [draggedPaths, setDraggedPaths] = useState<string[]>([]);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [contextMenuState, setContextMenuState] = useState<ContextMenuState | null>(null);
  const [showHiddenEntries, setShowHiddenEntries] = useState(false);
  const [favoritePaths, setFavoritePaths] = useState<string[]>(DEFAULT_FAVORITE_PATHS);

  const currentPath = listing?.path ?? "";
  const orderedEntries = useMemo(() => sortEntries(listing?.entries ?? []), [listing?.entries]);
  const visibleEntriesByPath = useMemo(() => {
    if (showHiddenEntries) {
      return entriesByPath;
    }

    return Object.fromEntries(
      Object.entries(entriesByPath).map(([path, entries]) => [
        path,
        entries.filter((entry) => !isHiddenEntry(entry)),
      ])
    );
  }, [entriesByPath, showHiddenEntries]);
  const visibleEntries = useMemo(
    () => (showHiddenEntries ? orderedEntries : orderedEntries.filter((entry) => !isHiddenEntry(entry))),
    [orderedEntries, showHiddenEntries]
  );
  const breadcrumbs = useMemo(() => getPathSegments(currentPath), [currentPath]);
  const currentDirectoryLabel = useMemo(() => formatPathLabel(currentPath), [currentPath]);
  const selectedPathSet = useMemo(() => new Set(selectedPaths), [selectedPaths]);
  const expandedPathSet = useMemo(() => new Set(expandedPaths), [expandedPaths]);
  const loadingPathSet = useMemo(() => new Set(loadingPaths), [loadingPaths]);
  const entryByPath = useMemo(() => {
    const map = new Map<string, FileEntry>();
    Object.values(entriesByPath).forEach((entries) => {
      entries.forEach((entry) => map.set(entry.path, entry));
    });
    return map;
  }, [entriesByPath]);
  const favoriteItems = useMemo(() => {
    const seen = new Set<string>();
    const items: Array<{ path: string; label: string; entry: FileEntry }> = [];

    favoritePaths.forEach((rawPath) => {
      const path = normalizePath(rawPath);
      if (seen.has(path)) {
        return;
      }
      seen.add(path);

      const existingEntry = entryByPath.get(path);
      const label =
        path === ""
          ? "Workspace"
          : existingEntry?.name || path.split("/").filter(Boolean).pop() || path;

      items.push({
        path,
        label,
        entry: existingEntry ?? createDirectoryEntry(path, label),
      });
    });

    return items;
  }, [entryByPath, favoritePaths]);

  async function loadDirectory(path: string, options?: { force?: boolean }) {
    if (!options?.force && (path in entriesByPath || loadingPaths.includes(path))) {
      return;
    }

    setLoadingPaths((current) => (current.includes(path) ? current : [...current, path]));
    try {
      const nextListing = await listFiles(path);
      setEntriesByPath((current) => ({
        ...current,
        [path]: sortEntries(nextListing.entries),
      }));
    } finally {
      setLoadingPaths((current) => current.filter((value) => value !== path));
    }
  }

  async function refreshTreePath(path: string) {
    const nextListing = await listFiles(path);
    setEntriesByPath((current) => ({
      ...current,
      [path]: sortEntries(nextListing.entries),
    }));
  }

  useEffect(() => {
    setEntriesByPath((current) => ({
      ...current,
      [currentPath]: orderedEntries,
    }));
  }, [currentPath, orderedEntries]);

  useEffect(() => {
    void loadDirectory("");
  }, []);

  useEffect(() => {
    const ancestors = getAncestorPaths(currentPath);
    setExpandedPaths((current) => Array.from(new Set([...current, ...ancestors])));
    setSelectedTreePath(currentPath || "");

    const neededPaths = new Set<string>(["", ...ancestors]);
    neededPaths.forEach((path) => {
      void loadDirectory(path);
    });
  }, [currentPath]);

  useEffect(() => {
    const raw = window.localStorage.getItem(SHOW_HIDDEN_STORAGE_KEY);
    if (raw === "1") {
      setShowHiddenEntries(true);
    } else if (raw === "0") {
      setShowHiddenEntries(false);
    }
  }, []);

  useEffect(() => {
    const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return;
      }

      const normalized = parsed
        .filter((value): value is string => typeof value === "string")
        .map((value) => normalizePath(value));
      const next = Array.from(new Set([...DEFAULT_FAVORITE_PATHS, ...normalized]));
      setFavoritePaths(next);
    } catch {
      // Ignore malformed local storage values.
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      SHOW_HIDDEN_STORAGE_KEY,
      showHiddenEntries ? "1" : "0"
    );
  }, [showHiddenEntries]);

  useEffect(() => {
    window.localStorage.setItem(
      FAVORITES_STORAGE_KEY,
      JSON.stringify(Array.from(new Set([...DEFAULT_FAVORITE_PATHS, ...favoritePaths])))
    );
  }, [favoritePaths]);

  useEffect(() => {
    const validPaths = new Set(visibleEntries.map((entry) => entry.path));
    setSelectedPaths((current) => current.filter((path) => validPaths.has(path)));
    if (anchorPath && !validPaths.has(anchorPath)) {
      setAnchorPath(null);
    }
  }, [anchorPath, visibleEntries]);

  useEffect(() => {
    if (!contextMenuState) {
      return;
    }

    const handlePointerDown = () => setContextMenuState(null);
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenuState(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [contextMenuState]);

  useEffect(() => {
    if (!contextMenuState) {
      return;
    }

    const containerNode = containerRef.current;
    const menuNode = contextMenuRef.current;
    if (!containerNode || !menuNode) {
      return;
    }

    const maxX = Math.max(
      CONTEXT_MENU_MARGIN_PX,
      containerNode.clientWidth - menuNode.offsetWidth - CONTEXT_MENU_MARGIN_PX
    );
    const maxY = Math.max(
      CONTEXT_MENU_MARGIN_PX,
      containerNode.clientHeight - menuNode.offsetHeight - CONTEXT_MENU_MARGIN_PX
    );
    const nextX = Math.min(Math.max(contextMenuState.x, CONTEXT_MENU_MARGIN_PX), maxX);
    const nextY = Math.min(Math.max(contextMenuState.y, CONTEXT_MENU_MARGIN_PX), maxY);

    if (nextX === contextMenuState.x && nextY === contextMenuState.y) {
      return;
    }

    setContextMenuState((previous) =>
      previous ? { ...previous, x: nextX, y: nextY } : previous
    );
  }, [contextMenuState]);

  const commitSelection = (
    entry: FileEntry,
    event?: Pick<MouseEvent<HTMLElement>, "metaKey" | "ctrlKey" | "shiftKey">
  ) => {
    const orderedPaths = visibleEntries.map((candidate) => candidate.path);

    if (event?.shiftKey && anchorPath && orderedPaths.includes(anchorPath)) {
      const anchorIndex = orderedPaths.indexOf(anchorPath);
      const entryIndex = orderedPaths.indexOf(entry.path);
      if (anchorIndex !== -1 && entryIndex !== -1) {
        const [start, end] =
          anchorIndex <= entryIndex ? [anchorIndex, entryIndex] : [entryIndex, anchorIndex];
        setSelectedPaths(orderedPaths.slice(start, end + 1));
        return;
      }
    }

    if (event?.metaKey || event?.ctrlKey) {
      if (selectedPathSet.has(entry.path)) {
        const nextPaths = selectedPaths.filter((path) => path !== entry.path);
        setSelectedPaths(nextPaths);
        setAnchorPath(nextPaths[nextPaths.length - 1] ?? null);
        return;
      }
      setSelectedPaths([...selectedPaths, entry.path]);
      setAnchorPath(entry.path);
      return;
    }

    setSelectedPaths([entry.path]);
    setAnchorPath(entry.path);
  };

  const openContextMenu = (event: MouseEvent<HTMLElement>, entry: FileEntry | null) => {
    event.preventDefault();
    event.stopPropagation();

    if (entry) {
      setSelectedTreePath(entry.path);
      if (!selectedPathSet.has(entry.path) && !entry.isDirectory) {
        setSelectedPaths([entry.path]);
        setAnchorPath(entry.path);
      }
    }

    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds) {
      return;
    }

    setContextMenuState({
      entry,
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    });
  };

  const canDropToPath = (destinationPath: string): boolean => {
    if (draggedPaths.length === 0) {
      return false;
    }

    return draggedPaths.every(
      (sourcePath) => !isInvalidDestination(sourcePath, destinationPath)
    );
  };

  const clearDragState = () => {
    setDraggedPaths([]);
    setDropTargetPath(null);
  };

  const handleDragStart = (entry: FileEntry) => {
    const nextDraggedPaths =
      selectedPathSet.has(entry.path) && selectedPaths.length > 0
        ? selectedPaths
        : [entry.path];

    if (!selectedPathSet.has(entry.path) && !entry.isDirectory) {
      setSelectedPaths([entry.path]);
      setAnchorPath(entry.path);
    }

    setDraggedPaths(nextDraggedPaths);
  };

  const handleDropToPath = async (event: DragEvent<HTMLElement>, destinationPath: string) => {
    const droppedFiles = Array.from(event.dataTransfer.files ?? []);
    if (droppedFiles.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      await onUpload(toFileList(droppedFiles), destinationPath);
      await refreshTreePath(destinationPath);
      if (destinationPath !== currentPath) {
        void loadDirectory(destinationPath, { force: true });
      }
      clearDragState();
      return;
    }

    if (!canDropToPath(destinationPath)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    for (const sourcePath of draggedPaths) {
      const sourceEntry =
        entryByPath.get(sourcePath) ??
        orderedEntries.find((entry) => entry.path === sourcePath);
      if (!sourceEntry) {
        continue;
      }
      const sourceParentPath = getParentPath(sourceEntry.path);
      await onMove(sourceEntry, destinationPath);
      await refreshTreePath(sourceParentPath);
    }

    await refreshTreePath(destinationPath);
    setSelectedPaths([]);
    setAnchorPath(null);
    clearDragState();
  };

  const handleTreeSelect = (entry: FileEntry) => {
    setSelectedTreePath(entry.path);
    onNavigate(entry.path);
  };

  const addFavorite = (path: string) => {
    const normalized = normalizePath(path);
    setFavoritePaths((current) =>
      current.includes(normalized) ? current : [...current, normalized]
    );
  };

  const removeFavorite = (path: string) => {
    const normalized = normalizePath(path);
    if (normalized === "") {
      return;
    }
    setFavoritePaths((current) => current.filter((value) => value !== normalized));
  };

  const handleTreeToggle = (entry: FileEntry) => {
    setExpandedPaths((current) =>
      current.includes(entry.path)
        ? current.filter((path) => path !== entry.path)
        : [...current, entry.path]
    );
    void loadDirectory(entry.path);
    onNavigate(entry.path);
  };

  const handleTreeDragOver = (event: DragEvent<HTMLElement>, entry: FileEntry) => {
    if (eventHasExternalFiles(event) || canDropToPath(entry.path)) {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = eventHasExternalFiles(event) ? "copy" : "move";
      setDropTargetPath(entry.path);
    }
  };

  const contextEntry = contextMenuState?.entry ?? null;
  const contextEntryPath = contextEntry?.isDirectory
    ? normalizePath(contextEntry.path)
    : null;
  const contextEntryIsFavorite = Boolean(
    contextEntryPath !== null && favoritePaths.includes(contextEntryPath)
  );
  const currentPathIsFavorite = favoritePaths.includes(currentPath);
  const isRootContextEntry = contextEntry?.isDirectory && contextEntry.path === "";
  const canSetContextEntryAsBackground = Boolean(
    contextEntry &&
      !contextEntry.isDirectory &&
      contextEntry.mimeType.startsWith("image/")
  );
  const previewable = Boolean(
    contextEntry && !contextEntry.isDirectory && canPreviewEntry(contextEntry)
  );
  const editableInTextEditor = Boolean(
    contextEntry && !contextEntry.isDirectory && canOpenInTextEditor(contextEntry)
  );

  const renderMenuAction = (
    label: string,
    onClick: () => void | Promise<void>,
    options?: { destructive?: boolean }
  ) => (
    <button
      type="button"
      className={cn(
        "nl-context-menu__item",
        options?.destructive && "nl-context-menu__item--danger"
      )}
      onClick={() => {
        void onClick();
        setContextMenuState(null);
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      ref={containerRef}
      className="nl-panel nl-files"
      onContextMenu={(event) => openContextMenu(event, null)}
    >
      <input
        ref={uploadInputRef}
        type="file"
        multiple
        className="nl-hidden-input"
        onChange={async (event) => {
          const files = event.target.files;
          event.target.value = "";
          if (files?.length) {
            await onUpload(files, currentPath);
            await refreshTreePath(currentPath);
          }
        }}
      />

      <aside className="nl-files__sidebar">
        <div className="nl-files__sidebar-header">
          <div className="nl-files__sidebar-title-row">
            <strong>File Explorer</strong>
            <span className="nl-files__path-chip">{currentDirectoryLabel}</span>
          </div>
        </div>

        <div className="nl-files__sidebar-body">
          <div className="nl-files__section">
            <div className="nl-files__section-header">
              <span className="nl-files__section-label">Favorites</span>
              <span className="nl-files__section-count">{favoriteItems.length}</span>
            </div>
            <div className="nl-files__shortcuts">
              {favoriteItems.map((item) => {
                const isActive = item.path === currentPath;
                return (
                  <button
                    key={item.path}
                    type="button"
                    className={cn(
                      "nl-files__shortcut",
                      isActive && "nl-files__shortcut--active",
                      dropTargetPath === item.path && "nl-files__shortcut--drop"
                    )}
                    onClick={() => onNavigate(item.path)}
                    onContextMenu={(event) => openContextMenu(event, item.entry)}
                    onDragOver={(event) => {
                      if (eventHasExternalFiles(event) || canDropToPath(item.path)) {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = eventHasExternalFiles(event)
                          ? "copy"
                          : "move";
                        setDropTargetPath(item.path);
                      }
                    }}
                    onDragLeave={() => {
                      if (dropTargetPath === item.path) {
                        setDropTargetPath(null);
                      }
                    }}
                    onDrop={(event) => void handleDropToPath(event, item.path)}
                  >
                    <span className="nl-files__shortcut-icon">
                      <FolderIcon className="nl-file-tree__icon nl-file-tree__icon--folder" />
                    </span>
                    <span className="nl-file-tree__label">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="nl-files__section">
            <div className="nl-files__section-header">
              <span className="nl-files__section-label">Navigation</span>
            </div>
            <div className="nl-file-tree">
              <button
                type="button"
                className={cn(
                  "nl-file-tree__row nl-file-tree__row--root",
                  currentPath === "" && "nl-file-tree__row--selected",
                  dropTargetPath === "" && "nl-file-tree__row--drop"
                )}
                onClick={() => onNavigate("")}
                onContextMenu={(event) =>
                  openContextMenu(event, createDirectoryEntry("", "~"))
                }
                onDragOver={(event) => {
                  if (eventHasExternalFiles(event) || canDropToPath("")) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = eventHasExternalFiles(event)
                      ? "copy"
                      : "move";
                    setDropTargetPath("");
                  }
                }}
                onDragLeave={() => {
                  if (dropTargetPath === "") {
                    setDropTargetPath(null);
                  }
                }}
                onDrop={(event) => void handleDropToPath(event, "")}
              >
                <span className="nl-file-tree__chevron">{currentPath === "" ? "▾" : "▸"}</span>
                <span className="nl-file-tree__icon-wrap">
                  <FolderIcon className="nl-file-tree__icon nl-file-tree__icon--folder" />
                </span>
                <span className="nl-file-tree__label">Workspace</span>
              </button>

              <ExplorerTreeBranch
                path=""
                depth={0}
                entriesByPath={visibleEntriesByPath}
                expandedPaths={expandedPathSet}
                loadingPaths={loadingPathSet}
                selectedPath={selectedTreePath}
                dropTargetPath={dropTargetPath}
                onSelect={handleTreeSelect}
                onToggle={handleTreeToggle}
                onOpenMenu={openContextMenu}
                onDragStartEntry={handleDragStart}
                onDragEndEntry={clearDragState}
                onDragOverDirectory={handleTreeDragOver}
                onDropDirectory={(event, entry) => void handleDropToPath(event, entry.path)}
              />

              {loadingPathSet.has("") ? (
                <div className="nl-file-tree__hint">Loading folders...</div>
              ) : null}
            </div>
          </div>
        </div>
      </aside>

      <section className="nl-files__main">
        <div className="nl-panel__toolbar nl-files__toolbar">
          <div className="nl-toolbar-group">
            <div className="nl-nav-buttons">
              <button
                type="button"
                aria-label="Back"
                className="nl-nav-button"
                disabled={!canGoBack}
                onClick={onNavigateBack}
              >
                <ChevronLeftIcon />
              </button>
              <button
                type="button"
                aria-label="Forward"
                className="nl-nav-button"
                disabled={!canGoForward}
                onClick={onNavigateForward}
              >
                <ChevronRightIcon />
              </button>
              <button
                type="button"
                aria-label="Up"
                className="nl-nav-button"
                disabled={!canGoUp}
                onClick={onNavigateUp}
              >
                <ChevronUpIcon />
              </button>
            </div>

            <div className="nl-breadcrumbs">
              <button type="button" className="nl-breadcrumb" onClick={() => onNavigate("")}>
                ~
              </button>
              {breadcrumbs.map((crumb) => (
                <button
                  key={crumb.path}
                  type="button"
                  className="nl-breadcrumb"
                  onClick={() => onNavigate(crumb.path)}
                >
                  {crumb.label}
                </button>
              ))}
            </div>
          </div>

          <div className="nl-toolbar-actions">
            <div className="nl-files__view-toggle">
              <button
                type="button"
                aria-label="Icon view"
                aria-pressed={viewMode === "icon"}
                title="Icon view"
                className={cn(
                  "nl-files__view-button",
                  viewMode === "icon" && "nl-files__view-button--active"
                )}
                onClick={() => setViewMode("icon")}
              >
                <GridIcon />
              </button>
              <button
                type="button"
                aria-label="List view"
                aria-pressed={viewMode === "list"}
                title="List view"
                className={cn(
                  "nl-files__view-button",
                  viewMode === "list" && "nl-files__view-button--active"
                )}
                onClick={() => setViewMode("list")}
              >
                <ListIcon />
              </button>
            </div>

            <button
              type="button"
              className="nl-icon-button"
              aria-label="New folder"
              onClick={async () => {
                const name = window.prompt("New folder name");
                if (!name) {
                  return;
                }
                await onCreateDirectory(name);
                await refreshTreePath(currentPath);
              }}
            >
              <PlusIcon />
            </button>
            <button
              type="button"
              className="nl-icon-button"
              aria-label="Upload files"
              onClick={() => uploadInputRef.current?.click()}
            >
              <UploadIcon />
            </button>
            <button
              type="button"
              className="nl-icon-button"
              aria-label="Refresh"
              onClick={async () => {
                onRefresh();
                await refreshTreePath(currentPath);
              }}
            >
              <RefreshIcon />
            </button>
          </div>
        </div>

        <div className="nl-files__status">
          {selectedPaths.length > 1
            ? `${selectedPaths.length} items selected`
            : selectedPaths.length === 1
              ? "1 item selected"
              : `${currentDirectoryLabel}${showHiddenEntries ? " • hidden shown" : ""}`}
        </div>

        <div
          className={cn(
            "nl-files__content",
            dropTargetPath === currentPath && "nl-files__content--drop"
          )}
          onClick={() => {
            setSelectedPaths([]);
            setAnchorPath(null);
          }}
          onDragOver={(event) => {
            if (eventHasExternalFiles(event) || canDropToPath(currentPath)) {
              event.preventDefault();
              event.dataTransfer.dropEffect = eventHasExternalFiles(event) ? "copy" : "move";
              setDropTargetPath(currentPath);
            }
          }}
          onDragLeave={() => {
            if (dropTargetPath === currentPath) {
              setDropTargetPath(null);
            }
          }}
          onDrop={(event) => void handleDropToPath(event, currentPath)}
        >
          {isLoading ? (
            <div className="nl-empty-state nl-files__empty">Loading folder contents...</div>
          ) : visibleEntries.length === 0 ? (
            <div className="nl-empty-state nl-files__empty">
              {orderedEntries.length > 0 && !showHiddenEntries
                ? "Only hidden files are in this folder. Use the context menu to show hidden files and folders."
                : "This folder is empty. Drag files here to upload them, or create a new folder."}
            </div>
          ) : viewMode === "icon" ? (
            <div className="nl-file-grid">
              {visibleEntries.map((entry) => {
                const isSelected = selectedPathSet.has(entry.path);
                const isDropTarget = dropTargetPath === entry.path;
                return (
                  <button
                    key={entry.path}
                    type="button"
                    draggable
                    className={cn(
                      "nl-file-card",
                      isSelected && "nl-file-card--selected",
                      isDropTarget && "nl-file-card--drop"
                    )}
                    onClick={(event) => {
                      event.stopPropagation();
                      commitSelection(entry, event);
                    }}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      onOpenEntry(entry);
                    }}
                    onContextMenu={(event) => openContextMenu(event, entry)}
                    onDragStart={() => handleDragStart(entry)}
                    onDragEnd={clearDragState}
                    onDragOver={(event) => {
                      if (
                        entry.isDirectory &&
                        (eventHasExternalFiles(event) || canDropToPath(entry.path))
                      ) {
                        event.preventDefault();
                        event.stopPropagation();
                        event.dataTransfer.dropEffect = eventHasExternalFiles(event)
                          ? "copy"
                          : "move";
                        setDropTargetPath(entry.path);
                      }
                    }}
                    onDragLeave={() => {
                      if (dropTargetPath === entry.path) {
                        setDropTargetPath(null);
                      }
                    }}
                    onDrop={(event) => {
                      if (entry.isDirectory) {
                        void handleDropToPath(event, entry.path);
                      }
                    }}
                  >
                    <span className="nl-file-card__icon">
                      {entry.isDirectory ? (
                        <FolderIcon className="nl-file-card__glyph nl-file-card__glyph--folder" />
                      ) : (
                        <FileIcon className="nl-file-card__glyph" />
                      )}
                    </span>
                    {!entry.isDirectory && canPreviewEntry(entry) ? (
                      <span className="nl-file-card__badge">Preview</span>
                    ) : null}
                    <span className="nl-file-card__name">{entry.name}</span>
                    <span className="nl-file-card__meta">
                      {entry.isDirectory ? "Folder" : formatBytes(entry.size)}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="nl-file-table">
              <div className="nl-file-table__header">
                <span>Name</span>
                <span>Size</span>
                <span>Modified</span>
              </div>
              <div className="nl-file-table__body">
                {visibleEntries.map((entry) => {
                  const isSelected = selectedPathSet.has(entry.path);
                  const isDropTarget = dropTargetPath === entry.path;
                  return (
                    <button
                      key={entry.path}
                      type="button"
                      draggable
                      className={cn(
                        "nl-file-table__row",
                        isSelected && "nl-file-table__row--selected",
                        isDropTarget && "nl-file-table__row--drop"
                      )}
                      onClick={(event) => {
                        event.stopPropagation();
                        commitSelection(entry, event);
                      }}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        onOpenEntry(entry);
                      }}
                      onContextMenu={(event) => openContextMenu(event, entry)}
                      onDragStart={() => handleDragStart(entry)}
                      onDragEnd={clearDragState}
                      onDragOver={(event) => {
                        if (
                          entry.isDirectory &&
                          (eventHasExternalFiles(event) || canDropToPath(entry.path))
                        ) {
                          event.preventDefault();
                          event.stopPropagation();
                          event.dataTransfer.dropEffect = eventHasExternalFiles(event)
                            ? "copy"
                            : "move";
                          setDropTargetPath(entry.path);
                        }
                      }}
                      onDragLeave={() => {
                        if (dropTargetPath === entry.path) {
                          setDropTargetPath(null);
                        }
                      }}
                      onDrop={(event) => {
                        if (entry.isDirectory) {
                          void handleDropToPath(event, entry.path);
                        }
                      }}
                    >
                      <span className="nl-file-table__name">
                        {entry.isDirectory ? (
                          <FolderIcon className="nl-file-table__glyph nl-file-table__glyph--folder" />
                        ) : (
                          <FileIcon className="nl-file-table__glyph" />
                        )}
                        <span>{entry.name}</span>
                      </span>
                      <span>{entry.isDirectory ? "Folder" : formatBytes(entry.size)}</span>
                      <span>{formatModifiedAt(entry.modifiedAt)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </section>

      {contextMenuState ? (
        <div
          ref={contextMenuRef}
          className="nl-context-menu"
          style={{ left: contextMenuState.x, top: contextMenuState.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {contextEntry?.isDirectory
            ? renderMenuAction("Open Folder", () => {
                onNavigate(contextEntry.path);
                setExpandedPaths((current) =>
                  current.includes(contextEntry.path)
                    ? current
                    : [...current, contextEntry.path]
                );
                void loadDirectory(contextEntry.path);
              })
            : contextEntry
              ? renderMenuAction("Open", () => onOpenEntry(contextEntry))
              : null}

          {contextEntry?.isDirectory
            ? contextEntryIsFavorite
              ? renderMenuAction("Remove from Favorites", () =>
                  removeFavorite(contextEntry.path)
                )
              : renderMenuAction("Add to Favorites", () => addFavorite(contextEntry.path))
            : null}

          {previewable
            ? renderMenuAction("Preview", () => onPreviewEntry(contextEntry as FileEntry))
            : null}

          {editableInTextEditor
            ? renderMenuAction("Open in Text Editor", () =>
                onOpenInTextEditor(contextEntry as FileEntry)
              )
            : null}

          {canSetContextEntryAsBackground
            ? renderMenuAction("Set as Background", () =>
                onSetAsBackground(contextEntry as FileEntry)
              )
            : null}

          {contextEntry && !contextEntry.isDirectory
            ? renderMenuAction("Download", () => onDownloadEntry(contextEntry))
            : null}

          {contextEntry
            ? renderMenuAction("Copy Path", () =>
                navigator.clipboard.writeText(contextEntry.path || "~")
              )
            : null}

          {contextEntry && !isRootContextEntry
            ? renderMenuAction("Rename", async () => {
                const name = window.prompt("Rename to", contextEntry.name);
                if (!name || name === contextEntry.name) {
                  return;
                }
                const parentPath = getParentPath(contextEntry.path);
                await onRename(contextEntry, name);
                await refreshTreePath(parentPath);
              })
            : renderMenuAction("New Folder", async () => {
                const name = window.prompt("New folder name");
                if (!name) {
                  return;
                }
                await onCreateDirectory(name);
                await refreshTreePath(currentPath);
              })}

          {contextEntry && !isRootContextEntry
            ? renderMenuAction("Move...", async () => {
                const destination = window.prompt("Move to folder", currentPath);
                if (destination === null) {
                  return;
                }
                const parentPath = getParentPath(contextEntry.path);
                await onMove(contextEntry, destination);
                await refreshTreePath(parentPath);
                await refreshTreePath(destination);
              })
            : null}

          {contextEntry && !isRootContextEntry
            ? renderMenuAction(
                "Delete",
                async () => {
                  if (!window.confirm(`Delete ${contextEntry.name}? This cannot be undone.`)) {
                    return;
                  }
                  const parentPath = getParentPath(contextEntry.path);
                  await onDelete(contextEntry);
                  await refreshTreePath(parentPath);
                },
                { destructive: true }
              )
            : null}

          {!contextEntry
            ? currentPathIsFavorite
              ? renderMenuAction("Remove from Favorites", () =>
                  removeFavorite(currentPath)
                )
              : renderMenuAction("Add to Favorites", () =>
                  addFavorite(currentPath)
                )
            : null}

          {!contextEntry
            ? renderMenuAction(
                showHiddenEntries ? "Hide Hidden Items" : "Show Hidden Items",
                () => setShowHiddenEntries((current) => !current)
              )
            : null}

          {!contextEntry
            ? renderMenuAction("Refresh", async () => {
                await refreshTreePath("");
                await refreshTreePath(currentPath);
              })
            : null}
        </div>
      ) : null}
    </div>
  );
}
