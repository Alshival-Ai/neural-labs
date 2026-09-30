# Native automation policies and event producers

## Decision

The native SQLite scheduler owns durable failure streaks, cooldown decisions,
delayed occurrences, supervised source generations and event receipts. Provider
execution remains bound to the saved workspace member/account and live authority.
Process/stream events are accepted only from the in-process supervisor's persisted
receipts. There is no browser or public callback endpoint for creating events.

Source commands use the existing Bubblewrap launcher, a credential-free home,
workspace-only working directory, and the existing public-egress/private-network
boundary. Revocation and maintenance stop those children. Unknown process outcomes
are retained for review. Streams use bounded buffering and queues, with a visible
hold on overflow. Light-context AI runs use a fresh authentication-only home and
explicit skill selections and their declared supporting packages; workspace
instructions continue to apply. Supporting skill names resolve through the same
member/scope-filtered catalog, enabled-state checks and immutable snapshot path.
Declarations cannot grant filesystem access or enable a disabled package. See
[Skill dependencies](../skills.md#skill-dependencies).

PostgreSQL connector messages reference notification events. Stable handoff keys
prevent duplicated sends across crashes, and external delivery rechecks current
subscriptions immediately before provider admission. Provider uncertainty stays
in the connector outbox. No legacy application-mail or direct SMS fallback remains.

## Compatibility and release

SQLite schema 8 and PostgreSQL migration 25 add state without rewriting historical
receipts, subscriptions, credentials, or imported definitions. Held jobs require
explicit review. Unsupported legacy policies remain held rather than being
silently dropped. Operator releases do not certify automatic migration baselines.
See [Automations](../automations.md) for the supported capability table.
