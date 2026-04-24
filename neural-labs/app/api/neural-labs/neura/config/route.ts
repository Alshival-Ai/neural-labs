import { NextResponse } from "next/server";

import { readNeuraConfig } from "@/lib/server/neura";
import { jsonErrorFromUnknown } from "@/lib/server/http";
import { applyUserSessionCookie, getUserSessionFromRequest } from "@/lib/server/user-session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const session = getUserSessionFromRequest(request);
    const response = NextResponse.json(await readNeuraConfig(session.userId));
    return applyUserSessionCookie(response, session);
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to load Neura config", 401);
  }
}
