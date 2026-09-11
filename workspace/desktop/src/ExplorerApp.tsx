import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronRight,
  File,
  Folder,
  Grid2X2,
  LayoutList,
  Menu,
  MoreHorizontal,
  PanelRight,
  Pin as PinIcon,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent,
} from "react";
import {
  createWorkspaceFolder,
  createWorkspaceTextFile,
  subscribeWorkspaceFiles,
  workspaceContentUrl,
  workspaceDownloadUrl,
  workspaceFileCanPreview,
  type WorkspaceEntry,
  type WorkspacePreviewFile,
} from "./filesApi";
import {
  cancelOperation,
  fileInfo,
  getListing,
  getOperation,
  getOperations,
  getRecent,
  getTrash,
  preferences,
  recordOpen,
  savePins,
  searchFiles,
  startOperation,
  transferUpload,
  type Conflict,
  type Operation,
  type OperationItem,
  type Pin,
  type Preferences,
  type TrashEntry,
} from "./explorerApi";
import { readDeviceState, writeDeviceState } from "./deviceState";
import { ExplorerDialog, NameDialog } from "./ExplorerDialog";
import { useAppViewport } from "./appViewport";
import { fileThumbnail } from "./fileThumbnails";
import "./explorer.css";

export type FilesAppProps = {
  notify?: (message: string) => void;
  onOpenInVsCode?: (path: string) => void;
  onPreviewFile?: (file: WorkspacePreviewFile) => void;
  onEditImage?: (file: WorkspacePreviewFile) => void;
  onOpenWindow?: (path: string) => void;
  initialPath?: string;
  active?: boolean;
  storageNamespace?: string;
  storageArea?: string;
};
type Location = "workspace" | "recent" | "trash";
type Tab = {
  id: string;
  path: string;
  location: Location;
  history: string[];
  historyLocations?: Location[];
  historyIndex: number;
  query: string;
  scope: string;
  selected: string[];
  scroll: number;
  focus?: string;
};
type Entry = WorkspaceEntry & Partial<TrashEntry>;
type Transfer = {
  id: string;
  label: string;
  state: string;
  bytes: number;
  total: number;
  error?: string;
  operation?: Operation;
  items?: OperationItem[];
  file?: globalThis.File;
  directory?: string;
  controller?: AbortController;
};
type Ask = {
  title: string;
  message: string;
  conflict?: boolean;
  resolve: (answer: { choice: string; all: boolean }) => void;
};
export const parentPath = (p: string) =>
  p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
const base = (p: string) => p.split("/").at(-1) || "Workspace";
const key = (item: Entry) => item.id || item.path;
const newTab = (p = ""): Tab => ({
  id: crypto.randomUUID(),
  path: p,
  location: "workspace",
  history: [p],
  historyLocations: ["workspace"],
  historyIndex: 0,
  query: "",
  scope: "recursive",
  selected: [],
  scroll: 0,
});
const previewFile = (item: Entry): WorkspacePreviewFile => ({
  name: item.name,
  path: item.path,
  size: item.size || 0,
  mimeType: item.mimeType || "application/octet-stream",
});
export const editableImage = (name: string) =>
  /\.(png|jpe?g|webp|avif|bmp)$/i.test(name) ||
  name.endsWith(".minipaint.json");
export function formatBytes(size: number | null | undefined) {
  if (size == null) return "—";
  if (size < 1024) return `${size} B`;
  const unit = Math.min(4, Math.floor(Math.log(size) / Math.log(1024)));
  return `${(size / 1024 ** unit).toFixed(1)} ${["B", "KB", "MB", "GB", "TB"][unit]}`;
}
const kind = (item: Entry) =>
  item.type === "folder"
    ? "Folder"
    : item.name.split(".").at(-1)?.toUpperCase() || "File";
export function normalizedPath(value: string) {
  const p = value
    .trim()
    .replace(/^~\/workspace\/?/, "")
    .replace(/\/$/, "");
  if (
    p.startsWith("/") ||
    p.includes("\\") ||
    p.includes("\0") ||
    p.split("/").some((s) => s === "." || s === "..")
  )
    throw new Error("Enter a path inside ~/workspace");
  return p;
}
function storedTabs(user?: string, area = "files", initialPath?: string) {
  const stored = readDeviceState(user, area) as
    | { tabs?: Tab[]; currentPath?: string }
    | undefined;
  if (Array.isArray(stored?.tabs)) {
    const valid = stored.tabs
      .filter(
        (t) => t && typeof t.id === "string" && typeof t.path === "string",
      )
      .slice(0, 20)
      .map((t) => ({
        ...newTab(t.path),
        ...t,
        selected: [],
        history:
          Array.isArray(t.history) && t.history.length ? t.history : [t.path],
      }));
    if (valid.length) return valid;
  }
  return [newTab(initialPath ?? stored?.currentPath ?? "")];
}
function Thumbnail({ item }: { item: Entry }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);
  const [thumbnail, setThumbnail] = useState("");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "80px" },
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  const image =
    /\.(png|jpe?g|webp|avif|gif|bmp)$/i.test(item.name) &&
    (item.size || 0) < 10 * 1024 * 1024 &&
    !item.id;
  useEffect(() => {
    let current = true;
    setThumbnail("");
    setFailed(false);
    if (image && visible)
      void fileThumbnail(
        `${workspaceContentUrl(item.path)}&v=${item.version || item.modifiedAt}`,
      )
        .then((url) => {
          if (current) setThumbnail(url);
        })
        .catch(() => {
          if (current) setFailed(true);
        });
    return () => {
      current = false;
    };
  }, [image, visible, item.path, item.version, item.modifiedAt]);
  return (
    <span ref={ref} className={`ex-thumbnail ex-thumbnail--${item.type}`}>
      {item.type === "folder" ? (
        <Folder />
      ) : thumbnail && !failed ? (
        <img
          alt=""
          loading="lazy"
          decoding="async"
          src={thumbnail}
          onError={() => setFailed(true)}
        />
      ) : (
        <File />
      )}
    </span>
  );
}

