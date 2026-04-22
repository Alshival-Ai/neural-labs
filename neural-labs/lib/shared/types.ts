export type ThemeMode = "dark" | "light" | "system";

export type DesktopBackgroundId =
  | "aurora"
  | "graphite"
  | "sunrise-grid"
  | "ocean-night";

export type ProviderKind =
  | "openai"
  | "anthropic"
  | "openai-compatible"
  | "azure-openai";

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
  type: "output" | "exit";
  text: string;
  terminalId: string;
}

export interface TerminalStatus {
  id: string;
  alive: boolean;
  createdAt: string;
  lastActivityAt: string;
}

export interface ApiErrorPayload {
  error: string;
}
