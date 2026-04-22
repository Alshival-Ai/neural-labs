import { NextResponse } from "next/server";

import { moveWorkspacePath } from "@/lib/server/filesystem";
import { jsonError } from "@/lib/server/http";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  try {
    const payload = (await request.json()) as {
      path?: string;
      destinationParentPath?: string;
      name?: string;
    };
    return NextResponse.json({
      path: await moveWorkspacePath(
        payload.path ?? "",
        payload.destinationParentPath ?? "",
        payload.name
      ),
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unable to move path");
  }
}
