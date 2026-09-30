import { settingsRequest } from "./settingsApi";
export type NativeSelection = { connection: string; model: string };
export type NativeConnection = { id: string; scope: "personal" | "shared" | "team" | "background";
  provider: "codex" | "claude"; method: "subscription" | "api-key"; label: string; enabled: boolean; generation: number };
let currentActor: string | undefined;
let csrfToken = "";
export type CommandApproval = "on-request" | "never";
export function commandApproval(): CommandApproval {
  if (!currentActor) return "on-request";
  try { return localStorage.getItem(`neural-labs.command-approval.${currentActor}`) === "never" ? "never" : "on-request"; }
  catch { return "on-request"; }
}
export function selectCommandApproval(value: CommandApproval) {
  if (!currentActor || !["on-request", "never"].includes(value)) throw new Error("Sign in to change command approvals");
  localStorage.setItem(`neural-labs.command-approval.${currentActor}`, value);
  window.dispatchEvent(new Event("neural-labs-command-approval"));
}

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
export async function loadNativeDefault() {
  if (!currentActor) return;
  const actor = currentActor;
  const result = await settingsRequest<{ selection: (NativeSelection & { generation: number }) | null }>("/api/runtime/defaults",
    { signal: AbortSignal.timeout(5000) });
  if (actor !== currentActor || !result.selection) return;
  const { connection, model } = result.selection;
  if (typeof connection === "string" && typeof model === "string" && model)
    selectNativeConnection({ connection, model });
}
export async function saveNativeDefault(selection: NativeSelection, generation: number, team = false) {
  if (!currentActor) throw new Error("Sign in to select an AI connection");
  const route = team ? "/api/admin/runtime/team-defaults" : "/api/runtime/defaults";
  const current = await settingsRequest<{ revision: number }>(route);
  if (!Number.isSafeInteger(current.revision) || current.revision < 0) throw new Error("The saved AI selection is unavailable");
  return settingsRequest<{ revision: number }>(route, { method: "PUT", headers: { "X-CSRF-Token": csrfToken },
    body: JSON.stringify({ ...selection, generation, revision: current.revision }) });
}
export async function nativeRequest<T>(operation: string, params: Record<string, unknown> = {}, selection = nativeSelection(), signal?: AbortSignal): Promise<T> {
  if (!selection) throw new Error("Select your AI connection in Settings → Model Provider");
  return settingsRequest<T>("/api/runtime/request", { method: "POST", headers: { "X-CSRF-Token": csrfToken },
    body: JSON.stringify({ operation, selection, params, ...(operation === "turns.start" ? { approvalPolicy: commandApproval() } : {}) }), signal });
}
export type NativeEvent = { id: number; turn_id: string; type: string; payload: Record<string, unknown> };

let reconnectTarget: { connection?: string; team: boolean } | undefined;
export function requestAnthropicReconnect(team = false) {
  reconnectTarget = { connection: team ? undefined : nativeSelection()?.connection, team };
  window.dispatchEvent(new CustomEvent('neural-labs-reconnect-anthropic'));
}
export function takeAnthropicReconnect() {
  const target = reconnectTarget; reconnectTarget = undefined; return target;
}
