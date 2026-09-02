import { watch } from "node:fs";
import path from "node:path";

const TEMPORARY_UPLOAD_PREFIX = ".neural-labs-upload-";

function normalizeWatchedPath(filename) {
  if (filename === null || filename === undefined) return "";
  const relativePath = filename.toString().replaceAll("\\", "/");
  return relativePath.split("/").some((segment) => segment.startsWith(TEMPORARY_UPLOAD_PREFIX))
    ? null
    : relativePath;
}

export function createWorkspaceFileEvents({
  root,
  debounceMs = 120,
  heartbeatMs = 25_000,
  watchFileSystem = watch,
}) {
  if (!root || !path.isAbsolute(root)) {
    throw new Error("Workspace file event root must be an absolute path");
  }

  const clients = new Set();
  const changedPaths = new Set();
  let watcher;
  let broadcastTimer;
  let heartbeatTimer;
  let sequence = 0;
  let closed = false;

  function broadcast(eventName, value) {
    const payload = `event: ${eventName}\ndata: ${JSON.stringify(value)}\n\n`;
    for (const response of clients) {
      if (response.destroyed || response.writableEnded) {
        clients.delete(response);
        continue;
      }
      try {
        response.write(payload);
      } catch {
        response.destroy();
        clients.delete(response);
      }
    }
  }

  function flushChanges() {
    broadcastTimer = undefined;
    if (changedPaths.size === 0) return;
    sequence += 1;
    const paths = [...changedPaths].sort();
    changedPaths.clear();
    broadcast("files-changed", { sequence, paths });
  }

  function scheduleChange(filename) {
    const relativePath = normalizeWatchedPath(filename);
    if (relativePath === null) return;
    changedPaths.add(relativePath);
    if (broadcastTimer) clearTimeout(broadcastTimer);
    broadcastTimer = setTimeout(flushChanges, debounceMs);
    broadcastTimer.unref?.();
  }

  function stopWatching() {
    if (broadcastTimer) clearTimeout(broadcastTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    broadcastTimer = undefined;
    heartbeatTimer = undefined;
    changedPaths.clear();
    watcher?.close();
    watcher = undefined;
  }

  function failWatcher(error) {
    console.error("Workspace file watcher error", error instanceof Error ? error.message : error);
    stopWatching();
    for (const response of [...clients]) response.end();
  }

  function startWatching() {
    if (watcher || closed) return;
    watcher = watchFileSystem(root, { persistent: false, recursive: true }, (_eventType, filename) => {
      scheduleChange(filename);
    });
    watcher.on("error", failWatcher);
    heartbeatTimer = setInterval(() => {
      for (const response of clients) {
        if (!response.destroyed && !response.writableEnded) response.write(": keepalive\n\n");
      }
    }, heartbeatMs);
    heartbeatTimer.unref?.();
  }

  function subscribe(response) {
    if (closed) throw new Error("Workspace file event stream is closed");
    startWatching();
    response.writeHead(200, {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    });
    response.flushHeaders?.();
    response.write("retry: 3000\n\n");
    clients.add(response);

    response.once("close", () => {
      clients.delete(response);
      if (clients.size === 0) stopWatching();
    });
  }

  function close() {
    if (closed) return;
    closed = true;
    stopWatching();
    for (const response of [...clients]) response.end();
    clients.clear();
  }

  return { subscribe, close };
}
