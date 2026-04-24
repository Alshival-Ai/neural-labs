import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { AuthRole, AuthViewer, AuthInviteRecord } from "@/lib/shared/types";

export const AUTH_SESSION_COOKIE_NAME = "neural_labs_session";
const DEFAULT_AUTH_DB_PATH = path.join(
  process.env.HOME || process.cwd(),
  ".local",
  "share",
  "neural-labs",
  "auth",
  "auth.db"
);
const DEFAULT_AUTH_SECRET = "change-me-in-production";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const INVITE_TTL_SECONDS = 60 * 60 * 24 * 7;
const PASSWORD_HASH_BYTES = 64;

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  role: AuthRole;
  avatar_path: string | null;
  created_at: string;
  updated_at: string;
};

type SessionRow = {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
};

type InviteRow = {
  id: string;
  email: string;
  role: AuthRole;
  token_hash: string;
  invited_by_user_id: string | null;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
};

interface SessionLookupRow {
  sessionId: string;
  userId: string;
  tokenHash: string;
  sessionCreatedAt: string;
  expiresAt: string;
  lastSeenAt: string;
  email: string;
  passwordHash: string;
  role: AuthRole;
  avatarPath: string | null;
  userCreatedAt: string;
  userUpdatedAt: string;
}

interface SessionCookieContext {
  sessionToken: string | null;
  viewer: AuthViewer | null;
}

export class AuthError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

let dbInstance: DatabaseSync | null = null;

function getAuthSecret(): string {
  return process.env.AUTH_SECRET?.trim() || DEFAULT_AUTH_SECRET;
}

export function getAuthDbPath(): string {
  return process.env.AUTH_DB_PATH?.trim() || DEFAULT_AUTH_DB_PATH;
}

function ensureAuthDbDirectory(): void {
  const dbPath = getAuthDbPath();
  const directory = path.dirname(dbPath);
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
  }
}

