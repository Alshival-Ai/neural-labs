import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import type { TerminalChunk, TerminalSessionSummary, TerminalStatus } from "@/lib/shared/types";
import { getWorkspaceRoot } from "@/lib/server/paths";
import { ensureDataScaffold } from "@/lib/server/store";

type TerminalListener = (chunk: TerminalChunk) => void;

class TerminalSession {
  id = randomUUID();
  title = "Shell";
  createdAt = new Date().toISOString();
  lastActivityAt = this.createdAt;
  alive = true;
  backlog: TerminalChunk[] = [];
  listeners = new Set<TerminalListener>();
  process: ChildProcessWithoutNullStreams;

  constructor(process: ChildProcessWithoutNullStreams) {
    this.process = process;
  }

  pushChunk(chunk: TerminalChunk) {
    this.lastActivityAt = new Date().toISOString();
    this.backlog.push(chunk);
    if (this.backlog.length > 300) {
      this.backlog.splice(0, this.backlog.length - 300);
    }
    for (const listener of this.listeners) {
      listener(chunk);
    }
  }
}

class TerminalManager {
  private readonly sessions = new Map<string, TerminalSession>();

  async createSession() {
    await ensureDataScaffold();
    const shell = process.env.SHELL || "bash";
    const child = spawn(shell, ["--noprofile", "--norc", "-i"], {
      cwd: getWorkspaceRoot(),
      env: {
        ...process.env,
        PS1: "neural-labs$ ",
      },
      stdio: "pipe",
    });

    const session = new TerminalSession(child);
    const handleOutput = (buffer: Buffer, type: "output" | "exit" = "output") => {
      session.pushChunk({
        type,
        text: buffer.toString("utf-8"),
        terminalId: session.id,
      });
    };

    child.stdout.on("data", (buffer) => handleOutput(buffer));
    child.stderr.on("data", (buffer) => handleOutput(buffer));
    child.on("exit", (code) => {
      session.alive = false;
      handleOutput(Buffer.from(`\n[process exited with code ${code ?? 0}]\n`), "exit");
    });

    session.process.stdin.write("pwd\n");
    this.sessions.set(session.id, session);
    return session;
  }

  list(): TerminalSessionSummary[] {
    return [...this.sessions.values()].map((session) => ({
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      alive: session.alive,
    }));
  }

  get(sessionId: string): TerminalSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  getStatus(sessionId: string): TerminalStatus | null {
    const session = this.get(sessionId);
    if (!session) {
      return null;
    }
    return {
      id: session.id,
      alive: session.alive,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
    };
  }

  writeInput(sessionId: string, data: string) {
    const session = this.get(sessionId);
    if (!session) {
      throw new Error("Terminal session not found");
    }
    session.lastActivityAt = new Date().toISOString();
    session.process.stdin.write(data);
  }

  subscribe(sessionId: string, listener: TerminalListener): (() => void) {
    const session = this.get(sessionId);
    if (!session) {
      throw new Error("Terminal session not found");
    }
    session.listeners.add(listener);
    return () => {
      session.listeners.delete(listener);
    };
  }

  close(sessionId: string) {
    const session = this.get(sessionId);
    if (!session) {
      return;
    }
    session.process.kill();
    this.sessions.delete(sessionId);
  }
}

declare global {
  var __neuralLabsTerminalManager: TerminalManager | undefined;
}

export function getTerminalManager(): TerminalManager {
  if (!globalThis.__neuralLabsTerminalManager) {
    globalThis.__neuralLabsTerminalManager = new TerminalManager();
  }
  return globalThis.__neuralLabsTerminalManager;
}
