import { NextResponse } from "next/server";

import type { ApiErrorPayload } from "@/lib/shared/types";
import { AuthError } from "@/lib/server/auth";

export function jsonError(message: string, status = 400) {
  return NextResponse.json<ApiErrorPayload>({ error: message }, { status });
}

export function jsonErrorFromUnknown(
  error: unknown,
  fallbackMessage: string,
  fallbackStatus = 400
) {
  if (error instanceof AuthError) {
    return jsonError(error.message, error.status);
  }

  if (error instanceof Error) {
    return jsonError(error.message, fallbackStatus);
  }

  return jsonError(fallbackMessage, fallbackStatus);
}
