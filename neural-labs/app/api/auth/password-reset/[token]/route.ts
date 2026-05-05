import { NextResponse } from "next/server";

import { acceptPasswordReset, applySessionCookie } from "@/lib/server/auth";
import { jsonErrorFromUnknown } from "@/lib/server/http";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    const payload = (await request.json()) as { password?: string };
    const result = acceptPasswordReset(token, payload.password ?? "");
    return applySessionCookie(NextResponse.json({ viewer: result.viewer }), result.sessionToken);
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to reset password", 400);
  }
}
