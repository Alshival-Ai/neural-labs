import { NextResponse } from "next/server";

import { jsonError } from "@/lib/server/http";
import { getTerminalManager } from "@/lib/server/terminal-manager";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ sessions: getTerminalManager().list() });
}

export async function POST() {
  try {
    const session = await getTerminalManager().createSession();
    return NextResponse.json({
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      alive: session.alive,
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unable to create terminal");
  }
}
