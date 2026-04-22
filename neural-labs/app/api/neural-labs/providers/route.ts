import { NextResponse } from "next/server";

import { jsonError } from "@/lib/server/http";
import { readSettingsSnapshot, saveProvider } from "@/lib/server/store";

export const runtime = "nodejs";

export async function GET() {
  const snapshot = await readSettingsSnapshot();
  return NextResponse.json(snapshot.providers);
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    return NextResponse.json(await saveProvider(payload));
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unable to save provider");
  }
}
