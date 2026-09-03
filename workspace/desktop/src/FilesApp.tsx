import {
  Archive, ArrowUpDown, ChevronRight, Clock3, Cloud, Code2, Copy, Download, File,
  Eye, FileImage, FilePlus2, FileText, Folder, FolderOpen, FolderPlus, Grid2X2,
  HardDrive, Home, LayoutList, LoaderCircle, Menu, MoreHorizontal, Plus,
  RefreshCw, Search, Sparkles, Star, Trash2, Upload, Users, X,
  type LucideIcon,
} from "lucide-react";
import {
  type CSSProperties, type DragEvent, type FormEvent, type KeyboardEvent,
  type MouseEvent, useCallback, useEffect, useMemo, useRef, useState,
} from "react";

import {
  createWorkspaceFolder, createWorkspaceTextFile, deleteWorkspaceEntry,
  listWorkspaceDirectory, subscribeWorkspaceFiles, uploadWorkspaceFile,
  workspaceDownloadUrl, workspaceFileCanPreview, type WorkspaceEntry, type WorkspacePreviewFile,
} from "./filesApi";
import { readDeviceState, writeDeviceState } from "./deviceState";
import "./files-app.css";

export type WorkspaceFileKind = "folder" | "markdown" | "code" | "document" | "image" | "archive";
type Accent = "cyan" | "violet" | "pink" | "coral" | "amber" | "mint";

export type WorkspaceFile = {
  id: string;
  name: string;
  kind: WorkspaceFileKind;
  size: string;
  bytes: number | null;
  modified: string;
  modifiedAt: string;
  owner: string;
  ownerInitials: string;
  accent: Accent;
  shared: true;
  summary: string;
  path: string;
  relativePath: string;
  mimeType: string;
};

export type FilesAppProps = {
  notify?: (message: string) => void;
  onOpenFile?: (path: string) => void;
  onPreviewFile?: (file: WorkspacePreviewFile) => void;
  storageNamespace?: string;
  storageArea?: string;
};
type ViewMode = "list" | "grid";
type NavigationId = "home" | "recent" | "shared" | "starred" | "trash";
type ContextMenuState = { item: WorkspaceFile; x: number; y: number };

type FilesDeviceState = { currentPath: string; activeNav: NavigationId; view: ViewMode };

function filesDeviceState(storageNamespace: string | undefined, storageArea: string): FilesDeviceState {
  const stored = readDeviceState(storageNamespace, storageArea);
  if (!stored || typeof stored !== "object") return { currentPath: "", activeNav: "home", view: "list" };
  const value = stored as Record<string, unknown>;
  const navigation = ["home", "recent", "shared", "starred", "trash"].includes(String(value.activeNav)) ? value.activeNav as NavigationId : "home";
  return {
    currentPath: typeof value.currentPath === "string" && value.currentPath.length <= 4096 ? value.currentPath : "",
    activeNav: navigation,
    view: value.view === "grid" ? "grid" : "list",
  };
}

const NAV_ITEMS: { id: NavigationId; label: string; icon: LucideIcon }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "recent", label: "Recent", icon: Clock3 },
  { id: "shared", label: "Shared workspace", icon: Users },
  { id: "starred", label: "Starred", icon: Star },
  { id: "trash", label: "Trash", icon: Trash2 },
];

const KIND_ICONS: Record<WorkspaceFileKind, LucideIcon> = {
  folder: Folder, markdown: FileText, code: Code2, document: FileText,
  image: FileImage, archive: Archive,
};
const CODE_EXTENSIONS = new Set(["c", "cpp", "css", "go", "html", "java", "js", "jsx", "mjs", "php", "py", "rb", "rs", "sh", "sql", "ts", "tsx", "vue"]);
const IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "ico", "jpeg", "jpg", "png", "svg", "webp"]);
const ARCHIVE_EXTENSIONS = new Set(["7z", "bz2", "gz", "rar", "tar", "tgz", "xz", "zip"]);
const DOCUMENT_EXTENSIONS = new Set(["csv", "doc", "docx", "odt", "pdf", "ppt", "pptx", "rtf", "txt", "xls", "xlsx"]);
const ACCENTS: Accent[] = ["cyan", "violet", "pink", "coral", "amber", "mint"];

