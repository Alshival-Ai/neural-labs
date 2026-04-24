import type { AuthViewer } from "@/lib/shared/types";
import { AuthError, getSessionContextFromRequest } from "@/lib/server/auth";

export interface UserSessionContext {
  userId: string;
  viewer: AuthViewer;
  setCookieHeader: null;
}

export function getUserSessionFromRequest(request: Request): UserSessionContext {
  const context = getSessionContextFromRequest(request);
  if (!context.viewer) {
    throw new AuthError("Authentication required", 401);
  }

  return {
    userId: context.viewer.id,
    viewer: context.viewer,
    setCookieHeader: null,
  };
}

export function applyUserSessionCookie(
  response: Response,
  _session: UserSessionContext
): Response {
  return response;
}
