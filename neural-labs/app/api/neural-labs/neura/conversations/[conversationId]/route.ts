import { NextResponse } from "next/server";

import { jsonError } from "@/lib/server/http";
import { getConversation, removeConversation } from "@/lib/server/store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ conversationId: string }> }
) {
  const { conversationId } = await context.params;
  const conversation = await getConversation(conversationId);
  if (!conversation) {
    return jsonError("Conversation not found", 404);
  }
  return NextResponse.json(conversation);
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ conversationId: string }> }
) {
  const { conversationId } = await context.params;
  await removeConversation(conversationId);
  return new NextResponse(null, { status: 204 });
}
