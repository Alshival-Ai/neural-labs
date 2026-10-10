# ADR 0048: Bind live voice to the existing conversation agent

- Status: Accepted
- Date: 2026-10-10
- Amends: [Voice scope](0019-neura-openai-voice.md) and [audio credentials](0032-audio-only-workspace-api-key.md)

OpenAI Realtime handles microphone input and spoken output over WebRTC. A
server-side connection handles events and delegates each transcribed request to
the conversation's existing agent. Private conversations keep their selected
personal connection, model override and command approval policy. Shared channels
keep their explicitly configured Team connection. Voice cannot approve tools or
silently substitute a different provider when that connection is unavailable.

The control plane binds a durable, five-minute voice session to the authenticated
session, actor and conversation/channel. It revalidates access, maintenance state
and an optional admission policy throughout the call. Provider events and request
identifiers prevent duplicate task execution; unknown outcomes require inspecting
existing history, never automatic re-execution. The runtime keeps audio keys out
of browser responses and native agent environments. Voice sessions count as active
work for managed upgrade admission.

User transcripts and agent replies remain in their original history store. Spoken
renderings and provider usage are retained in voice session events; raw call audio
is not retained. Ending audio leaves accepted agent work and its approval cards
intact. Browser disconnects stop renewal; server expiry and hangup end the call.

The optional managed admission adapter owns entitlement and allowance decisions
outside base Neural Labs. Standalone installations use their operator-configured
audio key without importing commercial plan rules. The old unbound native voice
endpoint is retired; callers use conversation-bound sessions instead.

Shared channels retain their voice-memo button and add **Talk to Alshival**.
Call audio is local to the caller; transcripts and task results are visible to
channel members. This is not a multi-party voice room.
