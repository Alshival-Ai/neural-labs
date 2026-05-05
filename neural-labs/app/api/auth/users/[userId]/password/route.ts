import { NextResponse } from "next/server";

import { requireAdminViewerFromRequest, setUserPasswordAsAdmin } from "@/lib/server/auth";
import { jsonErrorFromUnknown } from "@/lib/server/http";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ userId: string }> }
) {
  try {
    const viewer = requireAdminViewerFromRequest(request);
    const { userId } = await context.params;
    const payload = (await request.json()) as {
      password?: string;
      generatePassword?: boolean;
    };
    return NextResponse.json(setUserPasswordAsAdmin(viewer, userId, payload));
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to set password", 400);
  }
}
