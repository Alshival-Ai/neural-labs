export type ConnectionState = "connecting" | "connected" | "disconnected" | "error";

export type SessionRow = {
  key: string;
  sessionId?: string;
  title: string;
  updatedAt: number;
  archived: boolean;
  active: boolean;
  category?: string;
  visibility: "shared" | "read-only" | "suggest" | "draft";
  sharingRole?: "admin" | "owner" | "member" | "viewer";
};

export type NeuraMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  pending?: boolean;
  attachments?: Array<{ name: string; type: string; url?: string }>;
};

export type NeuraActivity = {
  id: string;
  sessionKey: string;
  title: string;
  detail?: string;
  state: "running" | "done" | "error";
};

export type NeuraApproval = {
  id: string;
  sessionKey?: string;
  kind: "exec" | "plugin" | "system-agent";
  title: string;
  detail: string;
  decisions: Array<"allow-once" | "allow-always" | "deny">;
};

export type GatewayEvent = {
  event: string;
  payload: unknown;
};

export type ComposerAttachment = {
  id: string;
  file: File;
  previewUrl?: string;
};
