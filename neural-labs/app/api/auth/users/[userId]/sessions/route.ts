import { NextResponse } from "next/server";

import { requireAdminViewerFromRequest, revokeUserSessions } from "@/lib/server/auth";
import { jsonErrorFromUnknown } from "@/lib/server/http";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ userId: string }> }
) {
  try {
    const viewer = requireAdminViewerFromRequest(request);
    const { userId } = await context.params;
    revokeUserSessions(viewer, userId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to revoke sessions", 400);
  }
}
