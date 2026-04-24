import { NextResponse } from "next/server";

import { jsonErrorFromUnknown } from "@/lib/server/http";
import { getTerminalManager } from "@/lib/server/terminal-manager";
import { applyUserSessionCookie, getUserSessionFromRequest } from "@/lib/server/user-session";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
) {
  try {
    const session = getUserSessionFromRequest(request);
    const { sessionId } = await context.params;
    const payload = (await request.json()) as { data?: string };
    getTerminalManager().writeInput(session.userId, sessionId, payload.data ?? "");
    return applyUserSessionCookie(new NextResponse(null, { status: 204 }), session);
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to write to terminal");
  }
}
