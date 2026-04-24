import { NextResponse } from "next/server";

import { uploadWorkspaceFile } from "@/lib/server/filesystem";
import { jsonError, jsonErrorFromUnknown } from "@/lib/server/http";
import { applyUserSessionCookie, getUserSessionFromRequest } from "@/lib/server/user-session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const session = getUserSessionFromRequest(request);
    const formData = await request.formData();
    const file = formData.get("file");
    const parentPath = String(formData.get("path") ?? "");
    if (!(file instanceof File)) {
      return jsonError("A file upload is required");
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const response = NextResponse.json({
      path: await uploadWorkspaceFile(session.userId, parentPath, file.name, buffer),
    });
    return applyUserSessionCookie(response, session);
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to upload file");
  }
}
