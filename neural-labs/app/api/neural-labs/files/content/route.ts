import { NextResponse } from "next/server";

import {
  getWorkspaceFileMetadata,
  readWorkspaceFile,
  writeWorkspaceTextFile,
} from "@/lib/server/filesystem";
import { jsonErrorFromUnknown } from "@/lib/server/http";
import { applyUserSessionCookie, getUserSessionFromRequest } from "@/lib/server/user-session";

export const runtime = "nodejs";

function isFresh(request: Request, etag: string, modifiedAt: string): boolean {
  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch?.split(",").map((entry) => entry.trim()).includes(etag)) {
    return true;
  }

  const ifModifiedSince = request.headers.get("if-modified-since");
  if (!ifModifiedSince) {
    return false;
  }

  const sinceTime = Date.parse(ifModifiedSince);
  const modifiedTime = Date.parse(modifiedAt);
  return Number.isFinite(sinceTime) && Number.isFinite(modifiedTime) && modifiedTime <= sinceTime;
}

export async function GET(request: Request) {
  try {
    const session = getUserSessionFromRequest(request);
    const url = new URL(request.url);
    const path = url.searchParams.get("path") ?? "";
    const version = url.searchParams.get("v")?.trim();
    const { filename, mimeType, modifiedAt, etag } = await getWorkspaceFileMetadata(
      session.userId,
      path
    );
    const isImage = mimeType.toLowerCase().startsWith("image/");
    const headers = new Headers({
      "Content-Type": mimeType,
      "Content-Disposition": `inline; filename="${filename}"`,
      "ETag": etag,
      "Last-Modified": new Date(modifiedAt).toUTCString(),
    });
    if (isImage && version) {
      headers.set("Cache-Control", "private, max-age=31536000, immutable");
    } else {
      headers.set("Cache-Control", "private, no-cache");
    }
    if (isImage && isFresh(request, etag, modifiedAt)) {
      return applyUserSessionCookie(new NextResponse(null, { status: 304, headers }), session);
    }

    const { content } = await readWorkspaceFile(session.userId, path);
    const response = new NextResponse(new Uint8Array(content), {
      headers,
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
