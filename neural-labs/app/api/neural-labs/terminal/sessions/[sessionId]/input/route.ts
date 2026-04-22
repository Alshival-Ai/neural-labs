import { NextResponse } from "next/server";

import { jsonError } from "@/lib/server/http";
import { getTerminalManager } from "@/lib/server/terminal-manager";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await context.params;
    const payload = (await request.json()) as { data?: string };
    getTerminalManager().writeInput(sessionId, payload.data ?? "");
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unable to write to terminal");
  }
}
