import type { SessionRow } from "./types";

export const PRIVATE_NEURA_SESSION = {
  category: "neura-private",
  visibility: "draft",
} as const;

export function shouldProtectLegacyPrivateSession(session: SessionRow): boolean {
  return session.sharingRole === "owner" &&
    session.visibility === "shared" &&
    session.category !== "neura-team";
}

export function shouldIncludeNeuraSession(value: unknown, agentId: string): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const keyValue = typeof row.key === "string" ? row.key : row.sessionKey;
  const key = typeof keyValue === "string" ? keyValue.trim() : "";
  const rowAgentId = typeof row.agentId === "string" ? row.agentId.trim() : "";
  if (!key || (rowAgentId && rowAgentId !== agentId)) return false;

  const category = typeof row.category === "string" ? row.category.trim() : "";
  if (["cron", "heartbeat", "internal", "automation"].includes(category)) return false;

  // OpenClaw dashboard chats are deliberately parented to the agent's main
  // session. Keep those user-visible conversations while excluding other
  // spawned/parented worker sessions.
  const isDashboardChat = key.startsWith(`agent:${agentId}:dashboard:`);
  return isDashboardChat || (!row.spawnedBy && !row.parentSessionKey);
}
