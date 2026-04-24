import { NextResponse } from "next/server";

import {
  requireViewerFromRequest,
  updateViewerProfile,
} from "@/lib/server/auth";
import { jsonErrorFromUnknown } from "@/lib/server/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const viewer = requireViewerFromRequest(request);
    return NextResponse.json({ viewer });
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to load profile", 401);
  }
}

export async function PATCH(request: Request) {
  try {
    const viewer = requireViewerFromRequest(request);
    const payload = (await request.json()) as { avatarPath?: string | null };
    return NextResponse.json({
      viewer: updateViewerProfile(viewer, {
        avatarPath: payload.avatarPath,
      }),
    });
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to update profile", 400);
  }
}
