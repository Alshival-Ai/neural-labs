import { NextResponse } from "next/server";

import { jsonError } from "@/lib/server/http";
import { createConversation, listConversationSummaries } from "@/lib/server/neura";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ conversations: await listConversationSummaries() });
}

export async function POST() {
  try {
    return NextResponse.json(await createConversation());
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unable to create conversation");
  }
}
