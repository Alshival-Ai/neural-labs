import { NextResponse } from "next/server";
import { jsonErrorFromUnknown } from "@/lib/server/http";
import { getTerminalManager } from "@/lib/server/terminal-manager";
import { applyUserSessionCookie, getUserSessionFromRequest } from "@/lib/server/user-session";

export const runtime = "nodejs";

interface ResizePayload {
  cols?: number;
  rows?: number;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const session = getUserSessionFromRequest(request);
    const { sessionId } = await params;
    const payload = (await request.json().catch(() => ({}))) as ResizePayload;
    getTerminalManager().resize(
      session.userId,
      sessionId,
      payload.cols,
      payload.rows
    );
    return applyUserSessionCookie(new NextResponse(null, { status: 204 }), session);
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to resize terminal", 401);
  }
}
