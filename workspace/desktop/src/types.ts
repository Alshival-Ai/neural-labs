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
  attachments?: NeuraAttachment[];
  activities?: NeuraActivity[];
};

export type NeuraAttachment = {
  name: string;
  type: string;
  artifactId?: string;
  url?: string;
  path?: string;
  size?: number;
};

export type NeuraActivity = {
  id: string;
  sessionKey: string;
  runId?: string;
  kind: "thinking" | "command" | "plan" | "tool" | "file" | "operation";
  title: string;
  detail?: string;
  command?: string;
  output?: string;
  path?: string;
  exitCode?: number;
  durationMs?: number;
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
