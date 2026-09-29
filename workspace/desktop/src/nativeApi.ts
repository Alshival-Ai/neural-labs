import { settingsRequest } from "./settingsApi";
export type NativeSelection = { connection: string; model: string };
export type NativeConnection = { id: string; scope: "personal" | "shared" | "team" | "background";
  provider: "codex" | "claude"; method: "subscription" | "api-key"; label: string; enabled: boolean; generation: number };
let currentActor: string | undefined;
let csrfToken = "";
export function configureNativeActor(actor: string, csrf: string) { currentActor = actor; csrfToken = csrf; }
export function nativeSelection(): NativeSelection | undefined {
  if (!currentActor) return undefined;
  try {
    const selected = JSON.parse(localStorage.getItem(`neural-labs.native-selection.${currentActor}`) || "null");
    if (selected && typeof selected.connection === "string" && typeof selected.model === "string" && selected.model) return selected;
  } catch { /* A missing or invalid selection requires explicit user choice. */ }
  return undefined;
}
export function selectNativeConnection(selection: NativeSelection) {
  if (!currentActor) throw new Error("Sign in to select an AI connection");
  localStorage.setItem(`neural-labs.native-selection.${currentActor}`, JSON.stringify(selection));
  window.dispatchEvent(new Event("neural-labs-native-selection"));
}
export async function nativeRequest<T>(operation: string, params: Record<string, unknown> = {}, selection = nativeSelection(), signal?: AbortSignal): Promise<T> {
  if (!selection) throw new Error("Select your AI connection in Settings → Model Provider");
  return settingsRequest<T>("/api/runtime/request", { method: "POST", headers: { "X-CSRF-Token": csrfToken },
    body: JSON.stringify({ operation, selection, params }), signal });
}
export type NativeEvent = { id: number; turn_id: string; type: string; payload: Record<string, unknown> };
