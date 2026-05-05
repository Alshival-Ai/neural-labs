import { NextResponse } from "next/server";

import { requireAdminViewerFromRequest, revokePasswordReset } from "@/lib/server/auth";
import { jsonErrorFromUnknown } from "@/lib/server/http";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ resetId: string }> }
) {
  try {
    const viewer = requireAdminViewerFromRequest(request);
    const { resetId } = await context.params;
    revokePasswordReset(viewer, resetId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to revoke password reset", 400);
  }
}
