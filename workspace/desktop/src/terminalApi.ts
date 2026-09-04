export type TerminalScope = "personal" | "team";
export type TerminalProcessStatus = "running" | "exited";
export type TerminalVoiceMode = "muted" | "open-mic" | "push-to-talk";

export type TerminalParticipant = {
  id: string;
  label: string;
  connections: number;
};

export type TerminalLayoutLeader = {
  id: string;
  label: string;
  connectionId: string;
};

export type TerminalVoiceParticipant = {
  connectionId: string;
  id: string;
  label: string;
  mode: TerminalVoiceMode;
};

export type TerminalDescriptor = {
  id: string;
  title: string;
  scope: TerminalScope;
  shell: string;
  cwd: string;
  status: TerminalProcessStatus;
  createdAt: number;
  lastActivityAt: number;
  cols: number;
  rows: number;
  sequence: number;
  exitCode: number | null;
  owner: { label: string };
  owned: boolean;
  canTerminate: boolean;
  participants: TerminalParticipant[];
  voiceParticipants: TerminalVoiceParticipant[];
  layoutLeader: TerminalLayoutLeader | null;
  teamChannel?: { id: string; name: string };
};

export type TerminalTicket = {
  ticket: string;
  path: string;
  protocol: string;
  expiresAt: number;
};

type TerminalListResponse = { sessions: TerminalDescriptor[] };
type TerminalCreateResponse = { session: TerminalDescriptor };

export class TerminalRequestError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, code: string | undefined, message: string) {
    super(message);
    this.name = "TerminalRequestError";
    this.status = status;
    this.code = code;
  }
}

async function terminalRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  const body = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
  if (!response.ok) {
    throw new TerminalRequestError(
      response.status,
      body.error?.code,
      body.error?.message || `Terminal request failed with HTTP ${response.status}`,
    );
  }
  return body as T;
}

export async function listTerminals(): Promise<TerminalDescriptor[]> {
  const response = await terminalRequest<TerminalListResponse>("/workspace/api/terminals");
  return response.sessions;
}

export async function createTerminal(input: { scope: TerminalScope; title?: string; channelId?: string; cols?: number; rows?: number }): Promise<TerminalDescriptor> {
  const response = await terminalRequest<TerminalCreateResponse>("/workspace/api/terminals", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return response.session;
}

export function issueTerminalTicket(terminalId: string, afterSequence: number | null): Promise<TerminalTicket> {
  return terminalRequest<TerminalTicket>(`/workspace/api/terminals/${encodeURIComponent(terminalId)}/ticket`, {
    method: "POST",
    body: JSON.stringify({ afterSequence }),
  });
}

export async function endTerminal(terminalId: string): Promise<void> {
  await terminalRequest<{ closed: true }>(`/workspace/api/terminals/${encodeURIComponent(terminalId)}`, { method: "DELETE" });
}

export function terminalSocketUrl(path: string): string {
  const url = new URL(path, window.location.href);
  url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
