export async function projectApi<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const csrf =
    document.cookie
      .split(";")
      .map((value) => value.trim())
      .find((value) => value.startsWith("neural-labs-csrf="))
      ?.split("=")
      .slice(1)
      .join("=") ?? "";
  const response = await fetch(`/api/projects${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": decodeURIComponent(csrf),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 204) return undefined as T;
  const value = await response.json().catch(() => null);
  if (!response.ok || value === null)
    throw new Error(
      value?.error?.message ??
        "Project service is unavailable. Your changes have not been discarded.",
    );
  return value;
}
