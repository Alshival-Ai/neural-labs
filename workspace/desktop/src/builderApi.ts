import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness";

export type BuilderDraftKind = "skill" | "automation";

export type BuilderDraft = {
  id: string;
  kind: BuilderDraftKind;
  title: string;
  ownerUserId: string;
  ownerDisplayName: string;
  collaboratorUserIds: string[];
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  publishedKey?: string;
  targetKey?: string;
  baseRevision?: string;
  canPublish: boolean;
  canManageCollaborators: boolean;
  administrator: boolean;
};

export type BuilderIssue = {
  level: "error" | "warning";
  code: string;
  message: string;
  file?: string;
};

export type BuilderValidation = {
  kind: BuilderDraftKind;
  revision: string;
  issues: BuilderIssue[];
  draft?: Record<string, string | boolean>;
};

export type BuilderPresence = {
  userId: string;
  displayName: string;
  color: string;
  file?: string;
  selection?: { anchor: number; head: number };
};

export type BuilderTestSnapshot = {
  id: string;
  revision: string;
  prompt: string;
  harness: string;
  createdAt: string;
};

type ApiError = { error?: { message?: string } };

async function json<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(url, { ...init, headers, credentials: "same-origin" });
  if (!response.ok) {
    const payload = await response.json().catch(() => undefined) as ApiError | undefined;
    throw new Error(payload?.error?.message ?? `Builder request failed with HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function hydrateBuilderDocument(doc: Y.Doc, update: string) {
  Y.applyUpdate(doc, bytesFromBase64(update), "hydrate");
}

function base64FromBytes(value: Uint8Array): string {
  let binary = "";
  const stride = 32_768;
  for (let offset = 0; offset < value.length; offset += stride) {
    binary += String.fromCharCode(...value.subarray(offset, offset + stride));
  }
  return btoa(binary);
}

export const builderApi = {
  list: () => json<{ drafts: BuilderDraft[] }>("/workspace/api/builder/drafts"),
  create: (input: { kind: BuilderDraftKind; targetKey?: string; baseRevision?: string; initial?: Record<string, unknown> }) =>
    json<{ draft: BuilderDraft }>("/workspace/api/builder/drafts", { method: "POST", body: JSON.stringify(input) }),
  get: (id: string) => json<{ draft: BuilderDraft; update: string }>(`/workspace/api/builder/drafts/${encodeURIComponent(id)}`),
  discard: (id: string) => json<{ discarded: true }>(`/workspace/api/builder/drafts/${encodeURIComponent(id)}`, { method: "DELETE" }),
  collaborators: (id: string, userIds: string[]) => json<{ draft: BuilderDraft }>(`/workspace/api/builder/drafts/${encodeURIComponent(id)}/collaborators`, { method: "PUT", body: JSON.stringify({ userIds }) }),
  validate: (id: string) => json<BuilderValidation>(`/workspace/api/builder/drafts/${encodeURIComponent(id)}/validate`, { method: "POST", body: "{}" }),
  publish: (id: string) => json<{ kind: BuilderDraftKind; skill?: unknown; draft?: BuilderDraft | Record<string, unknown>; targetKey?: string; baseRevision?: string; revision?: string }>(`/workspace/api/builder/drafts/${encodeURIComponent(id)}/publish`, { method: "POST", body: "{}" }),
  finalizeAutomation: (id: string, jobId?: string, configRevision?: string) => json<{ draft: BuilderDraft }>(`/workspace/api/builder/drafts/${encodeURIComponent(id)}/automation-published`, { method: "POST", body: JSON.stringify({ jobId, configRevision }) }),
  testSnapshot: (id: string, prompt: string) => json<{ test: BuilderTestSnapshot }>(`/workspace/api/builder/drafts/${encodeURIComponent(id)}/test-snapshot`, { method: "POST", body: JSON.stringify({ prompt }) }),
  saveAsset: async (id: string, path: string, file: File) => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error ?? new Error("The asset could not be read"));
      reader.readAsDataURL(file);
    });
    return json<{ asset: { path: string; hash: string; size: number; mimeType: string } }>(`/workspace/api/builder/drafts/${encodeURIComponent(id)}/asset`, { method: "POST", body: JSON.stringify({ path, mimeType: file.type, data: dataUrl.slice(dataUrl.indexOf(",") + 1) }) });
  },
  removeAsset: (id: string, path: string) => json<{ removed: true }>(`/workspace/api/builder/drafts/${encodeURIComponent(id)}/asset?path=${encodeURIComponent(path)}`, { method: "DELETE" }),
};

export function readCustomSkillPackage(key: string) {
  return json<{ skill: unknown; files: Array<{ path: string; kind: "text" | "asset"; content?: string; data?: string; size?: number }> }>(`/workspace/api/skills/${encodeURIComponent(key)}/package`);
}

export type BuilderConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

export class BuilderDraftConnection {
  readonly doc = new Y.Doc();
  readonly awareness = new Awareness(this.doc);
  private socket?: WebSocket;
  private stopped = false;
  private reconnectTimer?: number;
  private reconnectDelay = 800;
  private readonly listeners = new Set<() => void>();
  private readonly statusListeners = new Set<(status: BuilderConnectionStatus) => void>();
  private readonly testListeners = new Set<(test: unknown) => void>();

  constructor(readonly draftId: string, private readonly presence: BuilderPresence) {
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      for (const listener of this.listeners) listener();
      if (origin !== this && this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: "update", update: base64FromBytes(update) }));
      }
    });
    this.awareness.on("update", ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      for (const listener of this.listeners) listener();
      if (origin === this || this.socket?.readyState !== WebSocket.OPEN) return;
      const clients = [...added, ...updated, ...removed];
      if (!clients.length) return;
      this.socket.send(JSON.stringify({ type: "awareness", clientId: this.doc.clientID, update: base64FromBytes(encodeAwarenessUpdate(this.awareness, clients)) }));
    });
    this.awareness.setLocalState({ user: presence });
  }

  start() {
    if (!this.stopped && !this.socket) this.connect();
  }

  private connect() {
    this.emitStatus("connecting");
    const url = new URL("/workspace/builder/socket", window.location.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("draftId", this.draftId);
    const socket = new WebSocket(url, "neural-labs-builder-v1");
    this.socket = socket;
    socket.addEventListener("open", () => {
      this.reconnectDelay = 800;
      this.emitStatus("connected");
      const local = Y.encodeStateAsUpdate(this.doc);
      if (local.length > 2) socket.send(JSON.stringify({ type: "update", update: base64FromBytes(local) }));
      socket.send(JSON.stringify({ type: "awareness", clientId: this.doc.clientID, update: base64FromBytes(encodeAwarenessUpdate(this.awareness, [this.doc.clientID])) }));
    });
    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data)) as { type?: string; update?: string; test?: unknown };
        if ((message.type === "sync" || message.type === "update") && message.update) Y.applyUpdate(this.doc, bytesFromBase64(message.update), this);
        if (message.type === "awareness" && message.update) applyAwarenessUpdate(this.awareness, bytesFromBase64(message.update), this);
        if (message.type === "test") for (const listener of this.testListeners) listener(message.test);
      } catch {
        this.emitStatus("error");
      }
    });
    socket.addEventListener("close", () => {
      if (this.socket === socket) this.socket = undefined;
      if (this.stopped) return;
      this.emitStatus("disconnected");
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = window.setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(10_000, this.reconnectDelay * 1.8);
    });
    socket.addEventListener("error", () => this.emitStatus("error"));
  }

  onChange(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  onStatus(listener: (status: BuilderConnectionStatus) => void) {
    this.statusListeners.add(listener);
    return () => { this.statusListeners.delete(listener); };
  }

  onTest(listener: (test: unknown) => void) {
    this.testListeners.add(listener);
    return () => { this.testListeners.delete(listener); };
  }

  updatePresence(patch: Partial<BuilderPresence>) {
    const current = (this.awareness.getLocalState()?.user ?? this.presence) as BuilderPresence;
    this.awareness.setLocalStateField("user", { ...current, ...patch });
  }

  broadcastTest(test: unknown) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: "test", test }));
  }

  private emitStatus(status: BuilderConnectionStatus) {
    for (const listener of this.statusListeners) listener(status);
  }

  stop() {
    this.stopped = true;
    window.clearTimeout(this.reconnectTimer);
    this.awareness.setLocalState(null);
    this.socket?.close(1000, "Builder closed");
    this.socket = undefined;
    this.awareness.destroy();
    this.doc.destroy();
  }
}

export function replaceCollaborativeText(shared: Y.Text, next: string) {
  const current = shared.toString();
  if (current === next) return;
  let prefix = 0;
  while (prefix < current.length && prefix < next.length && current[prefix] === next[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < current.length - prefix && suffix < next.length - prefix && current[current.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix += 1;
  shared.doc?.transact(() => {
    const remove = current.length - prefix - suffix;
    if (remove > 0) shared.delete(prefix, remove);
    const insert = next.slice(prefix, next.length - suffix);
    if (insert) shared.insert(prefix, insert);
  });
}

export function ensureCollaborativeText(map: Y.Map<any>, key: string, initial = ""): Y.Text {
  const existing = map.get(key);
  if (existing instanceof Y.Text) return existing;
  const shared = new Y.Text(initial);
  map.set(key, shared);
  return shared;
}
