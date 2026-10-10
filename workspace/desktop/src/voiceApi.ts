import { nativeSelection, commandApproval } from "./nativeApi";
type ErrorBody = { error?: { message?: string } };

async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as ErrorBody;
    return body.error?.message || fallback;
  } catch {
    return fallback;
  }
}

export async function voiceControl(id: string, operation: 'end' | 'heartbeat', csrf: string): Promise<void> {
  const response = await fetch(`/api/voice/sessions/${encodeURIComponent(id)}/${operation}`, {
    method: 'POST', credentials: 'same-origin', keepalive: operation === 'end',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: '{}'
  });
  if (!response.ok) throw new Error('Voice session ended or access changed.');
}
export async function exchangeRealtimeOffer(sdp: string, signal?: AbortSignal, context?: string, csrf = '', model?: string): Promise<{ id: string; answer: string; maxSeconds: number }> {
  if (!context) throw new Error('Open a conversation before starting voice.');
  const chosen = nativeSelection();
  const channel = context.startsWith('team:') ? context.slice(5) : undefined;
  const response = await fetch('/api/voice/sessions', {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ requestId: crypto.randomUUID(), offer: sdp,
      ...(channel ? { channel } : { conversation: context, selection: chosen && { ...chosen, model: model || chosen.model }, approvalPolicy: commandApproval() }) }), signal
  });
  if (!response.ok) throw new Error(await errorMessage(response, 'Alshival voice is unavailable right now'));
  const result = await response.json() as { id: string; answer: string; maxSeconds: number };
  if (!result.answer?.startsWith('v=') || !result.id) throw new Error('Alshival voice returned an invalid response');
  return result;
}

export async function transcribeVoiceMemo(audio: Blob, signal?: AbortSignal): Promise<string> {
  const response = await fetch("/workspace/api/neura/transcriptions", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": audio.type || "audio/webm" },
    body: audio,
    signal,
  });
  if (!response.ok) throw new Error(await errorMessage(response, "Voice memo transcription failed"));
  const result = await response.json() as { text?: string };
  const text = result.text?.trim();
  if (!text) throw new Error("No speech was detected in the voice memo");
  return text;
}

export function supportedRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
}

export function voiceMemoExtension(mimeType: string): string {
  return mimeType.toLowerCase().startsWith("audio/mp4") ? "m4a" : "webm";
}
