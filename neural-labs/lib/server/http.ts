import { NextResponse } from "next/server";

import type { ApiErrorPayload } from "@/lib/shared/types";

export function jsonError(message: string, status = 400) {
  return NextResponse.json<ApiErrorPayload>({ error: message }, { status });
}
