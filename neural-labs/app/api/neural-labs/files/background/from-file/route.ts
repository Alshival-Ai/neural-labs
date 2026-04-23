import { NextResponse } from "next/server";

import { setWorkspaceBackgroundFromFile } from "@/lib/server/filesystem";
import { jsonError } from "@/lib/server/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { path?: string };
    if (!payload.path?.trim()) {
      return jsonError("A file path is required");
    }

    return NextResponse.json({
      path: await setWorkspaceBackgroundFromFile(payload.path),
    });
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : "Unable to set desktop background"
    );
  }
}
