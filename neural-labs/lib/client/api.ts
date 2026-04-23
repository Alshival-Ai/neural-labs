import type {
  ConversationRecord,
  DirectoryListing,
  ProviderDraft,
  ProviderRecord,
  SettingsSnapshot,
  TerminalSessionSummary,
  TerminalStatus,
} from "@/lib/shared/types";

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = "Request failed";
    try {
      const payload = (await response.json()) as { error?: string };
      message = payload.error || message;
    } catch {
      message = await response.text();
    }
    throw new Error(message || "Request failed");
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function fetchSettings(): Promise<SettingsSnapshot> {
  return parseResponse(await fetch("/api/neural-labs/settings"));
}

export async function saveDesktopSettings(payload: {
  theme?: "dark" | "light" | "system";
  backgroundId?: string;
  customBackgroundPath?: string | null;
}) {
  return parseResponse(
    await fetch("/api/neural-labs/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  );
}

export async function listProviders(): Promise<ProviderRecord[]> {
  return parseResponse(await fetch("/api/neural-labs/providers"));
}

export async function createProvider(payload: ProviderDraft): Promise<ProviderRecord> {
  return parseResponse(
    await fetch("/api/neural-labs/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  );
}

export async function updateProvider(
  providerId: string,
  payload: Partial<ProviderDraft> & { makeDefault?: boolean }
): Promise<ProviderRecord> {
  return parseResponse(
    await fetch(`/api/neural-labs/providers/${providerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  );
}

export async function removeProvider(providerId: string): Promise<void> {
  await parseResponse(
    await fetch(`/api/neural-labs/providers/${providerId}`, {
      method: "DELETE",
    })
  );
}

export async function testProvider(providerId: string): Promise<{ ok: true; message: string }> {
  return parseResponse(
    await fetch("/api/neural-labs/providers/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId }),
    })
  );
}

export async function listFiles(path = ""): Promise<DirectoryListing> {
  const url = new URL("/api/neural-labs/files", window.location.origin);
  url.searchParams.set("path", path);
  return parseResponse(await fetch(url));
}

export async function readTextFile(path: string): Promise<string> {
  const url = new URL("/api/neural-labs/files/content", window.location.origin);
  url.searchParams.set("path", path);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.text();
}

export function getFileUrl(path: string): string {
  const url = new URL("/api/neural-labs/files/content", window.location.origin);
  url.searchParams.set("path", path);
  return url.toString();
}

export async function saveTextFile(path: string, content: string): Promise<{ path: string }> {
  return parseResponse(
    await fetch("/api/neural-labs/files/content", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
    })
  );
}

export async function uploadFile(parentPath: string, file: File): Promise<{ path: string }> {
  const formData = new FormData();
  formData.set("path", parentPath);
  formData.set("file", file);
  return parseResponse(
    await fetch("/api/neural-labs/files/upload", {
      method: "POST",
      body: formData,
    })
  );
}

export async function setDesktopBackgroundFromFile(path: string): Promise<{ path: string }> {
  return parseResponse(
    await fetch("/api/neural-labs/files/background/from-file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    })
  );
}

export async function createDirectory(parentPath: string, name: string): Promise<{ path: string }> {
  return parseResponse(
    await fetch("/api/neural-labs/files/directory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentPath, name }),
    })
  );
}

export async function renamePath(path: string, name: string): Promise<{ path: string }> {
  return parseResponse(
    await fetch("/api/neural-labs/files/rename", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, name }),
    })
  );
}

export async function movePath(
  path: string,
  destinationParentPath: string,
  name?: string
): Promise<{ path: string }> {
  return parseResponse(
    await fetch("/api/neural-labs/files/move", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, destinationParentPath, name }),
    })
  );
}

export async function deletePath(path: string): Promise<void> {
  const url = new URL("/api/neural-labs/files", window.location.origin);
  url.searchParams.set("path", path);
  await parseResponse(
    await fetch(url, {
      method: "DELETE",
    })
  );
}

export async function listConversations() {
  return parseResponse<{ conversations: Array<{ id: string; title: string; model: string; createdAt: string; updatedAt: string }> }>(
    await fetch("/api/neural-labs/neura/conversations")
  );
}

export async function createConversation(): Promise<ConversationRecord> {
  return parseResponse(
    await fetch("/api/neural-labs/neura/conversations", {
      method: "POST",
    })
  );
}

export async function getConversation(conversationId: string): Promise<ConversationRecord> {
  return parseResponse(
    await fetch(`/api/neural-labs/neura/conversations/${conversationId}`)
  );
}

export async function deleteConversation(conversationId: string): Promise<void> {
  await parseResponse(
    await fetch(`/api/neural-labs/neura/conversations/${conversationId}`, {
      method: "DELETE",
    })
  );
}

export async function sendMessage(
  conversationId: string,
  content: string
): Promise<ConversationRecord> {
  return parseResponse(
    await fetch(`/api/neural-labs/neura/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    })
  );
}

export async function fetchNeuraConfig() {
  return parseResponse<{ assistantName: string; defaultModel: string; defaultProviderName: string | null }>(
    await fetch("/api/neural-labs/neura/config")
  );
}

export async function listTerminalSessions(): Promise<{ sessions: TerminalSessionSummary[] }> {
  return parseResponse(await fetch("/api/neural-labs/terminal/sessions"));
}

export async function createTerminalSession(): Promise<TerminalSessionSummary> {
  return parseResponse(
    await fetch("/api/neural-labs/terminal/sessions", { method: "POST" })
  );
}

export async function getTerminalStatus(sessionId: string): Promise<TerminalStatus> {
  return parseResponse(await fetch(`/api/neural-labs/terminal/sessions/${sessionId}`));
}

export async function closeTerminalSession(sessionId: string): Promise<void> {
  await parseResponse(
    await fetch(`/api/neural-labs/terminal/sessions/${sessionId}`, {
      method: "DELETE",
    })
  );
}

export async function writeTerminalInput(sessionId: string, data: string): Promise<void> {
  await parseResponse(
    await fetch(`/api/neural-labs/terminal/sessions/${sessionId}/input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data }),
    })
  );
}
