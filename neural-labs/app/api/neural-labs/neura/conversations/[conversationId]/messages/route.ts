import { NextResponse } from "next/server";

import { jsonError, jsonErrorFromUnknown } from "@/lib/server/http";
import { appendConversationMessage } from "@/lib/server/neura";
import { applyUserSessionCookie, getUserSessionFromRequest } from "@/lib/server/user-session";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ conversationId: string }> }
) {
  try {
    const session = getUserSessionFromRequest(request);
    const { conversationId } = await context.params;
    const payload = (await request.json()) as { content?: string };
    if (!payload.content?.trim()) {
      return jsonError("A message is required");
    }
    const response = NextResponse.json(
      await appendConversationMessage(session.userId, conversationId, payload.content)
    );
    return applyUserSessionCookie(response, session);
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to send message");
  }
}
