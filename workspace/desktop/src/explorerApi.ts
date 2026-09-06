import { requestJson, type WorkspaceEntry } from "./filesApi";

const base = "/workspace/api/files";
export type Pin = { path: string; label: string; available?: boolean };
export type Preferences = {
  revision: number;
  pins: Pin[];
  recent: { path: string; openedAt: string }[];
};
export type TrashEntry = WorkspaceEntry & {
  id: string;
  deletedBy: string;
  deletedAt: string;
  expiresAt: string;
};
export type Conflict = "replace" | "keep-both" | "skip";
export type OperationItem = {
  action:
    | "move"
    | "copy"
    | "rename"
    | "trash"
    | "restore"
    | "purge"
    | "archive";
  path?: string;
  destination?: string;
  name?: string;
  version?: string;
  conflict?: Conflict;
  id?: string;
  paths?: string[];
};
export type OperationResult = {
  status: string;
  path?: string;
  destination?: string;
  id?: string;
  code?: string;
  message?: string;
  download?: string;
};
export type Operation = {
  id: string;
  state: string;
  bytes: number;
  completed: number;
  total: number;
  results: OperationResult[];
  items?: OperationItem[];
};
export type Listing = {
  entries: WorkspaceEntry[];
  total?: number;
  nextOffset?: number | null;
  cursor?: string | null;
};
export const params = (
  options: Record<string, string | number | boolean | undefined>,
) =>
  new URLSearchParams(
    Object.entries(options)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  ).toString();
const json = (method: string, body: unknown) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
export const preferences = () =>
  requestJson<Preferences>(`${base}/preferences`);
export const savePins = (data: Preferences, pins: Pin[]) =>
  requestJson<Preferences>(
    `${base}/preferences`,
    json("PUT", { revision: data.revision, pins }),
  );
export const recordOpen = (path: string) =>
  requestJson(`${base}/recent`, json("POST", { path })).catch(() => {});
export const getListing = (
  options: Record<string, string | number | boolean | undefined>,
  signal?: AbortSignal,
) => requestJson<Listing>(`${base}?${params(options)}`, { signal });
export const searchFiles = (
  options: Record<string, string | number | boolean | undefined>,
  signal?: AbortSignal,
) => requestJson<Listing>(`${base}/search?${params(options)}`, { signal });
export const getRecent = (signal?: AbortSignal) =>
  requestJson<Listing>(`${base}/recent`, { signal });
export const getTrash = (signal?: AbortSignal) =>
  requestJson<{ entries: TrashEntry[] }>(`${base}/trash`, { signal });
export const startOperation = (items: OperationItem[]) =>
  requestJson<Operation>(`${base}/operations`, json("POST", { items }));
export const getOperation = (id: string) =>
  requestJson<Operation>(`${base}/operations/${id}`);
export const getOperations = () =>
  requestJson<{ operations: Operation[] }>(`${base}/operations`);
export const cancelOperation = (id: string) =>
  requestJson<Operation>(`${base}/operations/${id}`, { method: "DELETE" });
export const fileInfo = (path: string) =>
  requestJson<{ item: WorkspaceEntry }>(`${base}/info?${params({ path })}`);

export function transferUpload(
  directory: string,
  file: Blob,
  name: string,
  options: {
    signal?: AbortSignal;
    conflict?: Conflict;
    version?: string;
    progress?: (bytes: number) => void;
  } = {},
) {
  return new Promise<{ item?: WorkspaceEntry; skipped?: boolean }>(
    (resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const abort = () => xhr.abort();
      xhr.open(
        options.version ? "PUT" : "POST",
        `${base}/${options.version ? "binary" : "upload"}?${params({ path: directory, name, conflict: options.conflict, version: options.version })}`,
      );
      xhr.withCredentials = true;
      xhr.setRequestHeader(
        "Content-Type",
        file.type || "application/octet-stream",
      );
      xhr.upload.onprogress = (event) => options.progress?.(event.loaded);
      xhr.onload = () => {
        try {
          const value = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) resolve(value);
          else
            reject(
              Object.assign(
                new Error(
                  value.error?.message || `Upload failed (${xhr.status})`,
                ),
                { code: value.error?.code },
              ),
            );
        } catch (e) {
          reject(e);
        }
      };
      xhr.onerror = () => reject(new Error("Upload connection failed"));
      xhr.onabort = () =>
        reject(new DOMException("Upload cancelled", "AbortError"));
      xhr.onloadend = () => options.signal?.removeEventListener("abort", abort);
      if (options.signal?.aborted) {
        reject(new DOMException("Upload cancelled", "AbortError"));
        return;
      }
      options.signal?.addEventListener("abort", abort, { once: true });
      xhr.send(file);
    },
  );
}
