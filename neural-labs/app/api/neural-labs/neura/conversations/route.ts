import { NextResponse } from "next/server";

import { jsonErrorFromUnknown } from "@/lib/server/http";
import { createConversation, listConversationSummaries } from "@/lib/server/neura";
import { applyUserSessionCookie, getUserSessionFromRequest } from "@/lib/server/user-session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const session = getUserSessionFromRequest(request);
    const response = NextResponse.json({
      conversations: await listConversationSummaries(session.userId),
    });
    return applyUserSessionCookie(response, session);
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to list conversations", 401);
  }
}

export async function POST(request: Request) {
  try {
    const session = getUserSessionFromRequest(request);
    const response = NextResponse.json(await createConversation(session.userId));
    return applyUserSessionCookie(response, session);
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to create conversation");
  }
}
