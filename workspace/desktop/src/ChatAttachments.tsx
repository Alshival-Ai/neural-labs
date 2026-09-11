import { createPortal } from "react-dom";
import { MoreHorizontal, Paperclip } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ExplorerDialog } from "./ExplorerDialog";
import { readDeviceState, writeDeviceState } from "./deviceState";
import { createWorkspaceFolder, listWorkspaceDirectory, requestJson, workspaceContentUrl, workspaceDownloadUrl, type WorkspaceDirectory, type WorkspaceEntry } from "./filesApi";
import { cancelOperation, getOperation, startOperation, transferUpload, type Conflict } from "./explorerApi";
import type { NeuraAttachment } from "./types";
import type { TeamAttachment } from "./teamChat";
import "./preview-app.css";

export type ChatAttachment = NeuraAttachment | TeamAttachment;
type RefreshAttachment = (attachment: ChatAttachment) => Promise<ChatAttachment>;
const mediaPrefix = "/workspace/api/neura/media/outgoing/";
const errorCode = (error: unknown) => (error as { code?: string })?.code;
const errorStatus = (error: unknown) => (error as { status?: number })?.status;
const messageFor = (error: unknown) => error instanceof Error ? error.message : "The attachment is unavailable.";
function sourceUrl(item: ChatAttachment): string | undefined {
  if (item.path) return workspaceContentUrl(item.path);
  if (!("url" in item) || !item.url) return undefined;
  if (/^(data:|blob:)/i.test(item.url)) return item.url;
  let url: URL;
  try { url = new URL(item.url, window.location.origin); } catch { return undefined; }
  if (url.origin === window.location.origin && (url.pathname.startsWith(mediaPrefix) || url.pathname === "/workspace/api/files/content" || url.pathname === "/workspace/api/files/download")) return url.pathname + url.search;
  return undefined;
}
function isImage(item: ChatAttachment) { return item.type?.startsWith("image/") || /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(item.name); }
function isVideo(item: ChatAttachment) {
  if (item.type?.toLowerCase().startsWith("audio/")) return false;
  return item.type?.toLowerCase().startsWith("video/") || /\.(mp4|m4v|mov|webm|ogv)$/i.test(item.name);
}
function isAudio(item: ChatAttachment) { return item.type?.startsWith("audio/") || /\.(m4a|mp3|oga|ogg|wav|webm)$/i.test(item.name); }

