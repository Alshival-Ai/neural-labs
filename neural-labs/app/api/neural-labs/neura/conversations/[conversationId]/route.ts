import { NextResponse } from "next/server";

import { jsonError, jsonErrorFromUnknown } from "@/lib/server/http";
import { getConversation, removeConversation } from "@/lib/server/store";
import { applyUserSessionCookie, getUserSessionFromRequest } from "@/lib/server/user-session";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ conversationId: string }> }
) {
  try {
    const session = getUserSessionFromRequest(request);
    const { conversationId } = await context.params;
    const conversation = await getConversation(session.userId, conversationId);
    if (!conversation) {
      return jsonError("Conversation not found", 404);
    }
    return applyUserSessionCookie(NextResponse.json(conversation), session);
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to load conversation", 401);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ conversationId: string }> }
) {
  try {
    const session = getUserSessionFromRequest(request);
    const { conversationId } = await context.params;
    await removeConversation(session.userId, conversationId);
    return applyUserSessionCookie(new NextResponse(null, { status: 204 }), session);
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to delete conversation", 401);
  }
}
