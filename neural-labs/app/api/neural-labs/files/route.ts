import { NextResponse } from "next/server";

import { deleteWorkspacePath, listDirectory } from "@/lib/server/filesystem";
import { jsonError } from "@/lib/server/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    return NextResponse.json(await listDirectory(url.searchParams.get("path") ?? ""));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unable to list files", 404);
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const path = url.searchParams.get("path") ?? "";
    await deleteWorkspacePath(path);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unable to delete path");
  }
}
