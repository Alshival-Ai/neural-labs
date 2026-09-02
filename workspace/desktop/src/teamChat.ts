export type TeamDirectoryUser = {
  id: string;
  handle: string;
  displayName: string;
  role: "admin" | "user";
};

export type TeamChannel = {
  id: string;
  name: string;
  audience: "restricted" | "everyone";
  ownerUserId: string;
  pinned: boolean;
  pinnedAt?: string;
  memberCount: number;
  unreadCount: number;
  mentionCount: number;
  lastMessageAt?: string;
  createdAt: string;
  updatedAt: string;
  canManage: boolean;
  canPin: boolean;
};

export type TeamAttachment = { path: string; name: string; type?: string; size?: number };

export type TeamMessage = {
  id: string;
  sequence: number;
  channelId: string;
  authorKind: "user" | "neura" | "system" | "imported_user" | "imported_neura";
  author?: TeamDirectoryUser;
  body: string;
  attachments: TeamAttachment[];
  mentions: string[];
  agentRunId?: string;
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
    throw new Error(payload?.error?.message ?? `Team Chat request failed with HTTP ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function mutate(csrfToken: string, method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "X-CSRF-Token": csrfToken },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

export const teamChatApi = {
  directory: () => json<{ users: TeamDirectoryUser[] }>("/api/team/directory"),
  channels: () => json<{ channels: TeamChannel[] }>("/api/team/channels"),
  messages: (channelId: string) => json<{ messages: TeamMessage[] }>(`/api/team/channels/${encodeURIComponent(channelId)}/messages`),
  members: (channelId: string) => json<{ users: TeamDirectoryUser[] }>(`/api/team/channels/${encodeURIComponent(channelId)}/members`),
  ticket: (csrfToken: string) => json<{ ticket: string; expiresAt: string }>("/api/team/socket-ticket", mutate(csrfToken, "POST")),
  create: (csrfToken: string, input: {
    name: string;
    audience: "restricted" | "everyone";
    memberIds: string[];
    sourceSessionKey?: string;
    importedMessages?: Array<{ role: "user" | "assistant"; body: string }>;
  }) => json<{ channel: TeamChannel; messages: TeamMessage[] }>("/api/team/channels", mutate(csrfToken, "POST", input)),
  update: (csrfToken: string, channelId: string, input: { name?: string; pinned?: boolean }) =>
    json<void>(`/api/team/channels/${encodeURIComponent(channelId)}`, mutate(csrfToken, "PATCH", input)),
  remove: (csrfToken: string, channelId: string) =>
    json<void>(`/api/team/channels/${encodeURIComponent(channelId)}`, mutate(csrfToken, "DELETE")),
  addMembers: (csrfToken: string, channelId: string, memberIds: string[]) =>
    json<void>(`/api/team/channels/${encodeURIComponent(channelId)}/members`, mutate(csrfToken, "POST", { memberIds })),
  removeMember: (csrfToken: string, channelId: string, userId: string) =>
    json<void>(`/api/team/channels/${encodeURIComponent(channelId)}/members/${encodeURIComponent(userId)}`, mutate(csrfToken, "DELETE")),
  markRead: (csrfToken: string, channelId: string, sequence: number) =>
    json<void>(`/api/team/channels/${encodeURIComponent(channelId)}/read`, mutate(csrfToken, "POST", { sequence })),
};

export function teamSocketUrl(ticket: string): string {
  const url = new URL("/api/team/socket", window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("ticket", ticket);
  return url.toString();
}
