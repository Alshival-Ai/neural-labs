import { createHmac } from "node:crypto";
import type { SessionActor } from "./types.js";

// Passed only from auth_request to the workspace upstream. It is not a browser
// response or a provider credential. Bind to the original request so a local
// process cannot forge the old trusted-proxy user headers.
export function workspaceAssertion(actor: SessionActor, secret: string, uri: unknown, method: unknown, now = Date.now()) {
  if (secret.length < 32 || typeof uri !== "string" || !uri.startsWith("/workspace") || uri.length > 8192
      || typeof method !== "string" || !/^[A-Z]+$/.test(method)) return undefined;
  const payload = Buffer.from(JSON.stringify({ actor: actor.user.id, email: actor.user.email, role: actor.user.role,
    session: actor.session.tokenHash, uri, method, expires: now + 5000 })).toString("base64url");
  return `v1.${payload}.${createHmac("sha256", secret).update(`workspace-request-v1\n${payload}`).digest("base64url")}`;
}
