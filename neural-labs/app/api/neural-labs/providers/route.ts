import { NextResponse } from "next/server";

import { jsonErrorFromUnknown } from "@/lib/server/http";
import { readSettingsSnapshot, saveProvider } from "@/lib/server/store";
import { applyUserSessionCookie, getUserSessionFromRequest } from "@/lib/server/user-session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const session = getUserSessionFromRequest(request);
    const snapshot = await readSettingsSnapshot(session.userId);
    return applyUserSessionCookie(NextResponse.json(snapshot.providers), session);
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to load providers", 401);
  }
}

export async function POST(request: Request) {
  try {
    const session = getUserSessionFromRequest(request);
    const payload = await request.json();
    const response = NextResponse.json(await saveProvider(session.userId, payload));
    return applyUserSessionCookie(response, session);
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to save provider");
  }
}