function kindFor(entry: WorkspaceEntry): WorkspaceFileKind {
  if (entry.type === "folder") return "folder";
  const extension = entry.name.includes(".") ? entry.name.split(".").pop()?.toLowerCase() ?? "" : "";
  if (["md", "mdx"].includes(extension)) return "markdown";
  if (CODE_EXTENSIONS.has(extension)) return "code";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (ARCHIVE_EXTENSIONS.has(extension)) return "archive";
  if (DOCUMENT_EXTENSIONS.has(extension)) return "document";
  return "document";
}

function accentFor(value: string): Accent {
  let hash = 0;
  for (const character of value) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return ACCENTS[Math.abs(hash) % ACCENTS.length];
}

function formatBytes(value: number | null): string {
  if (value === null) return "Folder";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value;
  let unit = -1;
  do { size /= 1024; unit += 1; } while (size >= 1024 && unit < units.length - 1);
  return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

function formatModified(value: string): string {
  const date = new Date(value);
  const difference = Date.now() - date.getTime();
  if (!Number.isFinite(difference)) return "Unknown";
  if (difference < 60_000) return "Just now";
  if (difference < 3_600_000) return `${Math.floor(difference / 60_000)} min ago`;
  if (difference < 86_400_000) return `${Math.floor(difference / 3_600_000)} hr ago`;
  if (difference < 604_800_000) return `${Math.floor(difference / 86_400_000)} days ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" }).format(date);
}

function kindLabel(kind: WorkspaceFileKind): string {
  return kind === "markdown" ? "Markdown" : `${kind[0].toUpperCase()}${kind.slice(1)}`;
}

function toWorkspaceFile(entry: WorkspaceEntry): WorkspaceFile {
  const kind = kindFor(entry);
  return {
    id: entry.path, name: entry.name, kind, size: formatBytes(entry.size), bytes: entry.size,
    modified: formatModified(entry.modifiedAt), modifiedAt: entry.modifiedAt,
    owner: "Team workspace", ownerInitials: "NL", accent: accentFor(entry.path), shared: true,
    summary: kind === "folder" ? "A shared folder in the Neural Labs developer workspace." : `${kindLabel(kind)} file stored in the shared developer workspace.`,
    path: `~/workspace/${entry.path}`, relativePath: entry.path,
    mimeType: entry.mimeType ?? "application/octet-stream",
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The file operation failed";
}

function sortWorkspaceFiles(files: WorkspaceFile[]): WorkspaceFile[] {
  return files.sort((left, right) =>
    Number(right.kind === "folder") - Number(left.kind === "folder") ||
    left.name.localeCompare(right.name));
}

function upsertWorkspaceFiles(current: WorkspaceFile[], entries: WorkspaceEntry[]): WorkspaceFile[] {
  const byPath = new Map(current.map((item) => [item.relativePath, item]));
  for (const entry of entries) byPath.set(entry.path, toWorkspaceFile(entry));
  return sortWorkspaceFiles([...byPath.values()]);
}

type DirectoryLoadOptions = {
  signal?: AbortSignal;
  background?: boolean;
  reportError?: boolean;
};

export function FilesApp({ notify, onOpenFile, onPreviewFile, storageNamespace, storageArea = "files" }: FilesAppProps) {
  const [initialUiState] = useState(() => filesDeviceState(storageNamespace, storageArea));
  const [currentPath, setCurrentPath] = useState(initialUiState.currentPath);
  const [items, setItems] = useState<WorkspaceFile[]>([]);
  const [activeNav, setActiveNav] = useState<NavigationId>(initialUiState.activeNav);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewMode>(initialUiState.view);
  const [selectedId, setSelectedId] = useState<string>();
  const [mobileNavigation, setMobileNavigation] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newMenu, setNewMenu] = useState<"nav" | "toolbar" | null>(null);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [fileDialogOpen, setFileDialogOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState>();
  const [dragging, setDragging] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const currentPathRef = useRef(currentPath);
  const directoryRequest = useRef(0);
  const notifyRef = useRef(notify);
  currentPathRef.current = currentPath;

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    notifyRef.current?.(message);
  }, []);

  useEffect(() => {
    notifyRef.current = notify;
  }, [notify]);

  useEffect(() => {
    writeDeviceState(storageNamespace, storageArea, { currentPath, activeNav, view } satisfies FilesDeviceState);
  }, [activeNav, currentPath, storageArea, storageNamespace, view]);

  const loadDirectory = useCallback(async (directoryPath: string, options: DirectoryLoadOptions = {}) => {
    const { signal, background = false, reportError = true } = options;
    const request = ++directoryRequest.current;
    if (background) setRefreshing(true);
    else setLoading(true);
    try {
      const directory = await listWorkspaceDirectory(directoryPath, signal);
      if (signal?.aborted || request !== directoryRequest.current || currentPathRef.current !== directoryPath) return;
      const next = directory.entries.map(toWorkspaceFile);
      setItems(next);
      setSelectedId((selected) => next.some((item) => item.id === selected) ? selected : next[0]?.id);
      if (!background) setNotice(undefined);
    } catch (error) {
      if ((error instanceof DOMException && error.name === "AbortError") ||
          request !== directoryRequest.current || currentPathRef.current !== directoryPath) return;
      if (!background) setItems([]);
      if (reportError) showNotice(errorMessage(error));
    } finally {
      if (!signal?.aborted && request === directoryRequest.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [showNotice]);

  useEffect(() => {
    const controller = new AbortController();
    void loadDirectory(currentPath, { signal: controller.signal });
    return () => controller.abort();
  }, [currentPath, loadDirectory]);

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    let refreshTimer: number | undefined;
    const unsubscribe = subscribeWorkspaceFiles(() => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        void loadDirectory(currentPathRef.current, { background: true, reportError: false });
      }, 80);
    });
    return () => {
      window.clearTimeout(refreshTimer);
      unsubscribe();
    };
  }, [loadDirectory]);

  useEffect(() => {
    const closeMenus = (event: PointerEvent) => {
      const target = event.target as Element;
      if (!target.closest(".files-create-menu-wrap")) setNewMenu(null);
      if (!target.closest(".files-context-menu")) setContextMenu(undefined);
    };
    const keyboard = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(undefined); setNewMenu(null); setFolderDialogOpen(false); setFileDialogOpen(false);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); searchRef.current?.focus();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault(); setNewMenu("toolbar");
      }
    };
    document.addEventListener("pointerdown", closeMenus);
    window.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("pointerdown", closeMenus);
      window.removeEventListener("keydown", keyboard);
    };
  }, []);

  const visibleItems = useMemo(() => {
    if (activeNav === "starred" || activeNav === "trash") return [];
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = normalizedQuery
      ? items.filter((item) => `${item.name} ${kindLabel(item.kind)}`.toLowerCase().includes(normalizedQuery))
      : [...items];
    if (activeNav === "recent") filtered.sort((left, right) => Date.parse(right.modifiedAt) - Date.parse(left.modifiedAt));
    return filtered;
  }, [activeNav, items, query]);

  const selected = items.find((item) => item.id === selectedId);
  const featuredFolders = items.filter((item) => item.kind === "folder").slice(0, 3);
  const pathSegments = currentPath ? currentPath.split("/") : [];
  const folderTitle = pathSegments.at(-1) || "Workspace";

  const chooseNavigation = (id: NavigationId) => {
    setActiveNav(id); setMobileNavigation(false); setQuery("");
    if (id === "home" || id === "shared") setCurrentPath("");
    if (id === "starred") showNotice("Starred files will become available with workspace metadata.");
    if (id === "trash") showNotice("V1 deletes files permanently after confirmation; a recoverable trash is coming later.");
  };

  const openItem = (item: WorkspaceFile) => {
    setContextMenu(undefined);
    if (item.kind === "folder") {
      setActiveNav("home"); setCurrentPath(item.relativePath); setQuery("");
    } else if (workspaceFileCanPreview(item.name) && onPreviewFile) {
      onPreviewFile({ name: item.name, path: item.relativePath, size: item.bytes ?? 0, mimeType: item.mimeType });
    } else if (onOpenFile) onOpenFile(item.relativePath);
    else showNotice(`${item.name} is ready to open in the Editor.`);
  };

  const navigateTo = (targetPath: string) => {
    setActiveNav("home"); setCurrentPath(targetPath); setQuery("");
  };

  const uploadFiles = async (uploadFiles: File[]) => {
    if (!uploadFiles.length || busy) return;
    const targetPath = currentPath;
    setBusy(true);
    let uploaded = 0;
    const created: WorkspaceEntry[] = [];
    const failures: string[] = [];
    for (const file of uploadFiles) {
      try {
        const result = await uploadWorkspaceFile(targetPath, file);
        created.push(result.item); uploaded += 1;
      }
      catch (error) { failures.push(`${file.name}: ${errorMessage(error)}`); }
    }
    if (created.length && currentPathRef.current === targetPath) {
      setItems((current) => upsertWorkspaceFiles(current, created));
      await loadDirectory(targetPath, { background: true, reportError: false });
    }
    setBusy(false);
    if (failures.length) showNotice(`${uploaded ? `${uploaded} uploaded. ` : ""}${failures[0]}${failures.length > 1 ? ` and ${failures.length - 1} more failed` : ""}`);
    else showNotice(`${uploaded} ${uploaded === 1 ? "file" : "files"} uploaded.`);
  };

  const submitFolder = async (event: FormEvent) => {
    event.preventDefault();
    const name = folderName.trim();
    if (!name || busy) return;
    const targetPath = currentPath;
    setBusy(true);
    try {
      const result = await createWorkspaceFolder(targetPath, name);
      setFolderDialogOpen(false); setFolderName("");
      if (currentPathRef.current === targetPath) {
        setItems((current) => upsertWorkspaceFiles(current, [result.item]));
        await loadDirectory(targetPath, { background: true, reportError: false });
      }
      showNotice(`Folder “${name}” created.`);
    } catch (error) { showNotice(errorMessage(error)); }
    finally { setBusy(false); }
  };

  const submitFile = async (event: FormEvent) => {
    event.preventDefault();
    const name = fileName.trim();
    if (!name || busy) return;
    const targetPath = currentPath;
    setBusy(true);
    try {
      const result = await createWorkspaceTextFile(targetPath, name);
      setFileDialogOpen(false); setFileName("");
      if (currentPathRef.current === targetPath) {
        setItems((current) => upsertWorkspaceFiles(current, [result.item]));
        await loadDirectory(targetPath, { background: true, reportError: false });
      }
      showNotice(`File “${name}” created.`);
      onOpenFile?.(result.item.path);
    } catch (error) { showNotice(errorMessage(error)); }
    finally { setBusy(false); }
  };

  const deleteItem = async (item: WorkspaceFile) => {
    setContextMenu(undefined);
    const detail = item.kind === "folder" ? " and everything inside it" : "";
    if (!window.confirm(`Permanently delete “${item.name}”${detail}? This cannot be undone.`)) return;
    const targetPath = currentPath;
    setBusy(true);
    try {
      await deleteWorkspaceEntry(item.relativePath);
      if (currentPathRef.current === targetPath) {
        setItems((current) => current.filter((candidate) => candidate.id !== item.id));
        setSelectedId((selected) => selected === item.id ? undefined : selected);
        await loadDirectory(targetPath, { background: true, reportError: false });
      }
      showNotice(`“${item.name}” was permanently deleted.`);
    } catch (error) { showNotice(errorMessage(error)); }
    finally { setBusy(false); }
  };

  const copyItemPath = async (item: WorkspaceFile) => {
    setContextMenu(undefined);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable");
      await navigator.clipboard.writeText(item.path);
      showNotice(`Copied ${item.path}`);
    } catch {
      showNotice("The path could not be copied. Check this browser's clipboard permission.");
    }
  };

  const openContextMenu = (event: MouseEvent, item: WorkspaceFile) => {
    event.preventDefault(); setSelectedId(item.id);
    setContextMenu({ item, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 192)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 208)) });
  };

  const openKeyboardMenu = (event: KeyboardEvent, item: WorkspaceFile) => {
    if (!(event.shiftKey && event.key === "F10")) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    setContextMenu({ item, x: rect.left + 24, y: rect.top + 24 });
  };

  const handleDragEnter = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault(); dragDepth.current += 1; setDragging(true);
  };
  const handleDragLeave = (event: DragEvent) => {
    event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (!dragDepth.current) setDragging(false);
  };
  const handleDrop = (event: DragEvent) => {
    event.preventDefault(); dragDepth.current = 0; setDragging(false);
    void uploadFiles(Array.from(event.dataTransfer.files));
  };

  const createMenu = (location: "nav" | "toolbar", dark = false) => newMenu === location && <div className={`files-create-menu${dark ? " files-create-menu--dark" : ""}`} role="menu">
    <button type="button" role="menuitem" onClick={() => { setNewMenu(null); setFolderDialogOpen(true); }}><FolderPlus /><span><strong>New folder</strong><small>Create a shared folder</small></span></button>
    <button type="button" role="menuitem" onClick={() => { setNewMenu(null); setFileDialogOpen(true); }}><FilePlus2 /><span><strong>New file</strong><small>Create and open a text file</small></span></button>
    <button type="button" role="menuitem" onClick={() => { setNewMenu(null); fileInputRef.current?.click(); }}><Upload /><span><strong>Upload files</strong><small>Up to 2 GiB each</small></span></button>
  </div>;

  return <div className={`files-app${dragging ? " is-dragging" : ""}`} onDragEnter={handleDragEnter} onDragOver={(event) => event.preventDefault()} onDragLeave={handleDragLeave} onDrop={handleDrop}>
    <input ref={fileInputRef} className="files-sr-only" type="file" multiple onChange={(event) => { void uploadFiles(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }} />
    {dragging && <div className="files-drop-overlay"><span><Upload /></span><strong>Drop files into {folderTitle}</strong><small>Shared workspace storage · 2 GiB per file</small></div>}
    {mobileNavigation && <button type="button" className="files-app__scrim" aria-label="Close files navigation" onClick={() => setMobileNavigation(false)} />}

    <aside className={`files-nav${mobileNavigation ? " files-nav--open" : ""}`} aria-label="Files navigation">
      <div className="files-nav__heading"><div><span className="files-nav__eyebrow">Neural Labs</span><strong>Workspace files</strong></div><button type="button" className="files-nav__close" aria-label="Close navigation" onClick={() => setMobileNavigation(false)}><X /></button></div>
      <div className="files-create-menu-wrap"><button type="button" className="files-nav__new" aria-expanded={newMenu === "nav"} onClick={() => setNewMenu((open) => open === "nav" ? null : "nav")}><Plus />New<span>⌘ N</span></button>{createMenu("nav", true)}</div>
      <nav className="files-nav__primary" aria-label="File locations">{NAV_ITEMS.map(({ id, label, icon: Icon }) => <button type="button" className={activeNav === id ? "is-active" : ""} aria-current={activeNav === id ? "page" : undefined} key={id} onClick={() => chooseNavigation(id)}><Icon /><span>{label}</span>{id === "shared" && <small>{items.length}</small>}</button>)}</nav>
      <div className="files-nav__section"><span>Location</span><button type="button" onClick={() => navigateTo("")}><i className="is-violet" />~/workspace<small>live</small></button>{pathSegments.slice(0, 2).map((segment, index) => <button type="button" key={`${segment}:${index}`} onClick={() => navigateTo(pathSegments.slice(0, index + 1).join("/"))}><i className="is-cyan" />{segment}</button>)}</div>
      <div className="files-nav__storage"><div><HardDrive /><span>Persistent storage</span><strong>Shared</strong></div><div className="files-nav__meter"><i /></div><small>Workspace home volume · 2 GiB upload cap</small></div>
    </aside>

    <main className="files-main">
      <header className="files-toolbar">
        <button type="button" className="files-icon-button files-toolbar__menu" aria-label="Open files navigation" onClick={() => setMobileNavigation(true)}><Menu /></button>
        <div className="files-breadcrumb" aria-label="Current folder"><button type="button" onClick={() => navigateTo("")}>Workspace</button>{pathSegments.map((segment, index) => <span key={`${segment}:${index}`}><ChevronRight /><button type="button" onClick={() => navigateTo(pathSegments.slice(0, index + 1).join("/"))}>{segment}</button></span>)}</div>
        <label className="files-search"><Search /><span className="files-sr-only">Search workspace files</span><input ref={searchRef} aria-label="Search workspace files" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this folder" type="search" /><kbd>⌘ K</kbd></label>
        <button type="button" className="files-icon-button" aria-label="Refresh files" disabled={loading || refreshing} onClick={() => void loadDirectory(currentPath, { background: true })}>{loading || refreshing ? <LoaderCircle className="is-spinning" /> : <RefreshCw />}</button>
        <button type="button" className="files-icon-button" aria-label="Upload files" disabled={busy} onClick={() => fileInputRef.current?.click()}><Upload /></button>
        <div className="files-create-menu-wrap"><button type="button" className="files-toolbar__create" aria-expanded={newMenu === "toolbar"} onClick={() => setNewMenu((open) => open === "toolbar" ? null : "toolbar")}><Plus />New</button>{createMenu("toolbar")}</div>
      </header>

      <section className="files-content" aria-labelledby="files-heading">
        <div className="files-intro"><div><span className="files-intro__eyebrow"><Cloud />Saved in the shared workspace</span><h1 id="files-heading">{activeNav === "home" ? folderTitle : NAV_ITEMS.find((item) => item.id === activeNav)?.label}</h1><p>Browse the same persistent files used by Neura, OpenClaw, Codex, and every approved developer.</p></div><div className="files-presence" aria-label="Shared team workspace"><span className="is-violet">NL</span><small>Shared with the team</small></div></div>

        {activeNav === "home" && !query && featuredFolders.length > 0 && <section className="files-featured" aria-labelledby="files-featured-heading"><div className="files-section-heading"><h2 id="files-featured-heading">Folders</h2><button type="button" onClick={() => setView("list")}>View all <ChevronRight /></button></div><div className="files-folder-grid">{featuredFolders.map((folder) => <button type="button" className={`files-folder-card is-${folder.accent}`} key={folder.id} onClick={() => setSelectedId(folder.id)} onDoubleClick={() => openItem(folder)} onContextMenu={(event) => openContextMenu(event, folder)}><span className="files-folder-card__icon"><FolderOpen /></span><span><strong>{folder.name}</strong><small>{folder.modified}</small></span><ChevronRight /></button>)}</div></section>}

        <section className="files-browser" aria-labelledby="files-list-heading">
          <div className="files-section-heading files-browser__heading"><div><h2 id="files-list-heading">{query ? `Results for “${query}”` : activeNav === "recent" ? "Recently changed" : activeNav === "starred" ? "Starred files" : activeNav === "trash" ? "Trash" : "All files"}</h2><span>{visibleItems.length} {visibleItems.length === 1 ? "item" : "items"}</span></div><div className="files-view-controls"><button type="button" aria-label="Sort files by modified date" onClick={() => setActiveNav("recent")}><ArrowUpDown /></button><span aria-label="View mode"><button type="button" aria-label="List view" aria-pressed={view === "list"} onClick={() => setView("list")}><LayoutList /></button><button type="button" aria-label="Grid view" aria-pressed={view === "grid"} onClick={() => setView("grid")}><Grid2X2 /></button></span></div></div>
          {notice && <div className="files-notice" role="status"><Sparkles /><span>{notice}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice(undefined)}><X /></button></div>}
          {loading ? <div className="files-empty"><span><LoaderCircle className="is-spinning" /></span><strong>Loading workspace files</strong><p>Reading the shared developer workspace…</p></div> : visibleItems.length === 0 ? <div className="files-empty"><span>{activeNav === "trash" ? <Trash2 /> : activeNav === "starred" ? <Star /> : <Search />}</span><strong>{activeNav === "trash" ? "Trash is not available in V1" : activeNav === "starred" ? "No starred files yet" : "No files found"}</strong><p>{activeNav === "trash" ? "Deleted files are removed permanently after confirmation." : activeNav === "starred" ? "Favorites will arrive with workspace metadata." : query ? "Try a different file name or type." : "Drop files here, upload from your device, or create a folder."}</p></div> : view === "list" ? <div className="files-list"><div className="files-list__header" aria-hidden="true"><span>Name</span><span>Workspace</span><span>Modified</span><span>Size</span><span /></div>{visibleItems.map((item) => <FileRow item={item} key={item.id} selected={selected?.id === item.id} onOpen={() => openItem(item)} onSelect={() => setSelectedId(item.id)} onContextMenu={(event) => openContextMenu(event, item)} onKeyDown={(event) => openKeyboardMenu(event, item)} />)}</div> : <div className="files-grid">{visibleItems.map((item) => <FileCard item={item} key={item.id} selected={selected?.id === item.id} onOpen={() => openItem(item)} onSelect={() => setSelectedId(item.id)} onContextMenu={(event) => openContextMenu(event, item)} onKeyDown={(event) => openKeyboardMenu(event, item)} />)}</div>}
        </section>
      </section>
    </main>

    <aside className="files-detail" aria-label="File details">{selected ? <><div className="files-detail__top"><span>Details</span><button type="button" aria-label={`More actions for ${selected.name}`} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setContextMenu({ item: selected, x: rect.right - 170, y: rect.bottom + 5 }); }}><MoreHorizontal /></button></div><FileArtwork item={selected} large /><div className="files-detail__identity"><span className={`files-detail__kind is-${selected.accent}`}>{kindLabel(selected.kind)}</span><h2>{selected.name}</h2><p>{selected.summary}</p></div><div className="files-detail__actions">{selected.kind === "folder" ? <button type="button" onClick={() => openItem(selected)}>Open folder</button> : <button type="button" onClick={() => openItem(selected)}>{workspaceFileCanPreview(selected.name) && onPreviewFile ? <><Eye />Preview</> : "Open"}</button>}{selected.kind === "folder" ? <button type="button" disabled aria-label="Download folder"><Download /></button> : <a href={workspaceDownloadUrl(selected.relativePath)} download={selected.name} aria-label={`Download ${selected.name}`}><Download /></a>}<button type="button" aria-label={`Delete ${selected.name}`} disabled={busy} onClick={() => void deleteItem(selected)}><Trash2 /></button><button type="button" aria-label={`More actions for ${selected.name}`} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); setContextMenu({ item: selected, x: rect.right - 170, y: rect.bottom + 5 }); }}><MoreHorizontal /></button></div><dl className="files-detail__metadata"><div><dt>Location</dt><dd>{selected.path}</dd></div><div><dt>Access</dt><dd><span className={`files-owner is-${selected.accent}`}>{selected.ownerInitials}</span>{selected.owner}</dd></div><div><dt>Modified</dt><dd>{selected.modified}</dd></div><div><dt>Size</dt><dd>{selected.size}</dd></div></dl><div className="files-detail__activity"><span>Availability</span><div><i className="is-cyan"><Cloud /></i><p><strong>Persistent workspace</strong><small>Available to approved developers and Neura</small></p></div></div></> : <div className="files-detail__empty"><File /><p>Select an item to see its details.</p></div>}</aside>

    {contextMenu && <div className="files-context-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y } satisfies CSSProperties} onPointerDown={(event) => event.stopPropagation()}><div><strong>{contextMenu.item.name}</strong><small>{kindLabel(contextMenu.item.kind)} · {contextMenu.item.size}</small></div>{contextMenu.item.kind === "folder" ? <button type="button" role="menuitem" onClick={() => openItem(contextMenu.item)}><FolderOpen />Open folder</button> : <button type="button" role="menuitem" onClick={() => openItem(contextMenu.item)}>{workspaceFileCanPreview(contextMenu.item.name) && onPreviewFile ? <><Eye />Open Preview</> : <><FileText />Open in Editor</>}</button>}<button type="button" role="menuitem" onClick={() => void copyItemPath(contextMenu.item)}><Copy />Copy path</button>{contextMenu.item.kind === "folder" ? <button type="button" role="menuitem" disabled title="Folder archives are coming later"><Download />Download<small>Files only</small></button> : <a role="menuitem" href={workspaceDownloadUrl(contextMenu.item.relativePath)} download={contextMenu.item.name} onClick={() => setContextMenu(undefined)}><Download />Download</a>}<button type="button" role="menuitem" className="danger" disabled={busy} onClick={() => void deleteItem(contextMenu.item)}><Trash2 />Delete permanently</button></div>}

    {folderDialogOpen && <div className="files-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setFolderDialogOpen(false); }}><form className="files-dialog" role="dialog" aria-modal="true" aria-labelledby="new-folder-title" onSubmit={(event) => void submitFolder(event)}><div><span><FolderPlus /></span><div><h2 id="new-folder-title">Create a folder</h2><p>It will be available to everyone in {folderTitle}.</p></div></div><label><span>Folder name</span><input autoFocus required maxLength={255} value={folderName} onChange={(event) => setFolderName(event.target.value)} placeholder="project-name" /></label><div><button type="button" onClick={() => setFolderDialogOpen(false)}>Cancel</button><button type="submit" disabled={busy || !folderName.trim()}>{busy ? "Creating…" : "Create folder"}</button></div></form></div>}
    {fileDialogOpen && <div className="files-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setFileDialogOpen(false); }}><form className="files-dialog" role="dialog" aria-modal="true" aria-labelledby="new-file-title" onSubmit={(event) => void submitFile(event)}><div><span><FilePlus2 /></span><div><h2 id="new-file-title">Create a text file</h2><p>It will open in Editor and be available to everyone in {folderTitle}.</p></div></div><label><span>File name</span><input autoFocus required maxLength={255} value={fileName} onChange={(event) => setFileName(event.target.value)} placeholder="notes.md" /></label><div><button type="button" onClick={() => setFileDialogOpen(false)}>Cancel</button><button type="submit" disabled={busy || !fileName.trim()}>{busy ? "Creating…" : "Create file"}</button></div></form></div>}
  </div>;
}

function FileArtwork({ item, large = false }: { item: WorkspaceFile; large?: boolean }) {
  const Icon = KIND_ICONS[item.kind];
  return <div className={`files-artwork is-${item.accent}${large ? " files-artwork--large" : ""}`} aria-hidden="true"><span>{item.kind === "folder" ? "DIR" : item.name.split(".").pop()?.slice(0, 4).toUpperCase()}</span><Icon /></div>;
}

type ItemProps = {
  item: WorkspaceFile; selected: boolean; onOpen: () => void; onSelect: () => void;
  onContextMenu: (event: MouseEvent) => void; onKeyDown: (event: KeyboardEvent) => void;
};

function FileRow({ item, selected, onOpen, onSelect, onContextMenu, onKeyDown }: ItemProps) {
  return <button type="button" className={`files-row${selected ? " is-selected" : ""}`} aria-label={`${item.name}, ${kindLabel(item.kind)}, ${item.size}`} aria-pressed={selected} onClick={onSelect} onDoubleClick={onOpen} onContextMenu={onContextMenu} onKeyDown={onKeyDown}><span className="files-row__name"><FileArtwork item={item} /><span><strong>{item.name}</strong><small>{kindLabel(item.kind)} · Shared</small></span></span><span className="files-row__owner"><i className={`files-owner is-${item.accent}`}>{item.ownerInitials}</i>{item.owner}</span><span>{item.modified}</span><span>{item.size}</span><span className="files-row__more" aria-hidden="true"><MoreHorizontal /></span></button>;
}

function FileCard({ item, selected, onOpen, onSelect, onContextMenu, onKeyDown }: ItemProps) {
  return <button type="button" className={`files-card${selected ? " is-selected" : ""}`} aria-label={`${item.name}, ${kindLabel(item.kind)}, ${item.size}`} aria-pressed={selected} onClick={onSelect} onDoubleClick={onOpen} onContextMenu={onContextMenu} onKeyDown={onKeyDown}><FileArtwork item={item} large /><span className="files-card__copy"><strong>{item.name}</strong><small>{item.size} · {item.modified}</small></span><span className={`files-owner is-${item.accent}`}>{item.ownerInitials}</span></button>;
}
