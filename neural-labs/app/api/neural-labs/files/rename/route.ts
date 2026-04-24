import { NextResponse } from "next/server";

import { jsonErrorFromUnknown } from "@/lib/server/http";
import { renameWorkspacePath } from "@/lib/server/filesystem";
import { applyUserSessionCookie, getUserSessionFromRequest } from "@/lib/server/user-session";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  try {
    const session = getUserSessionFromRequest(request);
    const payload = (await request.json()) as { path?: string; name?: string };
    const response = NextResponse.json({
      path: await renameWorkspacePath(session.userId, payload.path ?? "", payload.name ?? ""),
    });
    return applyUserSessionCookie(response, session);
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to rename path");
  }
}
