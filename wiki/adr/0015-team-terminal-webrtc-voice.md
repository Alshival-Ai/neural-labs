# ADR 0015: WebRTC Team Terminal voice

## Context

Team Terminals already provide an authenticated, same-origin WebSocket per
viewer and expose an ephemeral connection ID inside one shared terminal
session. Voice chat needs peer discovery and WebRTC signaling, but microphone
audio must not become terminal output, server state, or another long-lived
workspace data stream.

Microphone capture changes the browser trust boundary. The public site denies
microphone access by default, while the authenticated workspace needs to request
it only after a deliberate user action. Team Terminal users also need a safe
listen-only default and a local preference for muted, open-mic, or push-to-talk
operation.

## Decision

Use a peer-to-peer WebRTC audio mesh for Team Terminal voice rooms. The existing
terminal WebSocket relays only bounded session descriptions and ICE candidates
between authenticated connection IDs in the same Team Terminal. It also
broadcasts ephemeral voice presence and microphone mode. Signaling is never
stored, logged as terminal content, or replayed after disconnect.

Voice participation is explicit and defaults to muted. Joining while muted does
not request microphone access. Open mic and push to talk request an audio-only
stream with echo cancellation, noise suppression, and automatic gain control.
The browser track remains disabled while muted, while push to talk is not held,
or while the signaling socket is disconnected. Leaving voice stops every local
track and closes every peer connection. The selected mode is device-local
presentation state; it is not an account setting.

Limit a room to eight connected browser devices. The workspace server validates
signal shape and size, verifies that sender and recipient both joined voice in
the same Team Terminal, and never receives media. Nginx grants microphone access
only to the authenticated same-origin workspace and continues to deny camera,
geolocation, payment, and USB capabilities.

Prefer direct ICE connectivity and fall back to a self-hosted coturn relay.
Coturn uses its REST shared-secret mechanism: the shared secret remains in the
mode-0600 deployment environment and is injected only into coturn and the
control plane, neither of which exposes a developer shell. Coturn's entrypoint
writes it to a private tmpfs configuration. The workspace requests one-hour
HMAC credentials with pseudonymous user keys from a control-token-protected
internal control-plane endpoint when a participant joins voice. The browser and
shared workspace never receive the secret or a reusable account password.

The relay runs without a database, administrative CLI, TLS listener, TCP peer
relay, or access to loopback, private, carrier-NAT, link-local, and multicast
peer ranges. Per-allocation bandwidth, user allocation, global allocation, and
total bandwidth quotas constrain misuse. TURN listens publicly on TCP and UDP;
the narrow UDP relay range is an explicit deployment boundary because WebRTC
media cannot be reverse-proxied through the HTTP-only nginx path.

## Consequences

- Audio is encrypted by the browser's WebRTC stack and does not traverse or
  persist in the Neural Labs workspace service.
- A user must click **Join voice** before receiving audio, and must explicitly
  choose a transmitting mode before the microphone is requested.
- Multiple browser devices owned by one user are separate peers but display as
  one person count in the room UI.
- Mesh bandwidth grows with each participant, so the eight-device cap is part of
  the product boundary rather than only a defensive server limit.
- Closing the Team Terminal pane leaves voice. During a terminal-socket
  disconnect, media paths close and the microphone is disabled; an intended
  voice room is re-established only after the authenticated socket reconnects.
  The shared PTY itself continues under the existing lifecycle rules.
- Routed or remote networks can use the relay when direct ICE fails. The public
  router and firewall must forward the configured listener and relay ports.
