import type { TerminalChunk, TerminalSessionSummary, TerminalStatus } from "../shared/types";

interface TerminalSessionLike {
  id: string;
  title: string;
  createdAt: string;
  lastActivityAt: string;
  alive: boolean;
  backlog: TerminalChunk[];
}

interface TerminalManagerLike {
  createSession(userId: string): Promise<TerminalSessionLike>;
  list(userId: string): TerminalSessionSummary[];
  get(userId: string, sessionId: string): TerminalSessionLike | null;
  getStatus(userId: string, sessionId: string): TerminalStatus | null;
  writeInput(userId: string, sessionId: string, data: string): void;
  subscribe(
    userId: string,
    sessionId: string,
    listener: (chunk: TerminalChunk) => void
  ): () => void;
  close(userId: string, sessionId: string): void;
  issueWsTicket(userId: string, sessionId: string): string;
  consumeWsTicket(userId: string, token: string): string | null;
}

const runtime = require("./terminal-manager-runtime.js") as {
  getTerminalManager: () => TerminalManagerLike;
};

export function getTerminalManager(): TerminalManagerLike {
  return runtime.getTerminalManager();
}