function AttachmentVideo({ url, name, onError }: { url: string; name: string; onError: () => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "200px" });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return <video ref={ref} controls playsInline preload="metadata" aria-label={`Play ${name}`} src={visible ? url : undefined} onError={onError}
    onLoadedMetadata={(event) => {
      const video = event.currentTarget;
      // Decode a first-frame preview without autoplay or a second media download.
      if (video.paused && video.currentTime === 0 && Number.isFinite(video.duration) && video.duration > 0) video.currentTime = Math.min(.1, video.duration / 2);
    }} />;
}
function clickDownload(url: string, name: string) {
  const link = document.createElement("a"); link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
}
export function MessageAttachments({ attachments, className = "message-attachments", notify = () => {}, storageNamespace, refreshAttachment }: {
  attachments: ChatAttachment[]; className?: string; notify?: (message: string) => void; storageNamespace?: string; refreshAttachment?: RefreshAttachment;
}) {
  return <div className={className}>{attachments.map((item, index) => <AttachmentCard key={`${"artifactId" in item ? item.artifactId : item.path ?? item.name}:${index}`} attachment={item} notify={notify} storageNamespace={storageNamespace} refreshAttachment={refreshAttachment} />)}</div>;
}
function AttachmentCard({ attachment, notify, storageNamespace, refreshAttachment }: {
  attachment: ChatAttachment; notify: (message: string) => void; storageNamespace?: string; refreshAttachment?: RefreshAttachment;
}) {
  const [item, setItem] = useState(attachment);
  const [menu, setMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ left: 8, top: 8 });
  const [preview, setPreview] = useState(false);
  const [save, setSave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refreshingImage = useRef(false);
  const refreshingVideo = useRef(false);
  const actionPending = useRef(false);
  const lifetime = useRef(new AbortController());
  const copyJob = useRef<string | undefined>(undefined);
  useEffect(() => {
    lifetime.current = new AbortController();
    return () => { lifetime.current.abort(); if (copyJob.current) void cancelOperation(copyJob.current).catch(() => {}); };
  }, []);
  const button = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const menuRoot = useRef<HTMLDivElement>(null);
  useEffect(() => { setItem(attachment); setError(""); refreshingImage.current = false; refreshingVideo.current = false; }, [attachment]);
  useEffect(() => {
    if (!menu) return;
    menuRoot.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !menuRoot.current?.contains(event.target as Node)) setMenu(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [menu]);
  const openMenu = (x?: number, y?: number) => {
    const bounds = button.current?.getBoundingClientRect();
    setMenuPosition({ left: Math.max(8, Math.min(x ?? bounds?.left ?? 8, window.innerWidth - Math.min(230, window.innerWidth - 16) - 8)), top: Math.max(8, Math.min(y ?? bounds?.bottom ?? 8, window.innerHeight - 110)) });
    setMenu(true);
  };
  const closeMenu = () => { setMenu(false); button.current?.focus(); };
  const fresh = async () => {
    if (!refreshAttachment) throw new Error("This attachment is unavailable. Reload the conversation and try again.");
    const updated = await refreshAttachment(item); setItem(updated); return updated;
  };
  const withRefresh = async <T,>(operation: (attachment: ChatAttachment) => Promise<T>): Promise<T> => {
    try { return await operation(item); }
    catch (error) {
      if (refreshAttachment && [401, 403, 404].includes(errorStatus(error) ?? 0)) return operation(await fresh());
      throw error;
    }
  };
  const download = async () => {
    if (actionPending.current) return;
    actionPending.current = true; setBusy(true); setError(""); closeMenu();
    try {
      await withRefresh(async (current) => {
        if (current.path) { clickDownload(workspaceDownloadUrl(current.path), current.name); return; }
        const url = sourceUrl(current);
        if (!url) throw new Error("This attachment is still loading or no longer available.");
        if (url.startsWith(mediaPrefix)) {
          const target = new URL(url, window.location.origin);
          target.searchParams.set("download", "1"); target.searchParams.set("name", current.name);
          const probe = await fetch(target, { method: "HEAD", credentials: "same-origin", signal: lifetime.current.signal });
          if (!probe.ok) throw Object.assign(new Error("This attachment is unavailable. Reload it and try again."), { status: probe.status });
          clickDownload(target.href, current.name);
        } else {
          const response = await fetch(url, { signal: lifetime.current.signal });
          if (!response.ok) throw new Error("This attachment is unavailable.");
          const objectUrl = URL.createObjectURL(await response.blob());
          clickDownload(objectUrl, current.name); window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
        }
      });
    } catch (error) { setError(messageFor(error)); }
    finally { actionPending.current = false; setBusy(false); }
  };
  const saveToWorkspace = (directory: string, name: string, conflict?: Conflict) => withRefresh(async (current) => {
    if (current.path) {
      const target = directory ? `${directory}/${name}` : name;
      if (target === current.path && conflict !== "keep-both") throw Object.assign(new Error("The attachment is already here. Choose Keep both or another location."), { code: "already_exists" });
      let operation = await startOperation([{ action: "copy", path: current.path, destination: directory, name, conflict }]);
      copyJob.current = operation.id;
      while (["queued", "running"].includes(operation.state)) {
        lifetime.current.signal.throwIfAborted();
        await new Promise((resolve) => window.setTimeout(resolve, 250)); operation = await getOperation(operation.id);
      }
      copyJob.current = undefined;
      const result = operation.results[0];
      if (operation.state !== "finished" || result?.status !== "completed" || !result.destination) throw Object.assign(new Error(result?.message ?? "Could not copy this attachment."), { code: result?.code });
      return result.destination;
    }
    const url = sourceUrl(current);
    if (!url) throw new Error("This attachment is still loading or no longer available.");
    if (url.startsWith(mediaPrefix)) {
      const result = await requestJson<{ item: WorkspaceEntry }>("/workspace/api/files/import-neura", {
        method: "POST", signal: lifetime.current.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mediaUrl: url, destination: directory, name, conflict }),
      });
      return result.item.path;
    }
    const response = await fetch(url, { signal: lifetime.current.signal });
    if (!response.ok) throw new Error("This attachment is unavailable.");
    const result = await transferUpload(directory, await response.blob(), name, { conflict, signal: lifetime.current.signal });
    if (!result.item) throw new Error("The attachment was not saved.");
    return result.item.path;
  });
  const imageFailed = async () => {
    if (refreshingImage.current) { setError("This image is unavailable. Reload the conversation and try again."); return; }
    refreshingImage.current = true;
    try { await fresh(); } catch (error) { setError(messageFor(error)); }
  };
  const url = sourceUrl(item);
  const videoFailed = async () => {
    if (!refreshingVideo.current && refreshAttachment && url?.startsWith(mediaPrefix)) {
      refreshingVideo.current = true;
      try { if (sourceUrl(await fresh()) !== url) return; } catch { /* Keep the download action available. */ }
    }
    setError("This video couldn't be played here. Use Download to watch it in another player, or reload the conversation and try again.");
  };
  const actions = <><button type="button" disabled={busy} onClick={() => { closeMenu(); setSave(true); }}>Download to Workspace</button><button type="button" disabled={busy} onClick={() => void download()}>Download</button></>;
  return <div ref={root} className={`chat-attachment${isImage(item) ? " is-image" : isVideo(item) ? " is-video" : ""}`} onContextMenu={(event) => { if ((event.target as HTMLElement).closest("dialog,video")) return; event.preventDefault(); openMenu(event.clientX, event.clientY); }}>
    {isImage(item) ? url ? <button type="button" className="attachment-image-open" aria-label={`Preview ${item.name}`} onClick={() => setPreview(true)}><img src={url} alt={item.name} loading="lazy" onError={() => void imageFailed()} /></button> : <span aria-label={item.name}>Image unavailable</span>
      : isVideo(item) ? <figure className="attachment-video">{url ? <AttachmentVideo url={url} name={item.name} onError={() => void videoFailed()} /> : <p>Video unavailable</p>}<figcaption>{item.name}</figcaption></figure>
      : <div className={`attachment-card${isAudio(item) ? " attachment-audio" : ""}`}>
        {isAudio(item) && url ? <audio controls preload="metadata" src={url} /> : <Paperclip />}
        <button type="button" className="attachment-file-open" onClick={() => void download()} disabled={busy}><strong>{item.name}</strong>{item.size !== undefined && <small>{item.size < 1024 ? `${item.size} B` : `${Math.ceil(item.size / 1024)} KB`}</small>}</button>
      </div>}
    <button ref={button} type="button" className="attachment-menu-toggle" aria-label={`Actions for ${item.name}`} aria-haspopup="menu" aria-expanded={menu} onClick={() => menu ? closeMenu() : openMenu()} onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ContextMenu" || event.key === "F10" && event.shiftKey) { event.preventDefault(); openMenu(); } }}><MoreHorizontal /></button>
    {menu && createPortal(<div ref={menuRoot} className="attachment-actions" style={{ position: "fixed", ...menuPosition }} role="menu" aria-label={`Attachment actions for ${item.name}`} onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); closeMenu(); }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault(); const buttons = Array.from(menuRoot.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length]?.focus();
      }
      if (event.key === "Tab") setMenu(false);
    }}><button role="menuitem" type="button" disabled={busy} onClick={() => { closeMenu(); setSave(true); }}>Download to Workspace</button><button role="menuitem" type="button" disabled={busy} onClick={() => void download()}>Download</button></div>, document.body)}
    {error && <p className="attachment-error" role="alert">{error}</p>}
    {preview && <ExplorerDialog title="Image preview" onClose={() => setPreview(false)}><div className="preview-canvas is-image chat-image-preview"><img src={url} alt={item.name} onError={() => void imageFailed()} /></div><footer>{actions}<button type="button" onClick={() => setPreview(false)}>Close</button></footer></ExplorerDialog>}
    {save && <SaveAttachmentDialog name={item.name} sourcePath={item.path} storageNamespace={storageNamespace} onClose={() => setSave(false)} onSave={saveToWorkspace} onSaved={(path) => notify(`Saved to Workspace: ${path}`)} />}
  </div>;
}

