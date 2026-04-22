import { NextResponse } from "next/server";

import { jsonError } from "@/lib/server/http";
import { testProviderConnection } from "@/lib/server/neura";
import { readSettingsSnapshot } from "@/lib/server/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { providerId: string };
    const settings = await readSettingsSnapshot();
    const provider = settings.providers.find((entry) => entry.id === payload.providerId);
    if (!provider) {
      return jsonError("Provider not found", 404);
    }
    return NextResponse.json(await testProviderConnection(provider));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Connection test failed");
  }
}
