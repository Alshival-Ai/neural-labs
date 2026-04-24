import { NextResponse } from "next/server";

import { jsonErrorFromUnknown } from "@/lib/server/http";
import { getTerminalManager } from "@/lib/server/terminal-manager";
import { applyUserSessionCookie, getUserSessionFromRequest } from "@/lib/server/user-session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const session = getUserSessionFromRequest(request);
    const response = NextResponse.json({
      sessions: getTerminalManager().list(session.userId),
    });
    return applyUserSessionCookie(response, session);
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to list terminals", 401);
  }
}

export async function POST(request: Request) {
  try {
    const userSession = getUserSessionFromRequest(request);
    const terminalSession = await getTerminalManager().createSession(userSession.userId);
    const response = NextResponse.json({
      id: terminalSession.id,
      title: terminalSession.title,
      createdAt: terminalSession.createdAt,
      alive: terminalSession.alive,
    });
    return applyUserSessionCookie(response, userSession);
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to create terminal");
  }
}
