import { NextResponse } from "next/server";

import {
  deleteUserAsAdmin,
  requireAdminViewerFromRequest,
  updateUserAsAdmin,
} from "@/lib/server/auth";
import { jsonErrorFromUnknown } from "@/lib/server/http";
import { destroyWorkspaceSession } from "@/lib/server/workspace-session";
import type { AuthRole } from "@/lib/shared/types";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ userId: string }> }
) {
  try {
    const viewer = requireAdminViewerFromRequest(request);
    const { userId } = await context.params;
    const payload = (await request.json()) as {
      role?: AuthRole;
      disabled?: boolean;
    };
    return NextResponse.json({ user: updateUserAsAdmin(viewer, userId, payload) });
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to update user", 400);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ userId: string }> }
) {
  try {
    const viewer = requireAdminViewerFromRequest(request);
    const { userId } = await context.params;
    const payload = (await request.json().catch(() => ({}))) as {
      deleteWorkspace?: boolean;
    };
    const deleted = deleteUserAsAdmin(viewer, userId);
    if (payload.deleteWorkspace) {
      await destroyWorkspaceSession(userId);
    }
    return NextResponse.json({ deleted });
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to delete user", 400);
  }
}
