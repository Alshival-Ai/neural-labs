import { NextResponse } from "next/server";

import { readWorkspaceFile, writeWorkspaceTextFile } from "@/lib/server/filesystem";
import { jsonErrorFromUnknown } from "@/lib/server/http";
import { applyUserSessionCookie, getUserSessionFromRequest } from "@/lib/server/user-session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const session = getUserSessionFromRequest(request);
    const url = new URL(request.url);
    const path = url.searchParams.get("path") ?? "";
    const { content, filename, mimeType } = await readWorkspaceFile(session.userId, path);
    const response = new NextResponse(new Uint8Array(content), {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `inline; filename="${filename}"`,
      },
    });
    return applyUserSessionCookie(response, session);
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to read file", 404);
  }
}

export async function PUT(request: Request) {
  try {
    const session = getUserSessionFromRequest(request);
    const payload = (await request.json()) as { path: string; content: string };
    const response = NextResponse.json({
      path: await writeWorkspaceTextFile(session.userId, payload.path, payload.content),
    });
    return applyUserSessionCookie(response, session);
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to save file");
  }
}
