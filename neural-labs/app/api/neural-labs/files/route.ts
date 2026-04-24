import { NextResponse } from "next/server";

import { deleteWorkspacePath, listDirectory } from "@/lib/server/filesystem";
import { jsonErrorFromUnknown } from "@/lib/server/http";
import { applyUserSessionCookie, getUserSessionFromRequest } from "@/lib/server/user-session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const session = getUserSessionFromRequest(request);
    const url = new URL(request.url);
    const response = NextResponse.json(
      await listDirectory(session.userId, url.searchParams.get("path") ?? "")
    );
    return applyUserSessionCookie(response, session);
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to list files", 404);
  }
}

export async function DELETE(request: Request) {
  try {
    const session = getUserSessionFromRequest(request);
    const url = new URL(request.url);
    const path = url.searchParams.get("path") ?? "";
    await deleteWorkspacePath(session.userId, path);
    return applyUserSessionCookie(new NextResponse(null, { status: 204 }), session);
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to delete path");
  }
}
