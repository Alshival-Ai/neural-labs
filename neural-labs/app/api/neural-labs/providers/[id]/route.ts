import { NextResponse } from "next/server";

import { jsonErrorFromUnknown } from "@/lib/server/http";
import { deleteProvider, saveProvider, setDefaultProvider } from "@/lib/server/store";
import type { ProviderDraft } from "@/lib/shared/types";
import { applyUserSessionCookie, getUserSessionFromRequest } from "@/lib/server/user-session";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = getUserSessionFromRequest(request);
    const { id } = await context.params;
    const payload = (await request.json()) as Record<string, unknown>;

    if (payload.makeDefault === true) {
      return applyUserSessionCookie(
        NextResponse.json(await setDefaultProvider(session.userId, id)),
        session
      );
    }

    return applyUserSessionCookie(
      NextResponse.json(
        await saveProvider(session.userId, payload as unknown as ProviderDraft, id)
      ),
      session
    );
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to update provider");
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = getUserSessionFromRequest(request);
    const { id } = await context.params;
    await deleteProvider(session.userId, id);
    return applyUserSessionCookie(new NextResponse(null, { status: 204 }), session);
  } catch (error) {
    return jsonErrorFromUnknown(error, "Unable to delete provider", 404);
  }
}
