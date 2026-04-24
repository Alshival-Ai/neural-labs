import { NextResponse } from "next/server";

import { jsonError, jsonErrorFromUnknown } from "@/lib/server/http";
import { getTerminalManager } from "@/lib/server/terminal-manager";
import { applyUserSessionCookie, getUserSessionFromRequest } from "@/lib/server/user-session";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
) {
  try {
    const session = getUserSessionFromRequest(request);
    const { sessionId } = await context.params;
    const status = getTerminalManager().getStatus(session.userId, sessionId);
    if (!status) {
      return jsonError("Terminal session not found", 404);
    }
    return applyUserSessionCookie(NextResponse.json(status), session);
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to load terminal session", 401);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
) {
  try {
    const session = getUserSessionFromRequest(request);
    const { sessionId } = await context.params;
    getTerminalManager().close(session.userId, sessionId);
    return applyUserSessionCookie(new NextResponse(null, { status: 204 }), session);
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to close terminal session", 401);
  }
}
