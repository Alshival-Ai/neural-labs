import { NextResponse } from "next/server";
import { jsonErrorFromUnknown } from "@/lib/server/http";
import { applyUserSessionCookie, getUserSessionFromRequest } from "@/lib/server/user-session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const session = getUserSessionFromRequest(request);
    return applyUserSessionCookie(new NextResponse(null, { status: 204 }), session);
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to resize terminal", 401);
  }
}
