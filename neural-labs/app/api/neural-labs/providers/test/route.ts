import { NextResponse } from "next/server";

import { jsonError, jsonErrorFromUnknown } from "@/lib/server/http";
import { testProviderConnection } from "@/lib/server/neura";
import { readSettingsSnapshot } from "@/lib/server/store";
import { applyUserSessionCookie, getUserSessionFromRequest } from "@/lib/server/user-session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const session = getUserSessionFromRequest(request);
    const payload = (await request.json()) as { providerId: string };
    const settings = await readSettingsSnapshot(session.userId);
    const provider = settings.providers.find((entry) => entry.id === payload.providerId);
    if (!provider) {
      return jsonError("Provider not found", 404);
    }
    const response = NextResponse.json(await testProviderConnection(provider));
    return applyUserSessionCookie(response, session);
  } catch (error) {
    return jsonErrorFromUnknown(error, "Connection test failed");
  }
}
