export type ThemeMode = "dark" | "light" | "system";

export type DesktopBackgroundPresetId =
  | "aurora"
  | "graphite"
  | "sunrise-grid"
  | "ocean-night";

export type DesktopBackgroundId =
  | DesktopBackgroundPresetId
  | `custom:${string}`;

export type ProviderKind =
  | "openai"
  | "anthropic"
  | "openai-compatible"
  | "azure-openai";

export type ProviderManagedKey =
  | "openai-default"
  | "anthropic-default"
  | "legacy-default";

export interface ProviderRecord {
  id: string;
  name: string;
  kind: ProviderKind;
  model: string;
  baseUrl: string;
  apiKey: string;
  apiVersion?: string;
  deployment?: string;
  isDefault: boolean;
  managedBy?: "env";
  managedKey?: ProviderManagedKey;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderDraft {
  name: string;
  kind: ProviderKind;
  model: string;
  baseUrl: string;
  apiKey: string;
  apiVersion?: string;
  deployment?: string;
  isDefault?: boolean;
}

export interface DesktopSettings {
  theme: ThemeMode;
  backgroundId: DesktopBackgroundId;
  customBackgroundPath: string | null;
  customBackgroundVersion: string | null;
}

export interface SettingsSnapshot {
  desktop: DesktopSettings;
  providers: ProviderRecord[];
}

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: string;
  mimeType: string;
}

export interface DirectoryListing {
  path: string;
  entries: FileEntry[];
}

export interface TextFilePayload {
  path: string;
  content: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  model: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface ConversationRecord {
  summary: ConversationSummary;
  messages: ConversationMessage[];
}

export interface NeuraConfig {
  assistantName: string;
  defaultModel: string;
  defaultProviderName: string | null;
}

export interface TerminalSessionSummary {
  id: string;
  title: string;
  createdAt: string;
  alive: boolean;
}

export interface TerminalChunk {
  type: "output" | "exit" | "error";
  text: string;
  terminalId: string;
}

export interface TerminalStatus {
  id: string;
  alive: boolean;
  createdAt: string;
  lastActivityAt: string;
  cols: number;
  rows: number;
  state: "running" | "exited";
}

export interface ApiErrorPayload {
  error: string;
}

export type AuthRole = "admin" | "user";

export interface AuthViewer {
  id: string;
  email: string;
  role: AuthRole;
  avatarPath: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthInviteRecord {
  id: string;
  email: string;
  role: AuthRole;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}

export interface AuthAdminUserRecord {
  id: string;
  email: string;
  role: AuthRole;
  avatarPath: string | null;
  createdAt: string;
  updatedAt: string;
  disabledAt: string | null;
  lastActivityAt: string | null;
  activeSessionCount: number;
}

export interface AuthPasswordResetRecord {
  id: string;
  userId: string;
  email: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
}
