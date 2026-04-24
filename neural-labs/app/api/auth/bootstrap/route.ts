import { NextResponse } from "next/server";

import { applySessionCookie, bootstrapAdminAccount } from "@/lib/server/auth";
import { jsonErrorFromUnknown } from "@/lib/server/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { email?: string; password?: string };
    const result = bootstrapAdminAccount(payload.email ?? "", payload.password ?? "");
    return applySessionCookie(
      NextResponse.json({ viewer: result.viewer }),
      result.sessionToken
    );
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to bootstrap admin", 400);
  }
}
