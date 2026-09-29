import { createHmac, timingSafeEqual } from "node:crypto";
import { identity } from "./state.mjs";

export function authorizeWorkspaceHttpRequest(request, secret) {
  const pathname = new URL(request.url, "http://workspace.local").pathname;
  if (["GET", "HEAD"].includes(request.method)
      && ["/workspace/preview/", "/workspace/image-editor/"].some(prefix => pathname.startsWith(prefix))) {
    // Preview handlers validate their own expiring capability on every read.
    // The image editor path serves only bundled public code. Neither surface
    // may inherit a caller's identity or browser credential headers.
    for (const name of ["x-forwarded-user", "x-neural-labs-email", "x-neural-labs-role", "x-neural-labs-session",
      "x-neural-labs-assertion", "cookie", "authorization"]) delete request.headers[name];
    return null;
  }
  return authenticateWorkspaceRequest(request, secret);
}

export function authenticateWorkspaceRequest(request, secret, now = Date.now()) {
  const header = request.headers["x-neural-labs-assertion"];
  if (typeof secret !== "string" || secret.length < 32 || typeof header !== "string" || header.length > 16000)
    throw new Error("Workspace request authorization is required");
  const match = /^v1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(header);
  if (!match) throw new Error("Invalid workspace assertion");
  const expected = createHmac("sha256", secret).update(`workspace-request-v1\n${match[1]}`).digest();
  const supplied = Buffer.from(match[2], "base64url");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error("Invalid workspace assertion");
  const actor = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8"));
  identity(actor.actor);
  if (!["user", "admin"].includes(actor.role) || typeof actor.email !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(actor.session)
      || !Number.isSafeInteger(actor.expires) || actor.expires <= now || actor.expires > now + 5000
      || actor.uri !== request.url || actor.method !== request.method) throw new Error("Workspace assertion expired or does not match this request");
  // Ignore all independently supplied identity headers. Downstream application
  // adapters receive only the authenticated control-plane identity.
  request.headers["x-forwarded-user"] = actor.actor;
  request.headers["x-neural-labs-email"] = actor.email;
  request.headers["x-neural-labs-role"] = actor.role;
  request.headers["x-neural-labs-session"] = actor.session;
  delete request.headers["x-neural-labs-assertion"];
  // Neither extensions nor workspace apps may receive the portal session.
  delete request.headers.cookie;
  delete request.headers.authorization;
  return actor;
}
