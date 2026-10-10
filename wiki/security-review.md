# Code-scanning review

The October 2026 review covers control-plane request throttling, browser
attachments, MiniPaint, editor syntax highlighting, and credential hashing.
Source publication does not upgrade existing instances; use the normal managed
update procedure for each requested workspace.

## Request limits

The control plane applies IP-based, in-memory, one-minute flood limits before
body parsing and database work: 1,200 ordinary requests, 120 authentication/setup
requests, and a separate 6,000-request internal budget for runtime polling.
IPv6 addresses are grouped by /56. Responses use HTTP 429 and `Retry-After`.
Static control assets bypass the ordinary budget. Existing persistent per-user
and per-action limits remain in effect. Voice session starts additionally allow
six attempts per member per minute; heartbeat and end operations do not consume
that start budget.

These coarse budgets are per process, reset on restart, and are shared by
clients behind the same NAT. They are not a distributed quota. Deployments with
multiple control-plane replicas need shared ingress throttling. Keep the
control-plane listener private and let the immediate trusted ingress set
forwarding headers. Only that first private proxy hop is trusted; earlier
client-supplied forwarding entries cannot select a rate-limit identity.

## Content and cryptography

Attachment API requests remain on the current origin under `/workspace/api/`
and reject redirects. Media previews allow authenticated file/artifact routes,
same-origin blob URLs, and base64 raster/audio/video data. Inline HTML/SVG data
is rejected. Source attribution intentionally opens external HTTP(S) publishers
in a new tab with no opener access; it is never an authenticated fetch target.
MiniPaint treats settings and translations as text. The editor's quoted-string
patterns use disjoint escape alternatives to avoid exponential backtracking.

Email verification codes use a domain-separated HMAC-SHA256 with the instance
master key, plus the existing expiry, attempt limits and one-time consumption.
A pending code created before this change must be requested again after upgrade;
verified addresses remain verified. OAuth state uses SHA-256 of a random 256-bit
token, not password hashing. Local passwords continue to use Argon2.

Microsoft certificate assertions use PS256 and `x5t#S256`, following
[Microsoft's certificate assertion format](https://learn.microsoft.com/en-us/entra/identity-platform/certificate-credentials).
TURN credentials retain HMAC-SHA1 for compatibility with
[coturn's REST authentication protocol](https://github.com/coturn/coturn/blob/master/README.turnserver).
The SHA-1 collision weakness does not justify substituting an incompatible
algorithm into that keyed protocol. Credentials remain short-lived and signed
with the configured secret. Its regression test necessarily uses the same HMAC.

## Reviewing remaining findings

Do not disable a query or dismiss a group of alerts just to obtain a clean scan.
Check each reported source-to-sink path against the latest analyzed commit.
Useful evidence includes `control-plane/test/views.test.ts` (all reflected setup
fields escaped), `workspace/desktop/src/attachmentUrls.test.ts` (URL allowlists
and rejected fetches), `tests/minipaint_security_test.mjs` (DOM injection), and
the voice/database, certificate-signature and forwarding-chain tests.

In particular, a high-entropy OAuth state is not a human password; TURN's keyed
protocol MAC is not an unkeyed integrity hash; a browser-only fetch is not a
server-side request; and a deliberately external attribution link is not an
unvalidated application redirect. Any false-positive disposition must record
that specific reasoning, checked code and regression evidence. Source fixes and
local tests do not by themselves prove that GitHub's next scan has closed an
alert.
