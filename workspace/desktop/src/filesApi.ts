export type WorkspaceEntry = {
  name: string;
  path: string;
  type: "file" | "folder";
  size: number | null;
  modifiedAt: string;
  mimeType: string | null;
};

export type WorkspaceDirectory = {
  path: string;
  parent: string | null;
  entries: WorkspaceEntry[];
};

export type WorkspaceFileChange = {
  sequence: number;
  paths: string[];
};

export type WorkspaceTextFile = {
  item: WorkspaceEntry;
  content: string;
  version: string;
};

export type WorkspacePreviewFile = {
  name: string;
  path: string;
  size: number;
  mimeType: string;
};

export type WorkspaceVsCodeTarget = {
  path: string;
  type: "file" | "folder";
};

const PREVIEWABLE_EXTENSIONS = new Set([
  "aac", "avif", "bmp", "csv", "flac", "gif", "htm", "html", "ico", "jpeg", "jpg", "m4a", "m4v", "mov",
  "mp3", "mp4", "oga", "ogg", "ogv", "pdf", "png", "svg", "wav", "webm", "webp", "xlsx",
]);

export function workspaceFileCanPreview(name: string): boolean {
  const extension = name.includes(".") ? name.split(".").at(-1)?.toLowerCase() ?? "" : "";
  return PREVIEWABLE_EXTENSIONS.has(extension);
}

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  const response = await fetch(url, { ...init, headers, credentials: "same-origin" });
  if (!response.ok) {
    const fallback = `File operation failed with HTTP ${response.status}`;
    let message = fallback;
    try {
      const body = await response.json() as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {}
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

function pathQuery(path: string, extra?: Record<string, string>): string {
  const params = new URLSearchParams({ path, ...extra });
  return params.toString();
}

export function listWorkspaceDirectory(path: string, signal?: AbortSignal) {
  return requestJson<WorkspaceDirectory>(`/workspace/api/files?${pathQuery(path)}`, { signal });
}

export function subscribeWorkspaceFiles(onChange: (change: WorkspaceFileChange) => void) {
  const events = new EventSource("/workspace/api/files/events");
  const changed = (event: Event) => {
    try {
      const value = JSON.parse((event as MessageEvent<string>).data) as WorkspaceFileChange;
      if (Number.isSafeInteger(value.sequence) && Array.isArray(value.paths) && value.paths.every((path) => typeof path === "string")) {
        onChange(value);
      }
    } catch {}
  };
  events.addEventListener("files-changed", changed);
  return () => {
    events.removeEventListener("files-changed", changed);
    events.close();
  };
}

export async function createWorkspaceFolder(path: string, name: string) {
  return requestJson<{ item: WorkspaceEntry }>("/workspace/api/files/folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, name }),
  });
}

export function readWorkspaceTextFile(path: string, signal?: AbortSignal) {
  return requestJson<WorkspaceTextFile>(`/workspace/api/files/text?${pathQuery(path)}`, { signal });
}

export function createWorkspaceTextFile(path: string, name: string, content = "") {
  return requestJson<WorkspaceTextFile>(
    `/workspace/api/files/text?${pathQuery(path, { name })}`,
    {
      method: "POST",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: content,
    },
  );
}

export function saveWorkspaceTextFile(path: string, content: string, version: string) {
  return requestJson<WorkspaceTextFile>(
    `/workspace/api/files/text?${pathQuery(path, { version })}`,
    {
      method: "PUT",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: content,
    },
  );
}

export async function uploadWorkspaceFile(path: string, file: File) {
  return requestJson<{ item: WorkspaceEntry }>(
    `/workspace/api/files/upload?${pathQuery(path, { name: file.name })}`,
    {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    },
  );
}

export async function deleteWorkspaceEntry(path: string) {
  return requestJson<{ deleted: true; path: string }>(`/workspace/api/files?${pathQuery(path)}`, {
    method: "DELETE",
  });
}

export function workspaceDownloadUrl(path: string): string {
  return `/workspace/api/files/download?${pathQuery(path)}`;
}

export function workspaceContentUrl(path: string): string {
  return `/workspace/api/files/content?${pathQuery(path)}`;
}

export function openWorkspaceInVsCode(path: string) {
  return requestJson<{ opened: WorkspaceVsCodeTarget }>("/workspace/api/vscode/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
}

export function createWorkspaceWebsitePreview(path: string) {
  if (!validPreviewPath(path)) return Promise.reject(new Error("The website preview path is invalid."));
  const separator = path.lastIndexOf("/");
  const root = separator < 0 ? "" : path.slice(0, separator);
  const entry = separator < 0 ? path : path.slice(separator + 1);
  return requestJson<{ url: string; expiresAt: string }>("/workspace/api/previews", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ root, entry }),
  });
}

function validPreviewPath(value: string): boolean {
  if (!value || value.includes("\\") || value.startsWith("/")) return false;
  return value.split("/").every((segment) => Boolean(segment) && segment !== "." && segment !== "..");
}
