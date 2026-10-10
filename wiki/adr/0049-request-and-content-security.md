# ADR 0049: Bound request work and attachment destinations

Status: accepted

The CodeQL review exposed missing coarse request throttling and HTML sinks in
bundled image-editor settings. Request authentication alone does not bound the
work an unauthenticated caller can trigger. Browser attachment metadata must
also remain separate from authority to fetch arbitrary destinations.

Apply Express rate limiting before body parsers and database-dependent gates,
with separate internal and authentication budgets. Preserve durable actor/action
quotas. Trust only the immediate private ingress hop for the client address;
do not recursively trust attacker-controlled forwarding entries. This narrows
the proxy trust boundary without changing workspace membership or permissions.
Use the patched proxy-address parser.

Validate attachment destinations centrally, prohibit authenticated API redirects,
and keep publisher attribution separate. Render mutable MiniPaint settings and
translation strings as text; retain only the static panel template as HTML.
Use disjoint string-token alternatives in syntax highlighting.

Protect low-entropy email codes with a domain-separated server-keyed MAC.
Use Microsoft's current certificate assertion format. Preserve protocol-required
TURN HMAC-SHA1 and document its scope instead of changing the algorithm blindly.

See [Code-scanning review](../security-review.md) for budgets, operational
limitations, compatibility and alert-triage evidence. No runtime update or
provider binary change is implied by this source change.
