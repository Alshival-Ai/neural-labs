import { NextResponse } from "next/server";

import { jsonError } from "@/lib/server/http";
import type { DesktopBackgroundId } from "@/lib/shared/types";
import { readSettingsSnapshot, updateDesktopSettings } from "@/lib/server/store";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await readSettingsSnapshot());
}

export async function PUT(request: Request) {
  try {
    const payload = (await request.json()) as {
      theme?: "dark" | "light" | "system";
      backgroundId?: DesktopBackgroundId;
      customBackgroundPath?: string | null;
    };
    return NextResponse.json(await updateDesktopSettings(payload));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unable to save settings");
  }
}
