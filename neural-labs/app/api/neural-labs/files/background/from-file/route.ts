import { NextResponse } from "next/server";

import { setWorkspaceBackgroundFromFile } from "@/lib/server/filesystem";
import { jsonError, jsonErrorFromUnknown } from "@/lib/server/http";
import { applyUserSessionCookie, getUserSessionFromRequest } from "@/lib/server/user-session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const session = getUserSessionFromRequest(request);
    const payload = (await request.json()) as { path?: string };
    if (!payload.path?.trim()) {
      return jsonError("A file path is required");
    }

    const response = NextResponse.json({
      path: await setWorkspaceBackgroundFromFile(session.userId, payload.path),
    });
    return applyUserSessionCookie(response, session);
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to set desktop background");
  }
}
