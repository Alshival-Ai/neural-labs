import { NextResponse } from "next/server";

import { moveWorkspacePath } from "@/lib/server/filesystem";
import { jsonErrorFromUnknown } from "@/lib/server/http";
import { applyUserSessionCookie, getUserSessionFromRequest } from "@/lib/server/user-session";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  try {
    const session = getUserSessionFromRequest(request);
    const payload = (await request.json()) as {
      path?: string;
      destinationParentPath?: string;
      name?: string;
    };
    const response = NextResponse.json({
      path: await moveWorkspacePath(
        session.userId,
        payload.path ?? "",
        payload.destinationParentPath ?? "",
        payload.name
      ),
    });
    return applyUserSessionCookie(response, session);
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to move path");
  }
}
