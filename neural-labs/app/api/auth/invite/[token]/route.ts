import { NextResponse } from "next/server";

import { acceptInvite, applySessionCookie } from "@/lib/server/auth";
import { jsonErrorFromUnknown } from "@/lib/server/http";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const payload = (await request.json()) as { password?: string };
    const { token } = await context.params;
    const result = acceptInvite(token, payload.password ?? "");
    return applySessionCookie(
      NextResponse.json({ viewer: result.viewer }),
      result.sessionToken
    );
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to accept invite", 400);
  }
}
