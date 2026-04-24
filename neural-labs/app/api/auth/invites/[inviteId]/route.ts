import { NextResponse } from "next/server";

import { requireAdminViewerFromRequest, revokeInvite } from "@/lib/server/auth";
import { jsonErrorFromUnknown } from "@/lib/server/http";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ inviteId: string }> }
) {
  try {
    const viewer = requireAdminViewerFromRequest(request);
    const { inviteId } = await context.params;
    revokeInvite(viewer, inviteId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to revoke invite", 400);
  }
}
