import { NextResponse } from "next/server";

import {
  createPasswordReset,
  listPasswordResets,
  requireAdminViewerFromRequest,
} from "@/lib/server/auth";
import { jsonErrorFromUnknown } from "@/lib/server/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const viewer = requireAdminViewerFromRequest(request);
    return NextResponse.json({ resets: listPasswordResets(viewer) });
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to list password resets", 401);
  }
}

export async function POST(request: Request) {
  try {
    const viewer = requireAdminViewerFromRequest(request);
    const payload = (await request.json()) as { userId?: string };
    return NextResponse.json(createPasswordReset(viewer, payload.userId ?? ""));
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to create password reset", 400);
  }
}
