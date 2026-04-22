import { NextResponse } from "next/server";

import { createWorkspaceDirectory } from "@/lib/server/filesystem";
import { jsonError } from "@/lib/server/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { parentPath?: string; name?: string };
    return NextResponse.json({
      path: await createWorkspaceDirectory(payload.parentPath ?? "", payload.name ?? ""),
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unable to create directory");
  }
}
