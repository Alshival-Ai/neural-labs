import { createHmac } from "node:crypto";

const REALTIME_URL = "https://api.openai.com/v1/realtime/calls";
const TRANSCRIPTION_URL = "https://api.openai.com/v1/audio/transcriptions";
export const MAX_VOICE_MEMO_BYTES = 25 * 1024 * 1024;
export const MAX_REALTIME_SDP_BYTES = 100_000;

const AUDIO_EXTENSIONS = new Map([
  ["audio/webm", "webm"],
  ["audio/ogg", "ogg"],
  ["audio/mp4", "m4a"],
  ["audio/mpeg", "mp3"],
  ["audio/wav", "wav"],
  ["audio/x-wav", "wav"],
]);

export class VoiceError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "VoiceError";
    this.status = status;
    this.code = code;
  }
}

function cleanMimeType(value) {
  return String(value || "").split(";", 1)[0].trim().toLowerCase();
}

export function createVoiceService({
  apiKey = process.env.OPENAI_API_KEY,
  realtimeModel = process.env.NEURAL_LABS_REALTIME_MODEL || "gpt-realtime-2.1-mini",
  realtimeVoice = process.env.NEURAL_LABS_REALTIME_VOICE || "marin",
  transcriptionModel = process.env.NEURAL_LABS_TRANSCRIPTION_MODEL || "gpt-transcribe",
  safetySecret,
  fetchImpl = fetch,
} = {}) {
  const key = String(apiKey || "").trim();
  const secret = String(safetySecret || "neural-labs-voice");

  function headers(userId) {
    return {
      Authorization: `Bearer ${key}`,
      "OpenAI-Safety-Identifier": createHmac("sha256", secret).update(String(userId)).digest("hex"),
    };
  }

  function requireKey() {
    if (!key) {
      throw new VoiceError(503, "voice_not_configured", "Voice is not configured for Neural Labs yet");
    }
  }

  return {
    async createRealtimeCall({ offer, userId }) {
      requireKey();
      const sdp = String(offer || "");
      if (!sdp.startsWith("v=") || Buffer.byteLength(sdp) > MAX_REALTIME_SDP_BYTES) {
        throw new VoiceError(400, "invalid_webrtc_offer", "The WebRTC voice offer is invalid");
      }
      const session = {
        type: "realtime",
        model: realtimeModel,
        instructions: "You are Neura, the user's private voice assistant in Neural Labs. Speak naturally and concisely. Protect private workspace information and never imply that this voice call is shared with a team.",
        audio: { output: { voice: realtimeVoice } },
        max_output_tokens: 500,
      };
      const form = new FormData();
      form.set("sdp", new Blob([sdp], { type: "application/sdp" }), "offer.sdp");
      form.set("session", new Blob([JSON.stringify(session)], { type: "application/json" }), "session.json");
      let upstream;
      try {
        upstream = await fetchImpl(REALTIME_URL, {
          method: "POST",
          headers: headers(userId),
          body: form,
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        throw new VoiceError(503, "voice_provider_unavailable", "Neura voice is unavailable right now");
      }
      if (!upstream.ok) {
        throw new VoiceError(503, "voice_provider_unavailable", "Neura voice is unavailable right now");
      }
      const answer = await upstream.text();
      if (!answer.startsWith("v=")) {
        throw new VoiceError(502, "invalid_voice_response", "Neura voice returned an invalid response");
      }
      return answer;
    },

    async transcribeVoiceMemo({ bytes, mimeType, userId }) {
      requireKey();
      if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
        throw new VoiceError(400, "empty_voice_memo", "The voice memo is empty");
      }
      if (bytes.length > MAX_VOICE_MEMO_BYTES) {
        throw new VoiceError(413, "voice_memo_too_large", "Voice memos must be 25 MB or smaller");
      }
      const normalizedType = cleanMimeType(mimeType);
      const extension = AUDIO_EXTENSIONS.get(normalizedType);
      if (!extension) {
        throw new VoiceError(415, "unsupported_voice_memo", "This voice memo format is not supported");
      }
      const form = new FormData();
      form.set("file", new Blob([bytes], { type: normalizedType }), `voice-memo.${extension}`);
      form.set("model", transcriptionModel);
      let upstream;
      try {
        upstream = await fetchImpl(TRANSCRIPTION_URL, {
          method: "POST",
          headers: headers(userId),
          body: form,
          signal: AbortSignal.timeout(90_000),
        });
      } catch {
        throw new VoiceError(503, "transcription_unavailable", "Voice memo transcription is unavailable right now");
      }
      if (!upstream.ok) {
        throw new VoiceError(503, "transcription_unavailable", "Voice memo transcription is unavailable right now");
      }
      const result = await upstream.json().catch(() => ({}));
      const text = typeof result?.text === "string" ? result.text.trim() : "";
      if (!text) {
        throw new VoiceError(422, "empty_transcription", "No speech was detected in the voice memo");
      }
      return text;
    },
  };
}
