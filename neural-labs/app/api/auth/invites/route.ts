import { NextResponse } from "next/server";

import { createInvite, listInvites, requireAdminViewerFromRequest } from "@/lib/server/auth";
import { jsonErrorFromUnknown } from "@/lib/server/http";
import type { AuthRole } from "@/lib/shared/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const viewer = requireAdminViewerFromRequest(request);
    return NextResponse.json({ invites: listInvites(viewer) });
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to list invites", 401);
  }
}

export async function POST(request: Request) {
  try {
    const viewer = requireAdminViewerFromRequest(request);
    const payload = (await request.json()) as { email?: string; role?: AuthRole };
    return NextResponse.json(createInvite(viewer, payload.email ?? "", payload.role ?? "user"));
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to create invite", 400);
  }
}
