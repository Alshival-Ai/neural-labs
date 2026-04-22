import { NextResponse } from "next/server";

import { jsonError } from "@/lib/server/http";
import { renameWorkspacePath } from "@/lib/server/filesystem";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  try {
    const payload = (await request.json()) as { path?: string; name?: string };
    return NextResponse.json({
      path: await renameWorkspacePath(payload.path ?? "", payload.name ?? ""),
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unable to rename path");
  }
}
