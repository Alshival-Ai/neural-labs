import { NextResponse } from "next/server";

import { applySessionCookie, loginWithPassword } from "@/lib/server/auth";
import { jsonErrorFromUnknown } from "@/lib/server/http";
import { getWorkspaceSession } from "@/lib/server/workspace-session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { email?: string; password?: string };
    const result = loginWithPassword(payload.email ?? "", payload.password ?? "");
    await getWorkspaceSession(result.viewer.id);
    return applySessionCookie(
      NextResponse.json({ viewer: result.viewer }),
      result.sessionToken
    );
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to sign in", 500);
  }
}
