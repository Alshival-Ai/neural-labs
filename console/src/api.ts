import type { ApiErrorPayload } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = "request_failed",
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  const payload = (await response.json().catch(() => undefined)) as T | ApiErrorPayload | undefined;
  if (!response.ok) {
    const error = payload as ApiErrorPayload | undefined;
    throw new ApiError(
      error?.error?.message ?? `Request failed with HTTP ${response.status}`,
      response.status,
      error?.error?.code,
    );
  }
  return payload as T;
}

export function mutationHeaders(csrfToken: string): HeadersInit {
  return { "X-CSRF-Token": csrfToken };
}