export function ExplorerApp({
  notify,
  onOpenInVsCode,
  onPreviewFile,
  onEditImage,
  onOpenWindow,
  initialPath,
  active = true,
  storageNamespace,
  storageArea = "files",
}: FilesAppProps) {
  const viewport = useAppViewport();
  const saved = useRef(
    readDeviceState(storageNamespace, storageArea) as
      | {
          sort?: string;
          direction?: string;
          hidden?: boolean;
          foldersFirst?: boolean;
          details?: boolean;
          nameWidth?: number;
        }
      | undefined,
  ).current;
  const [tabs, setTabs] = useState(() =>
    storedTabs(storageNamespace, storageArea, initialPath),
  );
  const [tabId, setTabId] = useState(
    () =>
      (readDeviceState(storageNamespace, storageArea) as { tabId?: string })
        ?.tabId || tabs[0].id,
  );
  const tab = tabs.find((t) => t.id === tabId) || tabs[0];
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [view, setView] = useState<"list" | "grid">(() =>
    (readDeviceState(storageNamespace, storageArea) as { view?: string })
      ?.view === "grid"
      ? "grid"
      : "list",
  );
  const [sort, setSort] = useState(saved?.sort || "name");
  const [direction, setDirection] = useState(saved?.direction || "asc");
  const [hidden, setHidden] = useState(saved?.hidden || false);
  const [foldersFirst, setFoldersFirst] = useState(
    saved?.foldersFirst !== false,
  );
  const [details, setDetails] = useState(saved?.details || false);
  const [mobileNav, setMobileNav] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [data, setData] = useState<Preferences>({
    revision: 0,
    pins: [],
    recent: [],
  });
  type Clipboard = {
    items: Entry[];
    cut: boolean;
  } | null;
  const readClipboard = () => {
    const value = readDeviceState(
      storageNamespace,
      "files-clipboard",
    ) as Clipboard;
    return value && Array.isArray(value.items) ? value : null;
  };
  const [clipboard, updateClipboard] = useState<Clipboard>(readClipboard);
  function setClipboard(value: Clipboard) {
    writeDeviceState(storageNamespace, "files-clipboard", value);
    updateClipboard(value);
    if (storageNamespace)
      window.dispatchEvent(new Event("neural-files-clipboard"));
  }
  useEffect(() => {
    const sync = () => updateClipboard(readClipboard());
    window.addEventListener("storage", sync);
    window.addEventListener("neural-files-clipboard", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("neural-files-clipboard", sync);
    };
  }, [storageNamespace]);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    item?: Entry;
    pin?: Pin;
    create?: boolean;
  } | null>(null);
  const [dialog, setDialog] = useState<{
    mode: "folder" | "file" | "rename" | "destination" | "restore" | "locate";
    initial: string;
    item?: Entry;
    pin?: Pin;
    action?: "copy" | "move";
  } | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [applyAll, setApplyAll] = useState(false);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [showTransfers, setShowTransfers] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(500);
  const [width, setWidth] = useState(800);
  const [nameWidth, setNameWidth] = useState(saved?.nameWidth || 320);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const folderUploadRef = useRef<HTMLInputElement>(null);
  const anchor = useRef<string | null>(null);
  const closedTabs = useRef<Tab[]>([]);
  const mounted = useRef(true);
  const askRef = useRef<Ask | null>(null);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const selected = entries.filter((entry) => tab.selected.includes(key(entry)));
  const focused = selected.find((e) => key(e) === tab.focus) || selected.at(-1);
  const show = useCallback((text: string) => {
    setMessage(text);
    notifyRef.current?.(text);
  }, []);
  const updateTab = useCallback(
    (change: Partial<Tab>, id = tabRef.current.id) =>
      setTabs((all) => all.map((t) => (t.id === id ? { ...t, ...change } : t))),
    [],
  );
  const reload = useCallback(() => setRefresh((x) => x + 1), []);
  const loadPreferences = useCallback(
    () =>
      preferences()
        .then((p) => {
          if (Array.isArray(p.pins)) setData(p);
        })
        .catch(() => {}),
    [],
  );
  const requestAnswer = (value: Omit<Ask, "resolve">) =>
    new Promise<{ choice: string; all: boolean }>((resolve) => {
      const request = { ...value, resolve };
      askRef.current = request;
      setApplyAll(false);
      setAsk(request);
    });
  const answer = (choice: string) => {
    askRef.current?.resolve({ choice, all: applyAll });
    askRef.current = null;
    setAsk(null);
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      askRef.current?.resolve({ choice: "cancel", all: false });
    };
  }, []);
  useEffect(() => {
    writeDeviceState(storageNamespace, storageArea, {
      tabs,
      tabId,
      view,
      sort,
      direction,
      hidden,
      foldersFirst,
      details,
      nameWidth,
    });
  }, [
    tabs,
    tabId,
    view,
    sort,
    direction,
    hidden,
    foldersFirst,
    details,
    nameWidth,
    storageNamespace,
    storageArea,
  ]);
  useEffect(() => {
    void loadPreferences();
  }, [loadPreferences]);
  useEffect(() => {
    let running = true;
    const restore = async () => {
      try {
        const result = await getOperations();
        if (!running || !Array.isArray(result.operations)) return;
        setTransfers((all) => {
          const merged = new Map(all.map((entry) => [entry.id, entry]));
          for (const job of result.operations) {
            const old = merged.get(job.id);
            merged.set(job.id, {
              ...old,
              id: job.id,
              label:
                old?.label ||
                `${job.items?.[0]?.action || "Operation"} · ${job.total} item(s)`,
              state: job.state,
              bytes: job.bytes,
              total: job.total,
              operation: job,
              items: job.items || old?.items,
              error:
                job.results
                  .filter((r) => r.status === "failed")
                  .map((r) => r.message)
                  .join("; ") || old?.error,
            });
          }
          return [...merged.values()];
        });
      } catch {
        /* A disconnected queue remains visible until reconnect. */
      }
    };
    void restore();
    const timer = setInterval(() => void restore(), 1500);
    return () => {
      running = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    let timer: ReturnType<typeof setTimeout>;
    const off = subscribeWorkspaceFiles((change) => {
      if (change.kind === "move" && change.from && change.to) {
        const from = change.from,
          to = change.to;
        const remap = (p: string) =>
          p === from || p.startsWith(`${from}/`)
            ? to + p.slice(from.length)
            : p;
        setTabs((all) =>
          all.map((t) => ({
            ...t,
            path: remap(t.path),
            history: t.history.map(remap),
          })),
        );
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        reload();
        void loadPreferences();
      }, 150);
    });
    return () => {
      clearTimeout(timer);
      off();
    };
  }, [loadPreferences, reload]);
  useEffect(() => {
    const node = listRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      setHeight(entry.contentRect.height);
      setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const lastLocation = useRef("");
  useEffect(() => {
    const controller = new AbortController();
    const current = tab;
    const signature = `${tab.id}:${tab.location}:${tab.path}:${tab.query}`;
    const foreground = lastLocation.current !== signature;
    lastLocation.current = signature;
    if (foreground) {
      setLoading(true);
      setEntries([]);
    }
    const timer = setTimeout(
      async () => {
        try {
          let all: Entry[] = [];
          if (tab.location === "trash")
            all = (await getTrash(controller.signal)).entries;
          else if (tab.location === "recent")
            all = (await getRecent(controller.signal)).entries;
          else {
            let cursor: string | null | undefined;
            let offset: number | null | undefined = 0;
            do {
              const result: import("./explorerApi").Listing = tab.query.trim()
                ? await searchFiles(
                    {
                      path: tab.path,
                      q: tab.query,
                      scope: tab.scope,
                      hidden,
                      cursor: cursor ?? undefined,
                    },
                    controller.signal,
                  )
                : await getListing(
                    {
                      path: tab.path,
                      limit: 500,
                      offset: offset ?? 0,
                      sort,
                      direction,
                      hidden,
                      foldersFirst,
                    },
                    controller.signal,
                  );
              all.push(...result.entries);
              cursor = result.cursor;
              offset = result.nextOffset;
              if (controller.signal.aborted) return;
              if (foreground) setEntries([...all]);
            } while (
              (tab.query.trim() ? cursor : offset != null) &&
              !controller.signal.aborted
            );
          }
          if (controller.signal.aborted) return;
          if (tab.location !== "workspace" && tab.query)
            all = all.filter((e) =>
              e.name.toLowerCase().includes(tab.query.toLowerCase()),
            );
          if (tab.location !== "workspace" || tab.query) {
            const value = (entry: Entry) =>
              sort === "type"
                ? kind(entry)
                : sort === "modifiedAt"
                  ? entry.deletedAt || entry.modifiedAt
                  : sort === "size"
                    ? entry.size || 0
                    : entry.name;
            all.sort(
              (a, b) =>
                (foldersFirst
                  ? Number(b.type === "folder") - Number(a.type === "folder")
                  : 0) ||
                (direction === "desc" ? -1 : 1) *
                  (sort === "size"
                    ? Number(value(a)) - Number(value(b))
                    : String(value(a)).localeCompare(
                        String(value(b)),
                        undefined,
                        { numeric: true },
                      )),
            );
          }
          setEntries(all);
          setTabs((tabs) =>
            tabs.map((t) =>
              t.id === current.id
                ? {
                    ...t,
                    selected: t.selected.filter((s) =>
                      all.some((e) => key(e) === s),
                    ),
                  }
                : t,
            ),
          );
          setLoading(false);
          if (foreground && listRef.current) {
            listRef.current.scrollTop = current.scroll;
            setScrollTop(current.scroll);
          }
        } catch (e) {
          if (controller.signal.aborted) return;
          setLoading(false);
          show(e instanceof Error ? e.message : "Unable to load files");
          if (tab.location === "workspace" && tab.path) {
            const missing = await fileInfo(tab.path)
              .then(() => false)
              .catch((error: { code?: string }) => error.code === "not_found");
            if (missing) {
              updateTab({
                path: parentPath(tab.path),
                selected: [],
                query: "",
                scroll: 0,
              });
              show("This folder is no longer available. Showing its parent.");
            }
          }
        }
      },
      tab.query ? 200 : 0,
    );
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [
    tab.id,
    tab.path,
    tab.location,
    tab.query,
    tab.scope,
    sort,
    direction,
    hidden,
    foldersFirst,
    refresh,
    updateTab,
    show,
  ]);
  function navigate(path: string, location: Location = "workspace") {
    const t = tabRef.current;
    updateTab({
      path,
      location,
      query: "",
      selected: [],
      scroll: 0,
      history: [...t.history.slice(0, t.historyIndex + 1), path],
      historyLocations: [
        ...t.history
          .slice(0, t.historyIndex + 1)
          .map(
            (_, index) =>
              t.historyLocations?.[index] || ("workspace" as Location),
          ),
        location,
      ],
      historyIndex: t.historyIndex + 1,
    });
    setMobileNav(false);
    setMenu(null);
    setAddress(null);
  }
  function history(delta: number) {
    const index = tab.historyIndex + delta;
    if (index >= 0 && index < tab.history.length)
      updateTab({
        path: tab.history[index],
        historyIndex: index,
        location: tab.historyLocations?.[index] || "workspace",
        query: "",
        selected: [],
        scroll: 0,
      });
  }
  function addTab(path = "") {
    if (tabs.length >= 20) {
      show("Close a tab before opening another.");
      return;
    }
    const t = newTab(path);
    setTabs((all) => [...all, t]);
    setTabId(t.id);
  }
  function closeTab(id: string) {
    if (tabs.length === 1) {
      navigate("");
      return;
    }
    closedTabs.current.push(tabs.find((t) => t.id === id)!);
    setTabs((all) => all.filter((t) => t.id !== id));
    if (tabId === id) setTabId(tabs.find((t) => t.id !== id)!.id);
  }
  function reopenTab() {
    const t = closedTabs.current.pop();
    if (t) {
      setTabs((all) => [...all, t]);
      setTabId(t.id);
    }
  }
  function open(item: Entry, quick = false) {
    setMenu(null);
    if (tab.location === "trash") return;
    if (item.type === "folder") {
      navigate(item.path);
      return;
    }
    void recordOpen(item.path);
    if (item.name.endsWith(".minipaint.json") && onEditImage)
      onEditImage(previewFile(item));
    else if (quick && workspaceFileCanPreview(item.name) && onPreviewFile)
      onPreviewFile(previewFile(item));
    else if (
      item.mimeType?.startsWith("text/") ||
      /\.(md|js|mjs|jsx|ts|tsx|py|rs|go|sh|json|xml|css|html|csv|yaml|yml)$/i.test(
        item.name,
      )
    )
      onOpenInVsCode?.(item.path);
    else if (workspaceFileCanPreview(item.name) && onPreviewFile)
      onPreviewFile(previewFile(item));
    else onOpenInVsCode?.(item.path);
  }
  function select(
    item: Entry,
    event: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean },
  ) {
    const id = key(item);
    let ids = [id];
    if (event.shiftKey && anchor.current) {
      const a = entries.findIndex((e) => key(e) === anchor.current),
        b = entries.findIndex((e) => key(e) === id);
      ids = entries
        .slice(Math.max(0, Math.min(a, b)), Math.max(a, b) + 1)
        .map(key);
    } else if (event.metaKey || event.ctrlKey)
      ids = tab.selected.includes(id)
        ? tab.selected.filter((s) => s !== id)
        : [...tab.selected, id];
    if (!event.shiftKey) anchor.current = id;
    updateTab({ selected: ids, focus: id });
  }
  async function pins(next: Pin[]) {
    try {
      setData(await savePins(data, next));
    } catch (e) {
      show((e as Error).message);
      void loadPreferences();
    }
  }
  function pin(item: Entry) {
    if (!data.pins.some((p) => p.path === item.path))
      void pins([...data.pins, { path: item.path, label: item.name }]);
    setMenu(null);
  }
  const updateTransfer = (id: string, change: Partial<Transfer>) =>
    setTransfers((all) =>
      all.map((t) => (t.id === id ? { ...t, ...change } : t)),
    );
  async function run(items: OperationItem[]) {
    setMenu(null);
    setShowTransfers(true);
    let pending = items.filter(
      (item) =>
        !item.path ||
        !items.some(
          (other) =>
            other.path !== item.path &&
            other.path &&
            item.path!.startsWith(`${other.path}/`),
        ),
    );
    let allConflict: Conflict | undefined;
    while (pending.length && mounted.current) {
      const batch = pending;
      let job = await startOperation(batch);
      const initialJob = job;
      setTransfers((all) => [
        ...all,
        {
          id: initialJob.id,
          label: `${batch[0].action} · ${batch.length} item(s)`,
          state: initialJob.state,
          bytes: 0,
          total: batch.length,
          operation: initialJob,
          items: batch,
        },
      ]);
      while (["queued", "running"].includes(job.state) && mounted.current) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        job = await getOperation(job.id);
        updateTransfer(job.id, {
          state: job.state,
          bytes: job.bytes,
          operation: job,
        });
      }
      const retry: OperationItem[] = [];
      for (let i = 0; i < job.results.length; i++) {
        const result = job.results[i];
        if (result.download) {
          const a = document.createElement("a");
          a.href = result.download;
          a.download = "workspace-files.zip";
          a.click();
        }
        if (result.status === "failed" && result.code === "already_exists") {
          const response = allConflict
            ? { choice: allConflict, all: true }
            : await requestAnswer({
                title: "An item already exists",
                message:
                  result.message || "Choose how to handle the matching name.",
                conflict: true,
              });
          if (response.choice === "cancel") break;
          if (response.all) allConflict = response.choice as Conflict;
          retry.push({ ...pending[i], conflict: response.choice as Conflict });
        }
      }
      const failures = job.results.filter((r) => r.status === "failed");
      if (failures.length)
        updateTransfer(job.id, {
          error: failures.map((r) => r.message).join("; "),
        });
      pending = retry;
      reload();
      void loadPreferences();
    }
  }
  const safelyRun = (items: OperationItem[]) => {
    void run(items).catch((e) => show((e as Error).message));
  };
  function paste(destination = tab.path) {
    if (!clipboard) return;
    safelyRun(
      clipboard.items.map((item) => ({
        action: clipboard.cut ? "move" : "copy",
        path: item.path,
        destination,
        version: item.version,
      })),
    );
    if (clipboard.cut) setClipboard(null);
  }
  async function remove(items = selected, permanent = false) {
    if (!items.length) return;
    if (permanent) {
      const response = await requestAnswer({
        title: "Delete permanently?",
        message: `Remove ${items.length} item(s) from shared Trash? Everyone loses the ability to restore them. This cannot be undone.`,
      });
      if (response.choice !== "confirm") return;
    }
    safelyRun(
      items.map((item) =>
        permanent
          ? { action: "purge", id: item.id }
          : { action: "trash", path: item.path },
      ),
    );
  }
  async function ensureDirectory(path: string) {
    let current = "";
    for (const segment of path.split("/").filter(Boolean)) {
      try {
        await createWorkspaceFolder(current, segment);
      } catch (e) {
        const info = await fileInfo(
          current ? `${current}/${segment}` : segment,
        ).catch(() => null);
        if (info?.item.type !== "folder") throw e;
      }
      current = current ? `${current}/${segment}` : segment;
    }
  }
  async function uploadFile(
    file: globalThis.File,
    directory: string,
    batch: { conflict?: Conflict; cancelled?: boolean } = {},
  ) {
    if (batch.cancelled) return;
    const id = crypto.randomUUID();
    const controller = new AbortController();
    setShowTransfers(true);
    setTransfers((all) => [
      ...all,
      {
        id,
        label: file.name,
        state: "running",
        bytes: 0,
        total: file.size,
        file,
        directory,
        controller,
      },
    ]);
    let conflict = batch.conflict;
    try {
      while (mounted.current) {
        try {
          await transferUpload(directory, file, file.name, {
            signal: controller.signal,
            conflict,
            progress: (value) => updateTransfer(id, { bytes: value }),
          });
          break;
        } catch (e) {
          if ((e as { code?: string }).code !== "already_exists") throw e;
          const response = await requestAnswer({
            title: "An item already exists",
            message: `${file.name} already exists in the destination.`,
            conflict: true,
          });
          if (response.choice === "cancel") {
            batch.cancelled = true;
            controller.abort();
            throw new DOMException("Upload cancelled", "AbortError");
          }
          conflict = response.choice as Conflict;
          if (response.all) batch.conflict = conflict;
        }
      }
      updateTransfer(id, { state: "finished", bytes: file.size });
      reload();
    } catch (e) {
      updateTransfer(id, {
        state: controller.signal.aborted ? "cancelled" : "failed",
        error: (e as Error).message,
      });
    }
  }
  async function uploadFiles(files: globalThis.File[], directory = tab.path) {
    if (tab.location !== "workspace") {
      show("Choose a workspace folder before uploading.");
      return;
    }
    const batch: { conflict?: Conflict; cancelled?: boolean } = {};
    for (const file of files) {
      if (batch.cancelled || !mounted.current) break;
      const nested = (file.webkitRelativePath || file.name).split("/");
      nested.pop();
      const target = [directory, ...nested].filter(Boolean).join("/");
      try {
        if (nested.length) await ensureDirectory(target);
        await uploadFile(file, target, batch);
      } catch (e) {
        show((e as Error).message);
      }
    }
  }
  async function drop(event: DragEvent, destination = tab.path) {
    event.preventDefault();
    event.stopPropagation();
    if (tab.location !== "workspace") return;
    const internal = event.dataTransfer.getData("application/x-neural-files");
    if (internal) {
      try {
        const items = JSON.parse(internal) as Entry[];
        safelyRun(
          items.map((i) => ({
            action: event.ctrlKey || event.altKey ? "copy" : "move",
            path: i.path,
            destination,
            version: i.version,
          })),
        );
      } catch {
        show("Unable to read dragged files");
      }
      return;
    }
    type DropEntry = {
      isFile: boolean;
      isDirectory: boolean;
      name: string;
      file: (
        callback: (file: globalThis.File) => void,
        error: (e: Error) => void,
      ) => void;
      createReader: () => {
        readEntries: (
          callback: (items: DropEntry[]) => void,
          error: (e: Error) => void,
        ) => void;
      };
    };
    const drops = Array.from(event.dataTransfer.items || [])
      .map((item) =>
        (
          item as unknown as { webkitGetAsEntry?: () => DropEntry }
        ).webkitGetAsEntry?.(),
      )
      .filter(Boolean) as DropEntry[];
    async function walk(entry: DropEntry, directory: string) {
      if (entry.isFile)
        await uploadFile(
          await new Promise<globalThis.File>((resolve, reject) =>
            entry.file(resolve, reject),
          ),
          directory,
        );
      else if (entry.isDirectory) {
        const target = [directory, entry.name].filter(Boolean).join("/");
        await ensureDirectory(target);
        const reader = entry.createReader();
        let children: DropEntry[];
        do {
          children = await new Promise<DropEntry[]>((resolve, reject) =>
            reader.readEntries(resolve, reject),
          );
          for (const child of children) await walk(child, target);
        } while (children.length);
      }
    }
    try {
      if (drops.length)
        for (const entry of drops) await walk(entry, destination);
      else await uploadFiles(Array.from(event.dataTransfer.files), destination);
    } catch (e) {
      show((e as Error).message);
    }
  }
  const keyboardRef = useRef<(e: KeyboardEvent) => void>(() => {});
  const typed = useRef({ text: "", time: 0 });
  keyboardRef.current = (e) => {
    if (
      !active ||
      dialog ||
      ask ||
      menu ||
      (e.target as HTMLElement)?.matches?.(
        "input,textarea,select,[contenteditable=true]",
      )
    )
      return;
    const cmd = e.ctrlKey || e.metaKey;
    const lower = e.key.toLowerCase();
    if (cmd && lower === "a") {
      e.preventDefault();
      updateTab({ selected: entries.map(key) });
    } else if (cmd && ["c", "x"].includes(lower) && tab.location !== "trash") {
      e.preventDefault();
      setClipboard({ items: selected, cut: lower === "x" });
    } else if (cmd && lower === "v" && tab.location === "workspace") {
      e.preventDefault();
      paste();
    } else if (cmd && lower === "t") {
      e.preventDefault();
      if (e.shiftKey) reopenTab();
      else addTab(tab.path);
    } else if (cmd && lower === "w") {
      e.preventDefault();
      closeTab(tab.id);
    } else if (cmd && ["l", "k", "f"].includes(lower)) {
      e.preventDefault();
      if (lower === "l") setAddress(`~/workspace/${tab.path}`);
      else searchRef.current?.focus();
    } else if (e.altKey && e.key === "ArrowLeft") {
      e.preventDefault();
      history(-1);
    } else if (e.altKey && e.key === "ArrowRight") {
      e.preventDefault();
      history(1);
    } else if (e.altKey && e.key === "ArrowUp") {
      e.preventDefault();
      navigate(parentPath(tab.path));
    } else if (e.key === "F2" || (e.metaKey && e.key === "Enter")) {
      e.preventDefault();
      if (focused && tab.location !== "trash")
        setDialog({ mode: "rename", initial: focused.name, item: focused });
    } else if (e.key === "Delete" || (e.metaKey && e.key === "Backspace")) {
      e.preventDefault();
      void remove(selected, tab.location === "trash");
    } else if (e.key === "Enter" && focused) {
      e.preventDefault();
      open(focused);
    } else if (e.key === " " && focused) {
      e.preventDefault();
      open(focused, true);
    } else if (e.key === "Escape") updateTab({ selected: [], query: "" });
    else if (e.shiftKey && e.key === "F10" && focused) {
      e.preventDefault();
      const r = listRef.current!.getBoundingClientRect();
      setMenu({ x: r.left + 30, y: r.top + 30, item: focused });
    } else if (
      [
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Home",
        "End",
      ].includes(e.key)
    ) {
      e.preventDefault();
      const columns =
        view === "grid" ? Math.max(1, Math.floor(width / 160)) : 1;
      const current = entries.findIndex(
        (i) => key(i) === (tab.focus || tab.selected.at(-1)),
      );
      const delta =
        e.key === "ArrowUp"
          ? -columns
          : e.key === "ArrowDown"
            ? columns
            : e.key === "ArrowLeft"
              ? -1
              : 1;
      const index =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? entries.length - 1
            : Math.min(entries.length - 1, Math.max(0, current + delta));
      const item = entries[index];
      if (item) {
        select(item, e);
        listRef.current?.scrollTo({
          top: Math.floor(index / columns) * (view === "grid" ? 152 : 46),
        });
      }
    } else if (!cmd && !e.altKey && e.key.length === 1) {
      const prefix =
        Date.now() - typed.current.time < 800
          ? typed.current.text + lower
          : lower;
      typed.current = { text: prefix, time: Date.now() };
      const item = entries.find((i) => i.name.toLowerCase().startsWith(prefix));
      if (item) select(item, {});
    }
  };
  useEffect(() => {
    const owner = rootRef.current?.ownerDocument.defaultView || window;
    const handler = (e: KeyboardEvent) => keyboardRef.current(e);
    owner.addEventListener("keydown", handler);
    return () => owner.removeEventListener("keydown", handler);
  }, [active, viewport.width]);
  useEffect(() => {
    if (!menu) return;
    const owner = rootRef.current?.ownerDocument || document;
    const close = (e: PointerEvent) => {
      if (!(e.target as Element).closest(".ex-context")) setMenu(null);
    };
    owner.addEventListener("pointerdown", close);
    return () => owner.removeEventListener("pointerdown", close);
  }, [menu]);
  const columns = view === "grid" ? Math.max(1, Math.floor(width / 160)) : 1;
  const rowHeight = view === "grid" ? 152 : 46;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 3) * columns;
  const end = Math.min(
    entries.length,
    start + (Math.ceil(height / rowHeight) + 7) * columns,
  );
  const label =
    tab.location === "workspace"
      ? base(tab.path)
      : tab.location === "recent"
        ? "Recent"
        : "Trash";
  const openMenu = (e: MouseEvent, item?: Entry) => {
    e.preventDefault();
    e.stopPropagation();
    if (item && !tab.selected.includes(key(item)))
      updateTab({ selected: [key(item)] });
    setMenu({ x: e.clientX, y: e.clientY, item });
  };
  const contextItems =
    menu?.item && !selected.some((i) => key(i) === key(menu.item!))
      ? [menu.item]
      : selected;
  const action = (fn: () => void) => () => {
    setMenu(null);
    fn();
  };
  const menuButton = (text: string, fn: () => void, disabled = false) => (
    <button role="menuitem" disabled={disabled} onClick={action(fn)}>
      {text}
    </button>
  );
  return (
    <div
      className={`explorer${viewport.mobile ? " is-mobile" : ""}`}
      ref={rootRef}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => void drop(e)}
    >
      <input
        ref={uploadRef}
        type="file"
        multiple
        hidden
        aria-label="Choose files to upload"
        onChange={(e) => {
          void uploadFiles(Array.from(e.target.files || []));
          e.target.value = "";
        }}
      />
      <input
        ref={folderUploadRef}
        type="file"
        multiple
        hidden
        {...({ webkitdirectory: "" } as Record<string, string>)}
        aria-label="Choose folder to upload"
        onChange={(e) => {
          void uploadFiles(Array.from(e.target.files || []));
          e.target.value = "";
        }}
      />
      <aside
        className={`ex-sidebar ${mobileNav ? "open" : ""}`}
        aria-label="Files navigation"
      >
        <header>
          <Folder />
          <strong>Files</strong>
          <button
            aria-label="Close navigation"
            onClick={() => setMobileNav(false)}
          >
            <X />
          </button>
        </header>
        <h2>Locations</h2>
        <button
          className={tab.location === "workspace" && !tab.path ? "current" : ""}
          onClick={() => navigate("")}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => void drop(e, "")}
        >
          <Folder />
          Workspace
        </button>
        <div
          className="ex-pins"
          aria-label="Pinned folders"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
              const items = JSON.parse(
                e.dataTransfer.getData("application/x-neural-files"),
              ) as Entry[];
              void pins([
                ...data.pins,
                ...items
                  .filter(
                    (i) =>
                      i.type === "folder" &&
                      !data.pins.some((p) => p.path === i.path),
                  )
                  .map((i) => ({ path: i.path, label: i.name })),
              ]);
            } catch {
              /* Pin reorder is handled by its target. */
            }
          }}
        >
          {data.pins.map((p, index) => (
            <button
              key={p.path}
              draggable
              className={tab.path === p.path ? "current" : ""}
              title={p.available === false ? `${p.path} — unavailable` : p.path}
              onDragStart={(e) =>
                e.dataTransfer.setData("application/x-neural-pin", p.path)
              }
              onDrop={(e) => {
                const source = e.dataTransfer.getData(
                  "application/x-neural-pin",
                );
                if (!source) return;
                e.preventDefault();
                e.stopPropagation();
                const pin = data.pins.find((p) => p.path === source);
                if (pin) {
                  const next = data.pins.filter((p) => p.path !== source);
                  next.splice(index, 0, pin);
                  void pins(next);
                }
              }}
              onClick={() =>
                p.available === false
                  ? setDialog({ mode: "locate", initial: p.path, pin: p })
                  : navigate(p.path)
              }
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, pin: p });
              }}
            >
              <PinIcon />
              <span>{p.label}</span>
              {p.available === false && <span>!</span>}
            </button>
          ))}
          <small>
            {data.pins.length
              ? "Drag to reorder or pin folders"
              : "Drop folders here to pin them"}
          </small>
        </div>
        <hr />
        <button
          className={tab.location === "recent" ? "current" : ""}
          onClick={() => navigate("", "recent")}
        >
          Recent
        </button>
        <button
          className={tab.location === "trash" ? "current" : ""}
          onClick={() => navigate("", "trash")}
        >
          <Trash2 />
          Trash
        </button>
        <footer>
          Shared workspace
          <br />
          <small>Your pins are personal</small>
        </footer>
      </aside>
      <main className="ex-main">
        <div className="ex-tabs" role="tablist" aria-label="Folders">
          {tabs.map((t) => (
            <div key={t.id} className={t.id === tab.id ? "current" : ""}>
              <button
                role="tab"
                aria-selected={t.id === tab.id}
                onClick={() => setTabId(t.id)}
              >
                {t.location === "workspace" ? base(t.path) : t.location}
              </button>
              <button
                aria-label={`Close tab ${base(t.path)}`}
                onClick={() => closeTab(t.id)}
              >
                <X />
              </button>
            </div>
          ))}
          <button aria-label="New tab" onClick={() => addTab()}>
            <Plus />
          </button>
        </div>
        <header className="ex-toolbar">
          <button
            className="ex-mobile"
            aria-label="Open files navigation"
            onClick={() => setMobileNav(true)}
          >
            <Menu />
          </button>
          <button
            aria-label="Back"
            disabled={tab.historyIndex === 0}
            onClick={() => history(-1)}
          >
            <ArrowLeft />
          </button>
          <button
            aria-label="Forward"
            disabled={tab.historyIndex === tab.history.length - 1}
            onClick={() => history(1)}
          >
            <ArrowRight />
          </button>
          <button
            aria-label="Up one folder"
            disabled={!tab.path || tab.location !== "workspace"}
            onClick={() => navigate(parentPath(tab.path))}
          >
            <ArrowUp />
          </button>
          {address !== null ? (
            <form
              className="ex-address"
              onSubmit={(e) => {
                e.preventDefault();
                try {
                  navigate(normalizedPath(address));
                } catch (e) {
                  show((e as Error).message);
                }
              }}
            >
              <input
                autoFocus
                aria-label="Folder path"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setAddress(null);
                }}
              />
            </form>
          ) : (
            <nav
              className="ex-breadcrumb"
              aria-label="Current folder"
              onDoubleClick={() => setAddress(`~/workspace/${tab.path}`)}
            >
              <button onClick={() => navigate("")}>Workspace</button>
              {tab.path
                .split("/")
                .filter(Boolean)
                .map((segment, index, all) => (
                  <span key={index}>
                    <ChevronRight />
                    <button
                      onClick={() =>
                        navigate(all.slice(0, index + 1).join("/"))
                      }
                    >
                      {segment}
                    </button>
                  </span>
                ))}
              <button
                aria-label="Edit folder path"
                onClick={() => setAddress(`~/workspace/${tab.path}`)}
              >
                …
              </button>
            </nav>
          )}
          <label className="ex-search">
            <Search />
            <input
              ref={searchRef}
              type="search"
              aria-label="Search workspace files"
              placeholder="Search folder and subfolders"
              value={tab.query}
              onChange={(e) =>
                updateTab({ query: e.target.value, selected: [], scroll: 0 })
              }
            />
          </label>
        </header>
        <div className="ex-actions">
          <button
            className="ex-primary"
            disabled={tab.location !== "workspace"}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMenu({ x: r.left, y: r.bottom, create: true });
            }}
          >
            <Plus />
            New
          </button>
          <button
            aria-label="Upload files"
            disabled={tab.location !== "workspace"}
            onClick={() => uploadRef.current?.click()}
          >
            <Upload />
          </button>
          <button aria-label="Refresh files" onClick={reload}>
            <RefreshCw />
          </button>
          <label>
            Sort{" "}
            <select
              aria-label="Sort by"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="name">Name</option>
              <option value="modifiedAt">Modified</option>
              <option value="type">Type</option>
              <option value="size">Size</option>
            </select>
          </label>
          <button
            aria-label={
              direction === "asc" ? "Sort descending" : "Sort ascending"
            }
            onClick={() => setDirection(direction === "asc" ? "desc" : "asc")}
          >
            {direction === "asc" ? "↑" : "↓"}
          </button>
          <label>
            <input
              type="checkbox"
              checked={foldersFirst}
              onChange={(e) => setFoldersFirst(e.target.checked)}
            />
            Folders first
          </label>
          <label>
            <input
              type="checkbox"
              checked={hidden}
              onChange={(e) => setHidden(e.target.checked)}
            />
            Hidden
          </label>
          <span className="ex-spacer" />
          <button
            aria-label="List view"
            aria-pressed={view === "list"}
            onClick={() => setView("list")}
          >
            <LayoutList />
          </button>
          <button
            aria-label="Grid view"
            aria-pressed={view === "grid"}
            onClick={() => setView("grid")}
          >
            <Grid2X2 />
          </button>
          <button
            aria-label="Toggle details"
            aria-pressed={details}
            onClick={() => setDetails(!details)}
          >
            <PanelRight />
          </button>
        </div>
        {tab.query && tab.location === "workspace" && (
          <div className="ex-notice">
            Search in{" "}
            <select
              aria-label="Search scope"
              value={tab.scope}
              onChange={(e) => updateTab({ scope: e.target.value })}
            >
              <option value="recursive">This folder and subfolders</option>
              <option value="direct">This folder only</option>
              <option value="workspace">Entire workspace</option>
            </select>
          </div>
        )}
        {message && (
          <div className="ex-notice" role="status">
            {message}
            <button aria-label="Dismiss message" onClick={() => setMessage("")}>
              <X />
            </button>
          </div>
        )}
        {tab.location === "trash" && (
          <div className="ex-notice">
            Shared Trash · Items expire after 90 days ·{" "}
            {formatBytes(entries.reduce((sum, i) => sum + (i.size || 0), 0))}
            <button
              disabled={!entries.length}
              onClick={() => void remove(entries, true)}
            >
              Empty Trash
            </button>
          </div>
        )}
        <div className="ex-body">
          <section
            className="ex-browser"
            aria-label={tab.query ? `Results for ${tab.query}` : label}
          >
            {view === "list" && (
              <div
                className="ex-columns"
                style={{ "--name-width": `${nameWidth}px` } as CSSProperties}
              >
                <span>
                  <button
                    onClick={() => {
                      if (sort === "name")
                        setDirection(direction === "asc" ? "desc" : "asc");
                      else setSort("name");
                    }}
                  >
                    Name
                  </button>
                  <button
                    aria-label="Resize name column"
                    onPointerDown={(e) => {
                      const start = e.clientX;
                      const size = nameWidth;
                      const owner = e.currentTarget.ownerDocument;
                      const move = (event: PointerEvent) =>
                        setNameWidth(
                          Math.max(
                            160,
                            Math.min(700, size + event.clientX - start),
                          ),
                        );
                      const end = () => {
                        owner.removeEventListener("pointermove", move);
                        owner.removeEventListener("pointerup", end);
                      };
                      owner.addEventListener("pointermove", move);
                      owner.addEventListener("pointerup", end);
                    }}
                  />
                </span>
                <span>
                  <button
                    onClick={() => {
                      if (sort === "modifiedAt")
                        setDirection(direction === "asc" ? "desc" : "asc");
                      else setSort("modifiedAt");
                    }}
                  >
                    {tab.location === "trash" ? "Deleted" : "Modified"}
                  </button>
                </span>
                <span>
                  <button
                    onClick={() => {
                      if (sort === "type")
                        setDirection(direction === "asc" ? "desc" : "asc");
                      else setSort("type");
                    }}
                  >
                    Type
                  </button>
                </span>
                <span>
                  <button
                    onClick={() => {
                      if (sort === "size")
                        setDirection(direction === "asc" ? "desc" : "asc");
                      else setSort("size");
                    }}
                  >
                    Size
                  </button>
                </span>
                <span />
              </div>
            )}
            <div
              ref={listRef}
              className="ex-list"
              role="grid"
              aria-label={`${label} items`}
              aria-multiselectable="true"
              tabIndex={0}
              onScroll={(e) => {
                const top = e.currentTarget.scrollTop;
                setScrollTop(top);
                updateTab({ scroll: top });
              }}
              onContextMenu={(e) => openMenu(e)}
              onClick={(e) => {
                if (e.target === e.currentTarget) updateTab({ selected: [] });
              }}
            >
              {loading && !entries.length ? (
                <p className="ex-empty" role="status">
                  Loading files…
                </p>
              ) : !entries.length ? (
                <div className="ex-empty">
                  <Folder />
                  <h2>
                    {tab.query
                      ? "No matching files"
                      : tab.location === "trash"
                        ? "Trash is empty"
                        : tab.location === "recent"
                          ? "No recent files"
                          : "This folder is empty"}
                  </h2>
                  <p>
                    {tab.location === "workspace"
                      ? "Create a folder or upload files to get started."
                      : tab.location === "recent"
                        ? "Files you open here appear in Recent."
                        : "Deleted items can be restored here for 90 days."}
                  </p>
                </div>
              ) : (
                <div
                  style={{
                    height: Math.ceil(entries.length / columns) * rowHeight,
                    position: "relative",
                  }}
                >
                  <div
                    className={`ex-items ${view}`}
                    style={
                      {
                        top: Math.floor(start / columns) * rowHeight,
                        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                        "--name-width": `${nameWidth}px`,
                      } as CSSProperties
                    }
                  >
                    {entries.slice(start, end).map((item) => (
                      <div
                        key={key(item)}
                        role="row"
                        aria-label={`${item.name}, ${kind(item)}`}
                        aria-selected={tab.selected.includes(key(item))}
                        className={`ex-item ${tab.selected.includes(key(item)) ? "selected" : ""} ${clipboard?.cut && clipboard.items.some((i) => i.path === item.path) ? "cut" : ""}`}
                        draggable={tab.location !== "trash"}
                        onDragStart={(e) =>
                          e.dataTransfer.setData(
                            "application/x-neural-files",
                            JSON.stringify(
                              tab.selected.includes(key(item))
                                ? selected
                                : [item],
                            ),
                          )
                        }
                        onDragOver={(e) => {
                          if (item.type === "folder") e.preventDefault();
                        }}
                        onDrop={(e) => {
                          if (item.type === "folder") void drop(e, item.path);
                        }}
                        onClick={(e) => select(item, e)}
                        onDoubleClick={() => open(item)}
                        onContextMenu={(e) => openMenu(e, item)}
                      >
                        <div className="ex-name" role="gridcell">
                          <Thumbnail item={item} />
                          <span>
                            <strong title={item.name}>{item.name}</strong>
                            {(tab.query || tab.location !== "workspace") && (
                              <small>
                                {tab.location === "trash"
                                  ? `${item.path} · ${item.deletedBy}`
                                  : parentPath(item.path) || "Workspace"}
                              </small>
                            )}
                          </span>
                        </div>
                        <span className="ex-date" role="gridcell">
                          {new Date(
                            item.deletedAt || item.modifiedAt,
                          ).toLocaleDateString()}
                        </span>
                        <span className="ex-kind" role="gridcell">
                          {kind(item)}
                        </span>
                        <span className="ex-size" role="gridcell">
                          {formatBytes(item.size)}
                        </span>
                        <button
                          className="ex-more"
                          aria-label={`More actions for ${item.name}`}
                          onClick={(e) => openMenu(e, item)}
                        >
                          <MoreHorizontal />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
          {details && (
            <aside className="ex-details" aria-label="File details">
              {focused ? (
                <>
                  <Thumbnail item={focused} />
                  <h2>{focused.name}</h2>
                  <dl>
                    <dt>Location</dt>
                    <dd>{focused.path}</dd>
                    <dt>Size</dt>
                    <dd>{formatBytes(focused.size)}</dd>
                    <dt>Type</dt>
                    <dd>{kind(focused)}</dd>
                    {focused.expiresAt && (
                      <>
                        <dt>Expires</dt>
                        <dd>{new Date(focused.expiresAt).toLocaleString()}</dd>
                        <dt>Deleted by</dt>
                        <dd>{focused.deletedBy}</dd>
                      </>
                    )}
                  </dl>
                  {tab.location !== "trash" && (
                    <button onClick={() => open(focused)}>Open</button>
                  )}
                </>
              ) : (
                <p>Select an item to see details.</p>
              )}
            </aside>
          )}
        </div>
        <footer className="ex-status">
          <span>
            {entries.length} items
            {selected.length ? ` · ${selected.length} selected` : ""}
            {loading ? " · Searching…" : ""}
          </span>
          <button onClick={() => setShowTransfers(!showTransfers)}>
            Transfers{" "}
            {transfers.filter((t) => ["running", "queued"].includes(t.state))
              .length || ""}
          </button>
        </footer>
        {showTransfers && (
          <section className="ex-transfers" aria-label="Transfers">
            <header>
              <strong>Transfers and operations</strong>
              <button
                aria-label="Close transfers"
                onClick={() => setShowTransfers(false)}
              >
                <X />
              </button>
            </header>
            {!transfers.length && <p>No transfers yet.</p>}
            {transfers.map((t) => (
              <div key={t.id}>
                <strong>{t.label}</strong>
                <span>
                  {t.state} ·{" "}
                  {t.operation
                    ? `${t.operation.completed}/${t.operation.total} items · ${formatBytes(t.bytes)}`
                    : `${formatBytes(t.bytes)} / ${formatBytes(t.total)}`}
                </span>
                {["running", "queued"].includes(t.state) && (
                  <>
                    <progress
                      max={t.operation ? t.operation.total : t.total || 1}
                      value={t.operation ? t.operation.completed : t.bytes}
                    />
                    <button
                      onClick={() => {
                        if (t.controller) t.controller.abort();
                        else void cancelOperation(t.id);
                      }}
                    >
                      Cancel
                    </button>
                  </>
                )}
                {t.error && <p role="alert">{t.error}</p>}
                {t.operation?.results
                  .filter((result) => result.download)
                  .map((result, index) => (
                    <a
                      key={index}
                      href={result.download}
                      download="workspace-files.zip"
                    >
                      Download ZIP (available until downloaded or expired)
                    </a>
                  ))}
                {(t.error || t.state === "cancelled") && (
                  <button
                    onClick={() => {
                      if (t.file) void uploadFile(t.file, t.directory || "");
                      else if (t.items)
                        safelyRun(
                          t.items.filter(
                            (_, i) =>
                              t.operation?.results[i]?.status !== "completed",
                          ),
                        );
                    }}
                  >
                    Retry failed items
                  </button>
                )}
              </div>
            ))}
          </section>
        )}
      </main>
      {menu && (
        <div
          className="ex-context"
          role="menu"
          style={{
            left: Math.max(
              8,
              Math.min(
                menu.x,
                (rootRef.current?.ownerDocument.defaultView?.innerWidth ||
                  window.innerWidth) - 250,
              ),
            ),
            top: Math.max(
              8,
              Math.min(
                menu.y,
                (rootRef.current?.ownerDocument.defaultView?.innerHeight ||
                  window.innerHeight) - 440,
              ),
            ),
          }}
          ref={(node) => {
            node?.querySelector<HTMLButtonElement>("button")?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setMenu(null);
            if (["ArrowDown", "ArrowUp"].includes(e.key)) {
              e.preventDefault();
              const buttons = Array.from(
                e.currentTarget.querySelectorAll<HTMLElement>(
                  "button:not(:disabled)",
                ),
              );
              const index = buttons.indexOf(e.target as HTMLElement);
              buttons[
                (index + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) %
                  buttons.length
              ]?.focus();
            }
          }}
        >
          {menu.pin ? (
            <>
              {menuButton("Open folder", () => navigate(menu.pin!.path))}
              {menuButton("Open in new tab", () => addTab(menu.pin!.path))}
              {menuButton(
                "Unpin from sidebar",
                () =>
                  void pins(data.pins.filter((p) => p.path !== menu.pin!.path)),
              )}
              {menuButton("Locate folder…", () =>
                setDialog({
                  mode: "locate",
                  initial: menu.pin!.path,
                  pin: menu.pin,
                }),
              )}
            </>
          ) : menu.create || !menu.item ? (
            <>
              {menuButton(
                "New folder",
                () => setDialog({ mode: "folder", initial: "New folder" }),
                tab.location !== "workspace",
              )}
              {menuButton(
                "New file",
                () => setDialog({ mode: "file", initial: "notes.md" }),
                tab.location !== "workspace",
              )}
              {menuButton(
                "Upload files",
                () => uploadRef.current?.click(),
                tab.location !== "workspace",
              )}
              {menuButton(
                "Upload folder",
                () => folderUploadRef.current?.click(),
                tab.location !== "workspace",
              )}
              <hr />
              {menuButton(
                "Paste",
                () => paste(),
                !clipboard || tab.location !== "workspace",
              )}
              {menuButton("Select all", () =>
                updateTab({ selected: entries.map(key) }),
              )}
              {menuButton("Reopen closed tab", reopenTab)}
            </>
          ) : tab.location === "trash" ? (
            <>
              {menuButton("Restore", () =>
                safelyRun(
                  contextItems.map((i) => ({ action: "restore", id: i.id })),
                ),
              )}
              {menuButton("Restore to…", () =>
                setDialog({
                  mode: "restore",
                  initial: "~/workspace/",
                  item: menu.item,
                }),
              )}
              {menuButton(
                "Delete permanently",
                () => void remove(contextItems, true),
              )}
            </>
          ) : (
            <>
              {menuButton("Open", () => open(menu.item!))}
              {menu.item.type === "folder" && (
                <>
                  {menuButton("Open in new tab", () => addTab(menu.item!.path))}
                  {menuButton("Open in new window", () =>
                    onOpenWindow
                      ? onOpenWindow(menu.item!.path)
                      : addTab(menu.item!.path),
                  )}
                  {menuButton("Pin to sidebar", () => pin(menu.item!))}
                </>
              )}
              {menuButton("Open in VS Code", () => {
                void recordOpen(menu.item!.path);
                onOpenInVsCode?.(menu.item!.path);
              })}
              {menu.item.type === "file" &&
                workspaceFileCanPreview(menu.item.name) &&
                menuButton("Open Preview", () => {
                  void recordOpen(menu.item!.path);
                  onPreviewFile?.(previewFile(menu.item!));
                })}
              {menu.item.type === "file" &&
                editableImage(menu.item.name) &&
                menuButton("Edit image", () =>
                  onEditImage?.(previewFile(menu.item!)),
                )}
              <hr />
              {menuButton("Cut", () =>
                setClipboard({ items: contextItems, cut: true }),
              )}
              {menuButton("Copy", () =>
                setClipboard({ items: contextItems, cut: false }),
              )}
              {menuButton("Rename", () =>
                setDialog({
                  mode: "rename",
                  initial: menu.item!.name,
                  item: menu.item,
                }),
              )}
              {menuButton("Duplicate", () =>
                safelyRun(
                  contextItems.map((i) => ({
                    action: "copy",
                    path: i.path,
                    destination: parentPath(i.path),
                    conflict: "keep-both",
                    name:
                      i.type === "file" && i.name.lastIndexOf(".") > 0
                        ? `${i.name.slice(0, i.name.lastIndexOf("."))} copy${i.name.slice(i.name.lastIndexOf("."))}`
                        : `${i.name} copy`,
                  })),
                ),
              )}
              {menuButton("Move to…", () =>
                setDialog({
                  mode: "destination",
                  initial: tab.path || "~/workspace/",
                  action: "move",
                }),
              )}
              {menuButton("Copy to…", () =>
                setDialog({
                  mode: "destination",
                  initial: tab.path || "~/workspace/",
                  action: "copy",
                }),
              )}
              {menuButton(
                contextItems.length > 1 || menu.item.type === "folder"
                  ? "Download ZIP"
                  : "Download",
                () => {
                  if (contextItems.length === 1 && menu.item!.type === "file") {
                    const a = document.createElement("a");
                    a.href = workspaceDownloadUrl(menu.item!.path);
                    a.download = menu.item!.name;
                    a.click();
                  } else
                    safelyRun([
                      {
                        action: "archive",
                        paths: contextItems.map((i) => i.path),
                      },
                    ]);
                },
              )}
              {menuButton(
                "Copy path",
                () =>
                  void navigator.clipboard
                    .writeText(`~/workspace/${menu.item!.path}`)
                    .then(() => show("Path copied"))
                    .catch(() => show("Clipboard permission is unavailable")),
              )}
              {menuButton("Open containing folder", () =>
                navigate(parentPath(menu.item!.path)),
              )}
              <hr />
              {menuButton("Move to Trash", () => void remove(contextItems))}
            </>
          )}
        </div>
      )}
      {dialog && (
        <NameDialog
          title={
            {
              folder: "New folder",
              file: "New file",
              rename: "Rename",
              destination: `${dialog.action === "copy" ? "Copy" : "Move"} to folder`,
              restore: "Restore to folder",
              locate: "Locate pinned folder",
            }[dialog.mode]
          }
          initial={dialog.initial}
          label={
            ["destination", "restore", "locate"].includes(dialog.mode)
              ? "Folder path"
              : "Name"
          }
          onClose={() => setDialog(null)}
          onSubmit={async (value) => {
            if (dialog.mode === "folder")
              await createWorkspaceFolder(tab.path, value);
            else if (dialog.mode === "file") {
              const created = await createWorkspaceTextFile(tab.path, value);
              onOpenInVsCode?.(created.item.path);
            } else if (dialog.mode === "rename")
              safelyRun([
                {
                  action: "rename",
                  path: dialog.item!.path,
                  destination: parentPath(dialog.item!.path),
                  name: value,
                  version: dialog.item!.version,
                },
              ]);
            else if (dialog.mode === "locate") {
              const p = normalizedPath(value);
              const info = await fileInfo(p);
              if (info.item.type !== "folder")
                throw new Error("Choose a folder");
              await pins(
                data.pins.map((pin) =>
                  pin.path === dialog.pin!.path
                    ? { path: p, label: base(p) }
                    : pin,
                ),
              );
            } else
              safelyRun(
                selected.map((item) =>
                  dialog.mode === "restore"
                    ? {
                        action: "restore",
                        id: item.id,
                        destination: normalizedPath(value),
                      }
                    : {
                        action: dialog.action || "move",
                        path: item.path,
                        destination: normalizedPath(value),
                        version: item.version,
                      },
                ),
              );
            reload();
          }}
        />
      )}
      {ask && (
        <ExplorerDialog title={ask.title} onClose={() => answer("cancel")}>
          <p>{ask.message}</p>
          {ask.conflict && (
            <>
              <p>
                Replace moves the existing item to Trash. Folders are replaced
                in full, not merged.
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={applyAll}
                  onChange={(e) => setApplyAll(e.target.checked)}
                />
                Apply to remaining conflicts
              </label>
            </>
          )}
          <footer>
            <button onClick={() => answer("cancel")}>Cancel</button>
            {ask.conflict ? (
              <>
                <button onClick={() => answer("skip")}>Skip</button>
                <button onClick={() => answer("keep-both")}>Keep both</button>
                <button onClick={() => answer("replace")}>Replace</button>
              </>
            ) : (
              <button onClick={() => answer("confirm")}>
                Delete permanently
              </button>
            )}
          </footer>
        </ExplorerDialog>
      )}
    </div>
  );
}
