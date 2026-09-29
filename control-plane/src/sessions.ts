import type { Request, Response } from "express";

import type { ControlPlaneConfig } from "./config.js";
import { hashToken, randomToken } from "./crypto.js";
import { CredentialCipher } from "./crypto.js";
import { resolveManagedUserId, portalCall, syncManagedUser } from "./managed.js";
import type { Database } from "./database.js";
import type { SessionActor } from "./types.js";

const IDLE_MILLISECONDS = 12 * 60 * 60 * 1000;
const ABSOLUTE_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;

function parseCookies(header: string | undefined): Map<string, string> {
  const values = new Map<string, string>();
  for (const item of header?.split(";") ?? []) {
    const separator = item.indexOf("=");
    if (separator <= 0) continue;
    const name = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    try {
      values.set(name, decodeURIComponent(value));
    } catch {
      // Ignore malformed cookie values.
    }
  }
  return values;
}

export class SessionService {
  readonly sessionCookieName: string;
  readonly csrfCookieName = "neural-labs-csrf";

  constructor(
    private readonly database: Database,
    private readonly config: ControlPlaneConfig,
  ) {
    this.sessionCookieName = config.secureCookies
      ? "__Host-neural-labs-session"
      : "neural-labs-session";
  }

  private cookieOptions(httpOnly: boolean) {
    return {
      httpOnly,
      secure: this.config.secureCookies,
      sameSite: this.config.managed && this.config.secureCookies ? "none" as const : "lax" as const,
      partitioned: Boolean(this.config.managed && this.config.secureCookies),
      path: "/",
      maxAge: ABSOLUTE_MILLISECONDS,
    };
  }

  async create(response: Response, userId: string, managed?: { token: string; expiresAt: Date }): Promise<void> {
    if (this.config.managed && !managed) throw new Error("Portal authorization is required");
    const token = randomToken();
    const csrf = randomToken();
    const now = Date.now();
    await this.database.createSession({
      tokenHash: hashToken(token),
      csrfHash: hashToken(csrf),
      userId,
      idleExpiresAt: new Date(now + IDLE_MILLISECONDS),
      absoluteExpiresAt: new Date(Math.min(now + ABSOLUTE_MILLISECONDS, managed?.expiresAt.getTime() ?? Infinity)),
    });
    if (managed) await this.database.pool.query("UPDATE sessions SET portal_grant = $2 WHERE token_hash = $1",
      [hashToken(token), new CredentialCipher(this.config.masterKey).encrypt({ token: managed.token })]);
    response.cookie(this.sessionCookieName, token, this.cookieOptions(true));
    response.cookie(this.csrfCookieName, csrf, this.cookieOptions(false));
  }

  async actor(request: Request): Promise<SessionActor | undefined> {
    const token = parseCookies(request.headers.cookie).get(this.sessionCookieName);
    if (!token) return undefined;
    return this.actorByTokenHash(hashToken(token));
  }

  // Execution leases revalidate the originating session without retaining its
  // browser cookie in the workspace runtime. Managed authorization stays live.
  async actorByTokenHash(tokenHash: string): Promise<SessionActor | undefined> {
    const actor = await this.database.getSessionActor(tokenHash);
    if (!actor) return undefined;
    if (this.config.managed) {
      try {
        const result = await this.database.pool.query("SELECT portal_grant FROM sessions WHERE token_hash=$1", [tokenHash]);
        const grant = new CredentialCipher(this.config.masterKey).decrypt<{ token: string }>(result.rows[0]?.portal_grant);
        const identity = (await portalCall(this.config, "authorize", grant.token))!;
        if (await resolveManagedUserId(this.database, this.config.managed, identity.subject) !== actor.user.id) return undefined;
        await syncManagedUser(this.database, this.config.managed, identity);
        actor.user.role = identity.role;
        actor.user.status = "active";
        actor.user.email = identity.email;
        actor.user.displayName = identity.display_name;
      } catch { return undefined; }
    }
    await this.database.touchSession(
      actor.session.tokenHash,
      new Date(Date.now() + IDLE_MILLISECONDS),
    );
    return actor;
  }

  csrfToken(request: Request): string | undefined {
    return parseCookies(request.headers.cookie).get(this.csrfCookieName);
  }

  validateCsrf(request: Request, actor: SessionActor): boolean {
    const bodyToken = typeof request.body?._csrf === "string" ? request.body._csrf : undefined;
    const headerToken = request.get("x-csrf-token");
    const suppliedToken = headerToken || bodyToken;
    const cookieToken = this.csrfToken(request);
    return Boolean(
      suppliedToken &&
        cookieToken &&
        suppliedToken === cookieToken &&
        hashToken(suppliedToken) === actor.session.csrfHash,
    );
  }

  async destroy(request: Request, response: Response): Promise<void> {
    const token = parseCookies(request.headers.cookie).get(this.sessionCookieName);
    if (token && this.config.managed) {
      try {
        const result = await this.database.pool.query("SELECT portal_grant FROM sessions WHERE token_hash=$1", [hashToken(token)]);
        const grant = new CredentialCipher(this.config.masterKey).decrypt<{ token: string }>(result.rows[0]?.portal_grant);
        await portalCall(this.config, "revoke", grant.token);
      } catch { /* Local logout still closes access during a portal outage. */ }
    }
    if (token) await this.database.deleteSession(hashToken(token));
    response.clearCookie(this.sessionCookieName, this.cookieOptions(true));
    response.clearCookie(this.csrfCookieName, this.cookieOptions(false));
  }
}