export function SaveAttachmentDialog({ name: initialName, sourcePath, storageNamespace, onClose, onSave, onSaved }: {
  name: string; sourcePath?: string; storageNamespace?: string; onClose: () => void;
  onSave: (directory: string, name: string, conflict?: Conflict) => Promise<string>; onSaved: (path: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const [directory, setDirectory] = useState<WorkspaceDirectory>();
  const [missingDownloads, setMissingDownloads] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [collision, setCollision] = useState(false);
  const revision = useRef(0);
  const saving = useRef(false);
  const navigate = async (path: string, fallback = false) => {
    const current = ++revision.current; setLoading(true); setError(""); setCollision(false);
    try {
      const result = await listWorkspaceDirectory(path);
      if (revision.current === current) { setDirectory(result); setMissingDownloads(false); }
    } catch (error) {
      if (revision.current !== current) return;
      if (errorCode(error) === "not_found" && fallback && path !== "Downloads") { await navigate("Downloads", true); return; }
      if (errorCode(error) === "not_found" && path === "Downloads") { setDirectory({ path, parent: "", entries: [] }); setMissingDownloads(true); }
      else setError(messageFor(error));
    } finally { if (revision.current === current) setLoading(false); }
  };
  useEffect(() => {
    const stored = readDeviceState(storageNamespace, "chat-downloads") as { directory?: string } | undefined;
    void navigate(typeof stored?.directory === "string" ? stored.directory : "Downloads", true);
    return () => { revision.current += 1; };
  }, [storageNamespace]);
  const submit = async (conflict?: Conflict) => {
    if (!directory || saving.current || loading || !name.trim()) return;
    saving.current = true; setBusy(true); setError("");
    try {
      if (missingDownloads) {
        try { await createWorkspaceFolder("", "Downloads"); }
        catch (error) { if (errorCode(error) !== "already_exists") throw error; }
      }
      const path = await onSave(directory.path, name.trim(), conflict);
      writeDeviceState(storageNamespace, "chat-downloads", { directory: directory.path });
      onSaved(path); onClose();
    } catch (error) { setError(messageFor(error)); setCollision(errorCode(error) === "already_exists"); }
    finally { saving.current = false; setBusy(false); }
  };
  const sameSource = Boolean(sourcePath && directory && `${directory.path ? directory.path + "/" : ""}${name.trim()}` === sourcePath);
  return <ExplorerDialog title="Download to Workspace" onClose={() => { if (!saving.current) onClose(); }}>
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <p>Workspace files are shared with approved workspace users.</p>
      <div className="attachment-folder-picker" aria-busy={loading}>
        <strong>Folder: {directory?.path || "Workspace"}</strong>
        <button type="button" disabled={busy || loading || directory?.parent === null} onClick={() => void navigate(directory?.parent ?? "")}>Up</button>
        <button type="button" disabled={busy || loading} onClick={() => void navigate("")}>Workspace root</button>
        {loading ? <p role="status">Loading folders…</p> : <ul aria-label="Workspace folders">{directory?.entries.filter((entry) => entry.type === "folder").map((entry) => <li key={entry.path}><button type="button" disabled={busy} onClick={() => void navigate(entry.path)}>{entry.name}</button></li>)}</ul>}
      </div>
      <label>Filename<input required value={name} disabled={busy} onChange={(event) => { setName(event.target.value); setCollision(false); }} /></label>
      {error && <p role="alert">{error}</p>}
      <footer><button type="button" disabled={busy} onClick={onClose}>Cancel</button>{collision ? <><button type="button" disabled={busy} onClick={() => void submit("keep-both")}>Keep both</button><button type="button" disabled={busy || sameSource} onClick={() => void submit("replace")}>Replace</button></> : <button type="submit" disabled={busy || loading || !directory || !name.trim()}>{busy ? "Saving…" : "Save"}</button>}</footer>
    </form>
  </ExplorerDialog>;
}
