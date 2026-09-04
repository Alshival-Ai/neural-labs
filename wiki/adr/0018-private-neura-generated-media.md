# ADR 0018: Relay generated Neura media with short-lived capabilities

- Status: Accepted
- Date: 2026-09-03

## Context

OpenClaw persists generated images outside the shared workspace and represents
them in assistant messages with an internal Gateway URL under
`/api/chat/media/outgoing/`. The Neural Labs desktop previously rendered that
relative URL against the public control-plane origin. Images therefore appeared
broken, and opening a card reached an unrelated API path that returned `404`.

Publishing the Gateway HTTP media tree or copying its private state into a
public file route would broaden the workspace trust boundary. Generated media
must remain attached to the authorized Neura conversation and must not become a
stable public URL.

## Decision

Preserve OpenClaw artifact identifiers in the desktop message projection. Use
the already authenticated, user-scoped Neura WebSocket to call
`artifacts.download`; OpenClaw then authorizes session access and returns either
inline bytes or a short-lived, session-and-attachment-bound media ticket.

For ticketed media, rewrite only the exact OpenClaw outgoing-media route to an
authenticated same-origin workspace route. The workspace server accepts only
GET and HEAD, a strict outgoing-media path, and a syntactically valid
`mediaTicket`. It relays the request only to the fixed loopback Gateway origin,
does not forward browser credentials or identity as Gateway credentials, does
not follow redirects, and returns media with private, no-store caching and
content sniffing disabled. Unticketed internal Gateway paths are never rendered
as clickable URLs.

## Consequences

- Generated images render in Neura without exposing a new public Gateway
  surface or a stable public file URL.
- Session authorization happens before ticket issuance on the authenticated
  WebSocket; the relay cannot mint or widen access.
- Media capabilities expire according to OpenClaw policy and are refreshed when
  the conversation history is loaded again.
- The relay cannot be used as a general-purpose proxy because its upstream host,
  path shape, query key, methods, redirects, and response media types are all
  constrained.
