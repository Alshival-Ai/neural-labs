# ADR 0019: Scope Neura voice by private and team chat boundaries

- Status: Accepted
- Date: 2026-09-04

## Context

Neura needs voice input in two different privacy scopes. A private chat calls
for a low-latency, two-way assistant conversation, while a Team Chat needs a
durable voice memo that teammates can replay and that Neura can understand.
Giving a browser a standard provider API key, treating a memo as a live team
call, or keeping a transcript outside channel history would violate those
boundaries.

## Decision

Private voice uses WebRTC between the authenticated browser and OpenAI
Realtime. The workspace server accepts a same-origin SDP offer, adds a bounded
server-owned Neura session configuration, exchanges it at the fixed OpenAI
endpoint with `OPENAI_API_KEY`, and returns only the SDP answer. It does not
relay live audio or return the key. Sessions are capped at five minutes.

Team voice uses `MediaRecorder`. The authenticated browser posts a supported
audio blob of at most 25 MB to a same-origin transcription endpoint. The
workspace server sends it to the fixed OpenAI transcription endpoint. After a
successful transcription, the browser uploads the original memo to the shared
`team-uploads/` folder and posts both the attachment and visible transcript to
the originating channel as an `@Neura` turn. Existing channel membership and
agent-run authorization remain authoritative.

The workspace derives an HMAC safety identifier from the stable Neural Labs
user ID and an existing server secret. The raw user ID and provider errors are
not forwarded to the client, and the provider key remains only in the ignored
deployment environment.

## Consequences

- Private audio flows directly over the negotiated WebRTC session; only SDP
  crosses the Neural Labs server.
- Team memo audio is disclosed to OpenAI for transcription and stored in the
  shared workspace, whose file tree is intentionally not a per-channel ACL.
- Team transcripts are durable channel history and ordinary bounded Neura
  context, making the automated invocation visible to teammates.
- Voice fails closed until an operator configures `OPENAI_API_KEY`; personal
  ChatGPT OAuth remains isolated and is not repurposed for Realtime or
  transcription API calls.
