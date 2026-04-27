import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

type WorkspaceBackend = "docker";

export interface WorkspaceSession {
  userId: string;
  backend: WorkspaceBackend;
  workspaceRoot: string;
  dataRoot: string;
  stateFilePath: string;
  containerName: string | null;
  volumeName: string | null;
  workspacePathInContainer: string | null;
}

const WORKSPACE_BACKEND: WorkspaceBackend = "docker";
const DEFAULT_AUTH_DB_PATH = path.join(
  process.env.HOME || process.cwd(),
  ".local",
  "share",
  "neural-labs",
  "auth",
  "auth.db"
);

let authDb: DatabaseSync | null = null;

const workspaceRuntime = require("./workspace-runtime.js") as {
  getWorkspaceSession: (userId: string) => Promise<WorkspaceSession>;
  markWorkspaceActivitySafe: (userId: string, at?: Date) => void;
};

function getAuthDbPath(): string {
  return process.env.AUTH_DB_PATH?.trim() || DEFAULT_AUTH_DB_PATH;
}

function getAuthDb(): DatabaseSync {
  if (authDb) {
    return authDb;
  }

  const dbPath = getAuthDbPath();
  const directory = path.dirname(dbPath);
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_activity (
      user_id TEXT PRIMARY KEY,
      last_activity_at TEXT NOT NULL
    );
  `);
  authDb = db;
  return db;
}

export function markWorkspaceActivity(userId: string, at = new Date()): void {
  const timestamp = at.toISOString();
  getAuthDb()
    .prepare(
      `INSERT INTO workspace_activity (user_id, last_activity_at)
       VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET last_activity_at = excluded.last_activity_at`
    )
    .run(userId, timestamp);
}

export async function getWorkspaceSession(userId: string): Promise<WorkspaceSession> {
  if (WORKSPACE_BACKEND !== "docker") {
    throw new Error("Neural Labs workspace is configured for docker backend only.");
  }
  markWorkspaceActivity(userId);
  workspaceRuntime.markWorkspaceActivitySafe(userId);
  return workspaceRuntime.getWorkspaceSession(userId);
}
