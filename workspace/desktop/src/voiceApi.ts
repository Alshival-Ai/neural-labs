type ErrorBody = { error?: { message?: string } };

async function errorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as ErrorBody;
    return body.error?.message || fallback;
  } catch {
    return fallback;
  }
}

export async function exchangeRealtimeOffer(sdp: string): Promise<{ answer: string; maxSeconds: number }> {
  const response = await fetch("/workspace/api/neura/realtime/call", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/sdp" },
    body: sdp,
  });
  if (!response.ok) throw new Error(await errorMessage(response, "Neura voice is unavailable right now"));
  const answer = await response.text();
  if (!answer.startsWith("v=")) throw new Error("Neura voice returned an invalid response");
  const configuredSeconds = Number(response.headers.get("X-Neural-Labs-Voice-Max-Seconds"));
  return { answer, maxSeconds: Number.isFinite(configuredSeconds) && configuredSeconds > 0 ? configuredSeconds : 300 };
}

export async function transcribeVoiceMemo(audio: Blob): Promise<string> {
  const response = await fetch("/workspace/api/neura/transcriptions", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": audio.type || "audio/webm" },
    body: audio,
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
