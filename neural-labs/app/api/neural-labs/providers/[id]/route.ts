import { NextResponse } from "next/server";

import { jsonError } from "@/lib/server/http";
import { deleteProvider, saveProvider, setDefaultProvider } from "@/lib/server/store";
import type { ProviderDraft } from "@/lib/shared/types";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const payload = (await request.json()) as Record<string, unknown>;

    if (payload.makeDefault === true) {
      return NextResponse.json(await setDefaultProvider(id));
    }

    return NextResponse.json(
      await saveProvider(payload as unknown as ProviderDraft, id)
    );
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unable to update provider");
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    await deleteProvider(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unable to delete provider", 404);
  }
}
