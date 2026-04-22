import { NextResponse } from "next/server";

import { uploadWorkspaceFile } from "@/lib/server/filesystem";
import { jsonError } from "@/lib/server/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const parentPath = String(formData.get("path") ?? "");
    if (!(file instanceof File)) {
      return jsonError("A file upload is required");
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    return NextResponse.json({
      path: await uploadWorkspaceFile(parentPath, file.name, buffer),
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unable to upload file");
  }
}
