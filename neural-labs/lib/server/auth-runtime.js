const { createHash } = require("node:crypto");
const { existsSync, mkdirSync } = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const AUTH_SESSION_COOKIE_NAME = "neural_labs_session";
const DEFAULT_AUTH_DB_PATH = path.join(
  process.env.HOME || process.cwd(),
  ".local",
  "share",
  "neural-labs",
  "auth",
  "auth.db"
);
const DEFAULT_AUTH_SECRET = "change-me-in-production";

let dbInstance = null;

function getAuthSecret() {
  return process.env.AUTH_SECRET?.trim() || DEFAULT_AUTH_SECRET;
}

function getAuthDbPath() {
  return process.env.AUTH_DB_PATH?.trim() || DEFAULT_AUTH_DB_PATH;
}

function ensureAuthDbDirectory() {
  const dbPath = getAuthDbPath();
  const directory = path.dirname(dbPath);
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
  }
}

function getDb() {
  if (dbInstance) {
    return dbInstance;
  }

  ensureAuthDbDirectory();
  const db = new DatabaseSync(getAuthDbPath());
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      avatar_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
  `);
  const userColumns = db.prepare("PRAGMA table_info(users)").all();
  if (!userColumns.some((column) => column.name === "avatar_path")) {
    db.exec("ALTER TABLE users ADD COLUMN avatar_path TEXT");
  }
  dbInstance = db;
  return db;
}

function parseCookieHeader(cookieHeader) {
  if (typeof cookieHeader !== "string" || !cookieHeader.trim()) {
    return {};
  }

  return cookieHeader
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((acc, entry) => {
      const [name, ...rest] = entry.split("=");
      if (!name || rest.length === 0) {
        return acc;
      }
      try {
        acc[name] = decodeURIComponent(rest.join("="));
      } catch {
        acc[name] = rest.join("=");
      }
      return acc;
    }, {});
}

function hashOpaqueToken(token) {
  return createHash("sha256")
    .update(getAuthSecret())
    .update(":")
    .update(token)
    .digest("hex");
}

function getViewerFromHeaders(headers) {
  const cookies = parseCookieHeader(headers.cookie);
  const token = cookies[AUTH_SESSION_COOKIE_NAME];
  if (!token) {
    return null;
  }

  const row = getDb()
    .prepare(
      `SELECT
         s.id,
         s.user_id,
         s.expires_at,
         u.email,
         u.role,
         u.avatar_path,
         u.created_at,
         u.updated_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`
    )
    .get(hashOpaqueToken(token));

  if (!row) {
    return null;
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    getDb().prepare("DELETE FROM sessions WHERE id = ?").run(row.id);
    return null;
  }

  return {
    id: row.user_id,
    email: row.email,
    role: row.role,
    avatarPath: row.avatar_path ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = {
  AUTH_SESSION_COOKIE_NAME,
  getViewerFromHeaders,
};