function getDb(): DatabaseSync {
  if (dbInstance) {
    return dbInstance;
  }

  ensureAuthDbDirectory();
  const db = new DatabaseSync(getAuthDbPath());
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
      avatar_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspace_activity (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      last_activity_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invites (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
      token_hash TEXT NOT NULL UNIQUE,
      invited_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      accepted_at TEXT,
      revoked_at TEXT
    );

    CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS invites_email_idx ON invites(email);
  `);
  const userColumns = db
    .prepare("PRAGMA table_info(users)")
    .all() as Array<{ name: string }>;
  if (!userColumns.some((column) => column.name === "avatar_path")) {
    db.exec("ALTER TABLE users ADD COLUMN avatar_path TEXT");
  }
  ensureInitialAdminSeeded(db);
  dbInstance = db;
  return db;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashOpaqueToken(token: string): string {
  return createHash("sha256")
    .update(getAuthSecret())
    .update(":")
    .update(token)
    .digest("hex");
}

function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

function encodePassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, PASSWORD_HASH_BYTES).toString("hex");
  return `scrypt:${salt}:${derived}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [algorithm, salt, expectedHex] = stored.split(":");
  if (algorithm !== "scrypt" || !salt || !expectedHex) {
    return false;
  }

  const expected = Buffer.from(expectedHex, "hex");
  const actual = scryptSync(password, salt, expected.length);
  if (actual.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(actual, expected);
}

function buildSetCookieHeader(token: string, maxAgeSeconds = SESSION_MAX_AGE_SECONDS): string {
  const parts = [
    `${AUTH_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (process.env.AUTH_COOKIE_SECURE === "true") {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function buildClearCookieHeader(): string {
  const parts = [
    `${AUTH_SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (process.env.AUTH_COOKIE_SECURE === "true") {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function parseCookieHeader(cookieHeader: string | null): Record<string, string> {
  if (!cookieHeader) {
    return {};
  }

  return cookieHeader
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, entry) => {
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

function toViewer(row: UserRow): AuthViewer {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    avatarPath: row.avatar_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toInviteRecord(row: InviteRow): AuthInviteRecord {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    revokedAt: row.revoked_at,
  };
}

function countUsersInternal(): number {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number };
  return row.count;
}

function getInitialAdminEmail(): string | null {
  const email = process.env.NEURAL_LABS_INITIAL_ADMIN_EMAIL?.trim();
  return email ? normalizeEmail(email) : null;
}

function getInitialAdminPassword(): string | null {
  const password = process.env.NEURAL_LABS_INITIAL_ADMIN_PASSWORD?.trim();
  return password ? password : null;
}

function createUserInDb(
  db: DatabaseSync,
  email: string,
  password: string,
  role: AuthRole
): UserRow {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new AuthError("Email is required", 400);
  }
  if (password.length < 8) {
    throw new AuthError("Password must be at least 8 characters", 400);
  }

  const existing = db
    .prepare(
      `SELECT id FROM users WHERE email = ?`
    )
    .get(normalizedEmail) as { id: string } | undefined;
  if (existing) {
    throw new AuthError("An account with that email already exists", 409);
  }

  const now = new Date().toISOString();
  const user: UserRow = {
    id: randomUUID(),
    email: normalizedEmail,
    password_hash: encodePassword(password),
    role,
    avatar_path: null,
    created_at: now,
    updated_at: now,
  };

  db.prepare(
    `INSERT INTO users (id, email, password_hash, role, avatar_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    user.id,
    user.email,
    user.password_hash,
    user.role,
    user.avatar_path,
    user.created_at,
    user.updated_at
  );

  return user;
}

function ensureInitialAdminSeeded(db: DatabaseSync): void {
  const email = getInitialAdminEmail();
  const password = getInitialAdminPassword();
  if (!email || !password) {
    return;
  }

  const row = db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number };
  if (row.count > 0) {
    return;
  }

  createUserInDb(db, email, password, "admin");
}

function findUserByEmail(email: string): UserRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, email, password_hash, role, created_at, updated_at
       , avatar_path
       FROM users
       WHERE email = ?`
    )
    .get(normalizeEmail(email)) as UserRow | undefined;
  return row ?? null;
}

function findUserById(userId: string): UserRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, email, password_hash, role, created_at, updated_at
       , avatar_path
       FROM users
       WHERE id = ?`
    )
    .get(userId) as UserRow | undefined;
  return row ?? null;
}

function findInviteByToken(token: string): InviteRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id, email, role, token_hash, invited_by_user_id, created_at, expires_at, accepted_at, revoked_at
       FROM invites
       WHERE token_hash = ?`
    )
    .get(hashOpaqueToken(token)) as InviteRow | undefined;
  return row ?? null;
}

function issueSession(userId: string): string {
  const db = getDb();
  const sessionId = randomUUID();
  const token = generateOpaqueToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();

  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    sessionId,
    userId,
    hashOpaqueToken(token),
    now.toISOString(),
    expiresAt,
    now.toISOString()
  );

  touchUserActivity(userId, sessionId, now.toISOString());

  return token;
}

function touchUserActivity(
  userId: string,
  sessionId: string | null,
  nowIso = new Date().toISOString()
): void {
  const db = getDb();
  if (sessionId) {
    db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(nowIso, sessionId);
  }
  db.prepare(
    `INSERT INTO workspace_activity (user_id, last_activity_at)
     VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET last_activity_at = excluded.last_activity_at`
  ).run(userId, nowIso);
}

function createUser(email: string, password: string, role: AuthRole): UserRow {
  return createUserInDb(getDb(), email, password, role);
}

function requireActiveInvite(token: string): InviteRow {
  const invite = findInviteByToken(token);
  if (!invite) {
    throw new AuthError("Invite not found", 404);
  }
  if (invite.revoked_at) {
    throw new AuthError("Invite has been revoked", 410);
  }
  if (invite.accepted_at) {
    throw new AuthError("Invite has already been used", 410);
  }
  if (new Date(invite.expires_at).getTime() <= Date.now()) {
    throw new AuthError("Invite has expired", 410);
  }
  return invite;
}

function readSessionFromToken(token: string): SessionLookupRow | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT
         s.id AS session_id,
         s.user_id,
         s.token_hash,
         s.created_at AS session_created_at,
         s.expires_at,
         s.last_seen_at,
         u.email,
         u.password_hash,
         u.role,
         u.avatar_path,
         u.created_at AS user_created_at,
         u.updated_at AS user_updated_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`
    )
    .get(hashOpaqueToken(token)) as
    | {
        session_id: string;
        user_id: string;
        token_hash: string;
        session_created_at: string;
        expires_at: string;
        last_seen_at: string;
        email: string;
        password_hash: string;
        role: AuthRole;
        avatar_path: string | null;
        user_created_at: string;
        user_updated_at: string;
      }
    | undefined;

  if (!row) {
    return null;
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(row.session_id);
    return null;
  }

  return {
    sessionId: row.session_id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    sessionCreatedAt: row.session_created_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    avatarPath: row.avatar_path,
    userCreatedAt: row.user_created_at,
    userUpdatedAt: row.user_updated_at,
  };
}

export function hasAnyUsers(): boolean {
  return countUsersInternal() > 0;
}

export function canBootstrapAdmin(): boolean {
  return !hasAnyUsers() && Boolean(getInitialAdminEmail() && getInitialAdminPassword());
}

export function getBootstrapAdminEmail(): string | null {
  return getInitialAdminEmail();
}

export function getInviteUrl(token: string): string {
  const baseUrl =
    process.env.AUTH_BASE_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim() || "";
  if (baseUrl) {
    return `${baseUrl.replace(/\/$/, "")}/invite/${encodeURIComponent(token)}`;
  }
  return `/invite/${encodeURIComponent(token)}`;
}

export function getSessionContextFromRequest(request: Request): SessionCookieContext {
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  const sessionToken = cookies[AUTH_SESSION_COOKIE_NAME] ?? null;
  if (!sessionToken) {
    return { sessionToken: null, viewer: null };
  }

  const session = readSessionFromToken(sessionToken);
  if (!session) {
    return { sessionToken, viewer: null };
  }
  touchUserActivity(session.userId, session.sessionId);

  return {
    sessionToken,
    viewer: toViewer({
      id: session.userId,
      email: session.email,
      password_hash: session.passwordHash,
      role: session.role,
      avatar_path: session.avatarPath,
      created_at: session.userCreatedAt,
      updated_at: session.userUpdatedAt,
    }),
  };
}

export function getViewerFromCookieHeader(cookieHeader: string | null): AuthViewer | null {
  const cookies = parseCookieHeader(cookieHeader);
  const sessionToken = cookies[AUTH_SESSION_COOKIE_NAME];
  if (!sessionToken) {
    return null;
  }

  const session = readSessionFromToken(sessionToken);
  if (!session) {
    return null;
  }
  touchUserActivity(session.userId, session.sessionId);

  return toViewer({
    id: session.userId,
    email: session.email,
    password_hash: session.passwordHash,
    role: session.role,
    avatar_path: session.avatarPath,
    created_at: session.userCreatedAt,
    updated_at: session.userUpdatedAt,
  });
}

export function requireViewerFromRequest(request: Request): AuthViewer {
  const context = getSessionContextFromRequest(request);
  if (!context.viewer) {
    throw new AuthError("Authentication required", 401);
  }
  return context.viewer;
}

export function requireAdminViewerFromRequest(request: Request): AuthViewer {
  const viewer = requireViewerFromRequest(request);
  if (viewer.role !== "admin") {
    throw new AuthError("Admin access required", 403);
  }
  return viewer;
}

export function getViewerBySessionToken(sessionToken: string): AuthViewer | null {
  const session = readSessionFromToken(sessionToken);
  if (!session) {
    return null;
  }
  touchUserActivity(session.userId, session.sessionId);
  return toViewer({
    id: session.userId,
    email: session.email,
    password_hash: session.passwordHash,
    role: session.role,
    avatar_path: session.avatarPath,
    created_at: session.userCreatedAt,
    updated_at: session.userUpdatedAt,
  });
}

function normalizeAvatarPath(avatarPath: string | null | undefined): string | null {
  if (typeof avatarPath !== "string") {
    return null;
  }
  const value = avatarPath.trim().replace(/^\/+/, "");
  return value || null;
}

export function applySessionCookie(response: Response, sessionToken: string): Response {
  response.headers.append("Set-Cookie", buildSetCookieHeader(sessionToken));
  return response;
}

export function clearSessionCookie(response: Response): Response {
  response.headers.append("Set-Cookie", buildClearCookieHeader());
  return response;
}

export function loginWithPassword(email: string, password: string): {
  viewer: AuthViewer;
  sessionToken: string;
} {
  const user = findUserByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    throw new AuthError("Invalid email or password", 401);
  }

  return {
    viewer: toViewer(user),
    sessionToken: issueSession(user.id),
  };
}

export function logoutWithRequest(request: Request): void {
  const context = getSessionContextFromRequest(request);
  if (!context.sessionToken) {
    return;
  }

  getDb()
    .prepare("DELETE FROM sessions WHERE token_hash = ?")
    .run(hashOpaqueToken(context.sessionToken));
}

export function bootstrapAdminAccount(email: string, password: string): {
  viewer: AuthViewer;
  sessionToken: string;
} {
  const initialAdminEmail = getInitialAdminEmail();
  const initialAdminPassword = getInitialAdminPassword();
  if (!initialAdminEmail || !initialAdminPassword) {
    throw new AuthError("Initial admin credentials are not configured", 400);
  }
  if (hasAnyUsers()) {
    throw new AuthError("Initial admin has already been provisioned", 409);
  }
  if (normalizeEmail(email) !== initialAdminEmail) {
    throw new AuthError("Email does not match the configured initial admin", 403);
  }
  if (password !== initialAdminPassword) {
    throw new AuthError("Password does not match the configured initial admin", 403);
  }

  const user = createUser(email, password, "admin");
  return {
    viewer: toViewer(user),
    sessionToken: issueSession(user.id),
  };
}

export function createInvite(
  actor: AuthViewer,
  email: string,
  role: AuthRole = "user"
): AuthInviteRecord & { invitationUrl: string } {
  if (actor.role !== "admin") {
    throw new AuthError("Admin access required", 403);
  }

  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new AuthError("Email is required", 400);
  }
  if (findUserByEmail(normalizedEmail)) {
    throw new AuthError("That user already has an account", 409);
  }

  const db = getDb();
  const now = new Date();
  db.prepare(
    `UPDATE invites
     SET revoked_at = ?
     WHERE email = ? AND accepted_at IS NULL AND revoked_at IS NULL`
  ).run(now.toISOString(), normalizedEmail);

  const inviteId = randomUUID();
  const token = generateOpaqueToken();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_SECONDS * 1000).toISOString();

  db.prepare(
    `INSERT INTO invites (id, email, role, token_hash, invited_by_user_id, created_at, expires_at, accepted_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`
  ).run(
    inviteId,
    normalizedEmail,
    role,
    hashOpaqueToken(token),
    actor.id,
    now.toISOString(),
    expiresAt
  );

  return {
    id: inviteId,
    email: normalizedEmail,
    role,
    createdAt: now.toISOString(),
    expiresAt,
    acceptedAt: null,
    revokedAt: null,
    invitationUrl: getInviteUrl(token),
  };
}

export function listInvites(actor: AuthViewer): AuthInviteRecord[] {
  if (actor.role !== "admin") {
    throw new AuthError("Admin access required", 403);
  }

  const rows = getDb()
    .prepare(
      `SELECT id, email, role, token_hash, invited_by_user_id, created_at, expires_at, accepted_at, revoked_at
       FROM invites
       ORDER BY datetime(created_at) DESC`
    )
    .all() as InviteRow[];
  return rows.map(toInviteRecord);
}

export function revokeInvite(actor: AuthViewer, inviteId: string): void {
  if (actor.role !== "admin") {
    throw new AuthError("Admin access required", 403);
  }

  const result = getDb()
    .prepare(
      `UPDATE invites
       SET revoked_at = COALESCE(revoked_at, ?)
       WHERE id = ?`
    )
    .run(new Date().toISOString(), inviteId);

  if (result.changes === 0) {
    throw new AuthError("Invite not found", 404);
  }
}

export function getInvitePreview(token: string): AuthInviteRecord {
  return toInviteRecord(requireActiveInvite(token));
}

export function acceptInvite(token: string, password: string): {
  viewer: AuthViewer;
  sessionToken: string;
} {
  const db = getDb();
  const invite = requireActiveInvite(token);
  const existingUser = findUserByEmail(invite.email);
  if (existingUser) {
    throw new AuthError("That account already exists", 409);
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    const user = createUser(invite.email, password, invite.role);
    db.prepare("UPDATE invites SET accepted_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      invite.id
    );
    const sessionToken = issueSession(user.id);
    db.exec("COMMIT");
    return { viewer: toViewer(user), sessionToken };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function requireViewerById(userId: string): AuthViewer {
  const user = findUserById(userId);
  if (!user) {
    throw new AuthError("User not found", 404);
  }
  return toViewer(user);
}

export function updateViewerProfile(
  actor: AuthViewer,
  payload: { avatarPath?: string | null }
): AuthViewer {
  const user = findUserById(actor.id);
  if (!user) {
    throw new AuthError("User not found", 404);
  }

  const nextAvatarPath =
    payload.avatarPath === undefined
      ? user.avatar_path
      : normalizeAvatarPath(payload.avatarPath);
  const updatedAt = new Date().toISOString();

  getDb()
    .prepare(
      `UPDATE users
       SET avatar_path = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(nextAvatarPath, updatedAt, actor.id);

  return toViewer({
    ...user,
    avatar_path: nextAvatarPath,
    updated_at: updatedAt,
  });
}
