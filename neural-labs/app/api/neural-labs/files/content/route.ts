import { NextResponse } from "next/server";

import { readWorkspaceFile, writeWorkspaceTextFile } from "@/lib/server/filesystem";
import { jsonError } from "@/lib/server/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const path = url.searchParams.get("path") ?? "";
    const { content, filename, mimeType } = await readWorkspaceFile(path);
    return new NextResponse(new Uint8Array(content), {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `inline; filename="${filename}"`,
      },
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unable to read file", 404);
  }
}

export async function PUT(request: Request) {
  try {
    const payload = (await request.json()) as { path: string; content: string };
    return NextResponse.json({
      path: await writeWorkspaceTextFile(payload.path, payload.content),
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unable to save file");
  }
}
