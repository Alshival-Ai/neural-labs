import assert from "node:assert/strict";
import test from "node:test";

import { VoiceError, createVoiceService } from "./voice.mjs";

test("fails closed when the server-side OpenAI key is absent", async () => {
  const service = createVoiceService({ apiKey: "", safetySecret: "test-secret" });
  await assert.rejects(
    service.createRealtimeCall({ offer: "v=0\r\n", userId: "user-1" }),
    (error) => error instanceof VoiceError && error.status === 503 && error.code === "voice_not_configured",
  );
});

test("exchanges SDP using a server-only key and constrained realtime session", async () => {
  let request;
  const service = createVoiceService({
    apiKey: "test-only-key",
    safetySecret: "test-secret",
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response("v=0\r\no=answer\r\n", { status: 201, headers: { "Content-Type": "application/sdp" } });
    },
  });
  const answer = await service.createRealtimeCall({ offer: "v=0\r\no=offer\r\n", userId: "user-1" });
  assert.equal(answer, "v=0\r\no=answer\r\n");
  assert.equal(request.url, "https://api.openai.com/v1/realtime/calls");
  assert.equal(request.init.headers.Authorization, "Bearer test-only-key");
  assert.equal(request.init.headers["OpenAI-Safety-Identifier"].length, 64);
  assert.equal(await request.init.body.get("sdp").text(), "v=0\r\no=offer\r\n");
  const session = JSON.parse(await request.init.body.get("session").text());
  assert.equal(session.type, "realtime");
  assert.equal(session.model, "gpt-realtime-2.1-mini");
  assert.equal(session.audio.output.voice, "marin");
});

test("transcribes a bounded supported audio memo", async () => {
  let request;
  const service = createVoiceService({
    apiKey: "test-only-key",
    transcriptionModel: "gpt-transcribe",
    safetySecret: "test-secret",
    fetchImpl: async (url, init) => {
      request = { url, init };
      return Response.json({ text: "  Team update from the memo.  " });
    },
  });
  const text = await service.transcribeVoiceMemo({ bytes: Buffer.from("audio"), mimeType: "audio/webm;codecs=opus", userId: "user-2" });
  assert.equal(text, "Team update from the memo.");
  assert.equal(request.url, "https://api.openai.com/v1/audio/transcriptions");
  assert.equal(request.init.body.get("model"), "gpt-transcribe");
  assert.equal(request.init.body.get("file").type, "audio/webm");
});

test("rejects unsupported audio before contacting the provider", async () => {
  const service = createVoiceService({ apiKey: "test-only-key", safetySecret: "test-secret" });
  await assert.rejects(
    service.transcribeVoiceMemo({ bytes: Buffer.from("audio"), mimeType: "application/octet-stream", userId: "user-2" }),
    (error) => error instanceof VoiceError && error.status === 415,
  );
});
