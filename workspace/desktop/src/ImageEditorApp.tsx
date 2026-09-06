import { useCallback, useEffect, useRef, useState } from "react";
import { fileInfo, recordOpen, transferUpload } from "./explorerApi";
import { workspaceDownloadUrl, type WorkspacePreviewFile } from "./filesApi";
import { ExplorerDialog, NameDialog } from "./ExplorerDialog";
import "./explorer.css";

type EditorMessage = {
  type: string;
  bytes?: ArrayBuffer;
  mimeType?: string;
  requestId?: string;
  revision?: number;
  message?: string;
  format?: string;
};
const parent = (p: string) =>
  p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
const name = (p: string) => p.split("/").at(-1) || "untitled.png";
const format = (p: string) =>
  p.endsWith(".minipaint.json")
    ? "project"
    : /\.jpe?g$/i.test(p)
      ? "image/jpeg"
      : /\.webp$/i.test(p)
        ? "image/webp"
        : "image/png";
export function ImageEditorApp({
  file,
  onDirtyChange,
}: {
  file?: WorkspacePreviewFile;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const port = useRef<MessagePort | null>(null);
  const [ready, setReady] = useState(false);
  const [current, setCurrent] = useState(file?.path || "");
  const [version, setVersion] = useState<string | undefined>();
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [dialog, setDialog] = useState<"open" | "save-as" | "export" | null>(
    null,
  );
  const [savePath, setSavePath] = useState("");
  const [exportFormat, setExportFormat] = useState("image/png");
  const latest = useRef({ current, version, dirty });
  latest.current = { current, version, dirty };
  const revision = useRef(0);
  const opening = useRef<{ path: string; version?: string } | null>(null);
  const pending = useRef(
    new Map<
      string,
      { resolve: (value: EditorMessage) => void; reject: (e: Error) => void }
    >(),
  );
  const callbacks = useRef({
    save: () => {},
    open: () => {},
    saveAs: () => {},
  });
  const dirtyCallback = useRef(onDirtyChange);
  dirtyCallback.current = onDirtyChange;
  useEffect(() => {
    dirtyCallback.current?.(dirty);
  }, [dirty]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (latest.current.dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      port.current?.close();
      for (const item of pending.current.values())
        item.reject(new Error("Editor closed"));
    };
  }, []);
  const load = useCallback(async (requested: string) => {
    if (
      latest.current.dirty &&
      !window.confirm("Discard unsaved image edits and open another file?")
    )
      return;
    const path = requested.trim().replace(/^~\/workspace\/?/, "");
    if (!path || path.startsWith("/") || path.split("/").includes(".."))
      throw new Error("Enter a workspace-relative file path");
    const before = (await fileInfo(path)).item;
    if (before.type !== "file" || (before.size || 0) > 50 * 1024 * 1024)
      throw new Error("Open a supported image or project up to 50 MB");
    if (
      !/\.(png|jpe?g|webp|avif|bmp)$/i.test(path) &&
      !path.endsWith(".minipaint.json")
    )
      throw new Error(
        "Use PNG, JPEG, WebP, AVIF, BMP or a .minipaint.json project",
      );
    const response = await fetch(workspaceDownloadUrl(path), {
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error("Unable to read this image");
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 50 * 1024 * 1024)
      throw new Error("Images are limited to 50 MB");
    const after = (await fileInfo(path)).item;
    if (before.version !== after.version)
      throw new Error("This image changed while opening. Try again.");
    opening.current = { path, version: before.version };
    setBusy(true);
    setMessage("Opening image…");
    port.current?.postMessage(
      { type: "load", bytes, name: before.name, mimeType: before.mimeType },
      [bytes],
    );
  }, []);
  useEffect(() => {
    if (ready && file) void load(file.path).catch((e) => setMessage(e.message));
  }, [ready, file?.path, load]);
  async function exportBytes(outputFormat: string) {
    if (!port.current || !ready) throw new Error("The editor is still loading");
    const requestId = crypto.randomUUID();
    return new Promise<EditorMessage>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.current.delete(requestId);
        reject(new Error("Image export timed out"));
      }, 30_000);
      pending.current.set(requestId, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (e) => {
          clearTimeout(timeout);
          reject(e);
        },
      });
      port.current!.postMessage({
        type: "export",
        requestId,
        format: outputFormat,
      });
    });
  }
  async function save(
    path: string,
    outputFormat = format(path),
    replace = false,
    keepProject = false,
  ) {
    const requested = path.trim().replace(/^~\/workspace\/?/, "");
    const extension =
      outputFormat === "project"
        ? ".minipaint.json"
        : outputFormat === "image/jpeg"
          ? ".jpg"
          : outputFormat === "image/webp"
            ? ".webp"
            : ".png";
    const validExtension =
      outputFormat === "image/jpeg"
        ? /\.jpe?g$/i.test(requested)
        : requested.endsWith(extension);
    if (!validExtension)
      throw new Error(`Use the ${extension} extension for this format`);
    if (
      !requested ||
      requested.startsWith("/") ||
      requested.split("/").some((s) => !s || s === ".." || s === ".")
    )
      throw new Error("Choose a valid workspace path");
    setBusy(true);
    try {
      const exported = await exportBytes(outputFormat);
      if (!(exported.bytes instanceof ArrayBuffer))
        throw new Error("The editor returned no image data");
      const result = await transferUpload(
        parent(requested),
        new Blob([exported.bytes], { type: exported.mimeType }),
        name(requested),
        { version: replace ? latest.current.version : undefined },
      );
      if (!result.item) throw new Error("The image was not saved");
      if (!keepProject) {
        setCurrent(result.item.path);
        setVersion(result.item.version);
        if (exported.revision === revision.current) setDirty(false);
      }
      setMessage(
        `Saved ${result.item.path}${keepProject ? ". The layered project remains open." : ""}`,
      );
    } catch (e) {
      setMessage((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  function saveCurrent() {
    const value = latest.current;
    if (!value.current || /\.(avif|bmp)$/i.test(value.current)) {
      setSavePath(
        value.current.replace(/\.(avif|bmp)$/i, ".png") ||
          "untitled.minipaint.json",
      );
      setDialog("save-as");
      return;
    }
    void save(value.current, format(value.current), true).catch(() => {});
  }
  callbacks.current = {
    save: saveCurrent,
    open: () => setDialog("open"),
    saveAs: () => {
      setSavePath(
        current
          ? current.replace(/\.minipaint\.json$|\.[^.]+$/, ".minipaint.json")
          : "untitled.minipaint.json",
      );
      setDialog("save-as");
    },
  };
  function connect() {
    port.current?.close();
    const channel = new MessageChannel();
    port.current = channel.port1;
    channel.port1.onmessage = ({ data }: MessageEvent<EditorMessage>) => {
      if (!data || typeof data.type !== "string") return;
      if (typeof data.revision === "number")
        revision.current = Math.max(revision.current, data.revision);
      if (data.type === "ready") setReady(true);
      else if (data.type === "dirty") setDirty(true);
      else if (data.type === "loaded") {
        if (opening.current) {
          setCurrent(opening.current.path);
          setVersion(opening.current.version);
          void recordOpen(opening.current.path).catch(() => {});
          opening.current = null;
        }
        setDirty(false);
        setBusy(false);
        setMessage("");
      } else if (data.type === "exported" && data.requestId) {
        pending.current.get(data.requestId)?.resolve(data);
        pending.current.delete(data.requestId);
      } else if (data.type === "error") {
        if (opening.current) {
          // A rejected project may have partially changed miniPaint's canvas.
          // Require Save As rather than associating it with the previous file.
          setCurrent("");
          setVersion(undefined);
          setDirty(true);
        }
        opening.current = null;
        setMessage(data.message || "Image editor error");
        setBusy(false);
        if (data.requestId) {
          pending.current.get(data.requestId)?.reject(new Error(data.message));
          pending.current.delete(data.requestId);
        }
      } else if (data.type === "save") callbacks.current.save();
      else if (data.type === "save-as") callbacks.current.saveAs();
      else if (data.type === "open") callbacks.current.open();
    };
    channel.port1.start();
    // The sandbox has an opaque origin. The channel is transferred only to this exact iframe window.
    iframe.current?.contentWindow?.postMessage(
      { type: "neural-image-connect" },
      "*",
      [channel.port2],
    );
  }
  return (
    <div
      className="image-editor-app"
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#eef1f6",
        color: "#182337",
      }}
    >
      <header
        className="explorer"
        style={{
          height: "auto",
          flexShrink: 0,
          gap: 6,
          padding: 8,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <strong style={{ marginRight: "auto" }}>
          {current ? name(current) : "Untitled image"}
          {dirty ? " •" : ""}
        </strong>
        <button disabled={!ready || busy} onClick={() => setDialog("open")}>
          Open
        </button>
        <button disabled={!ready || busy} onClick={saveCurrent}>
          Save
        </button>
        <button disabled={!ready || busy} onClick={callbacks.current.saveAs}>
          Save As
        </button>
        <button
          disabled={!ready || busy}
          onClick={() => {
            setSavePath(
              current
                ? current.replace(/\.minipaint\.json$|\.[^.]+$/, ".png")
                : "untitled.png",
            );
            setDialog("export");
          }}
        >
          Export image
        </button>
      </header>
      {message && (
        <p role="status" style={{ padding: "5px 12px", margin: 0 }}>
          {message}
        </p>
      )}
      <iframe
        ref={iframe}
        title="miniPaint Image Editor"
        src="/workspace/image-editor/index.html"
        sandbox="allow-scripts"
        onLoad={connect}
        style={{ flex: 1, width: "100%", minHeight: 0, border: 0 }}
      />
      {dialog === "open" && (
        <NameDialog
          title="Open workspace image"
          label="File path"
          initial={current || "~/workspace/"}
          onClose={() => setDialog(null)}
          onSubmit={load}
        />
      )}
      {dialog === "save-as" && (
        <NameDialog
          title="Save image or layered project as"
          label="Workspace path (.minipaint.json preserves layers; PNG/JPEG/WebP flatten)"
          initial={savePath}
          onClose={() => setDialog(null)}
          onSubmit={async (value) => {
            if (
              !/\.(png|jpe?g|webp)$/i.test(value) &&
              !value.endsWith(".minipaint.json")
            )
              throw new Error("Use .minipaint.json, .png, .jpg, or .webp");
            await save(value);
          }}
        />
      )}
      {dialog === "export" && (
        <ExplorerDialog
          title="Export flattened image"
          onClose={() => setDialog(null)}
        >
          <p>
            Export creates a flattened image. Keep a .minipaint.json project to
            preserve editable layers.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await save(savePath, exportFormat, false, true);
                setDialog(null);
              } catch {
                /* Keep the dialog and unsaved editor state. */
              }
            }}
          >
            <label>
              Format
              <select
                value={exportFormat}
                onChange={(e) => {
                  setExportFormat(e.target.value);
                  setSavePath(
                    savePath.replace(
                      /\.[^.]+$/,
                      e.target.value === "image/jpeg"
                        ? ".jpg"
                        : e.target.value === "image/webp"
                          ? ".webp"
                          : ".png",
                    ),
                  );
                }}
              >
                <option value="image/png">PNG</option>
                <option value="image/jpeg">JPEG</option>
                <option value="image/webp">WebP</option>
              </select>
            </label>
            <label>
              Workspace path
              <input
                required
                value={savePath}
                onChange={(e) => setSavePath(e.target.value)}
              />
            </label>
            <footer>
              <button type="button" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button disabled={busy} type="submit">
                Export
              </button>
            </footer>
          </form>
        </ExplorerDialog>
      )}
    </div>
  );
}
