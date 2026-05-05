import { NextResponse } from "next/server";

import { jsonErrorFromUnknown } from "@/lib/server/http";
import type { DesktopBackgroundId } from "@/lib/shared/types";
import { readSettingsSnapshot, updateDesktopSettings } from "@/lib/server/store";
import { applyUserSessionCookie, getUserSessionFromRequest } from "@/lib/server/user-session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const session = getUserSessionFromRequest(request);
    const response = NextResponse.json(await readSettingsSnapshot(session.userId));
    return applyUserSessionCookie(response, session);
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to load settings", 401);
  }
}

export async function PUT(request: Request) {
  try {
    const session = getUserSessionFromRequest(request);
    const payload = (await request.json()) as {
      theme?: "dark" | "light" | "system";
      backgroundId?: DesktopBackgroundId;
      customBackgroundPath?: string | null;
      customBackgroundVersion?: string | null;
    };
    const response = NextResponse.json(
      await updateDesktopSettings(session.userId, payload)
    );
    return applyUserSessionCookie(response, session);
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to save settings");
  }
}
