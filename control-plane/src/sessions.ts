import type { Request, Response } from "express";

import type { ControlPlaneConfig } from "./config.js";
import { hashToken, randomToken } from "./crypto.js";
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
      sameSite: "lax" as const,
      path: "/",
      maxAge: ABSOLUTE_MILLISECONDS,
    };
  }

  async create(response: Response, userId: string): Promise<void> {
    const token = randomToken();
    const csrf = randomToken();
    const now = Date.now();
    await this.database.createSession({
      tokenHash: hashToken(token),
      csrfHash: hashToken(csrf),
      userId,
      idleExpiresAt: new Date(now + IDLE_MILLISECONDS),
      absoluteExpiresAt: new Date(now + ABSOLUTE_MILLISECONDS),
    });
    response.cookie(this.sessionCookieName, token, this.cookieOptions(true));
    response.cookie(this.csrfCookieName, csrf, this.cookieOptions(false));
  }

  async actor(request: Request): Promise<SessionActor | undefined> {
    const token = parseCookies(request.headers.cookie).get(this.sessionCookieName);
    if (!token) return undefined;
    const actor = await this.database.getSessionActor(hashToken(token));
    if (!actor) return undefined;
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
    if (token) await this.database.deleteSession(hashToken(token));
    response.clearCookie(this.sessionCookieName, this.cookieOptions(true));
    response.clearCookie(this.csrfCookieName, this.cookieOptions(false));
  }
}
