import { NextResponse } from "next/server";

import { jsonError, jsonErrorFromUnknown } from "@/lib/server/http";
import { getTerminalManager } from "@/lib/server/terminal-manager";
import { applyUserSessionCookie, getUserSessionFromRequest } from "@/lib/server/user-session";

export const runtime = "nodejs";

interface WsTokenRequestBody {
  terminal_id?: string;
  terminalId?: string;
}

export async function POST(request: Request) {
  try {
    const session = getUserSessionFromRequest(request);
    const payload = (await request.json()) as WsTokenRequestBody;
    const terminalId = (
      payload.terminal_id ||
      payload.terminalId ||
      ""
    ).trim();

    if (!terminalId) {
      return applyUserSessionCookie(
        jsonError("terminal_id is required", 400),
        session
      );
    }

    const ticket = getTerminalManager().issueWsTicket(session.userId, terminalId);
    const response = NextResponse.json({
      token: ticket,
      ws_path: `/api/neural-labs/terminal/ws?terminal_token=${encodeURIComponent(ticket)}`,
    });
    return applyUserSessionCookie(response, session);
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to issue websocket token", 400);
  }
}
