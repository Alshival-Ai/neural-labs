import { NextResponse } from "next/server";

import { createWorkspaceDirectory } from "@/lib/server/filesystem";
import { jsonErrorFromUnknown } from "@/lib/server/http";
import { applyUserSessionCookie, getUserSessionFromRequest } from "@/lib/server/user-session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const session = getUserSessionFromRequest(request);
    const payload = (await request.json()) as { parentPath?: string; name?: string };
    const response = NextResponse.json({
      path: await createWorkspaceDirectory(
        session.userId,
        payload.parentPath ?? "",
        payload.name ?? ""
      ),
    });
    return applyUserSessionCookie(response, session);
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to create directory");
  }
}
