import { NextResponse } from "next/server";

import { jsonError } from "@/lib/server/http";
import { getTerminalManager } from "@/lib/server/terminal-manager";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await context.params;
  const status = getTerminalManager().getStatus(sessionId);
  if (!status) {
    return jsonError("Terminal session not found", 404);
  }
  return NextResponse.json(status);
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await context.params;
  getTerminalManager().close(sessionId);
  return new NextResponse(null, { status: 204 });
}
