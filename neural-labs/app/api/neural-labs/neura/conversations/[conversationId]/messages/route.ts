import { NextResponse } from "next/server";

import { jsonError } from "@/lib/server/http";
import { appendConversationMessage } from "@/lib/server/neura";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ conversationId: string }> }
) {
  try {
    const { conversationId } = await context.params;
    const payload = (await request.json()) as { content?: string };
    if (!payload.content?.trim()) {
      return jsonError("A message is required");
    }
    return NextResponse.json(
      await appendConversationMessage(conversationId, payload.content)
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unable to send message");
  }
}
