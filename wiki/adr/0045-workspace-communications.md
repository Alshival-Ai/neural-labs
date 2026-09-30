# ADR 0045: Workspace email and SMS through native agents

- Status: Accepted
- Supersedes the OpenClaw ingress design in ADR 0024

Settings → Plugins owns a single Gmail/Outlook mailbox and Twilio number per
workspace. The control plane owns encrypted provider credentials, OAuth state,
verified recipient resolution, durable message admission, and an outbox. Native
Codex/Claude execute messages using an explicitly selected workspace account.
No provider credential or arbitrary-recipient send API is exposed to agents.

OAuth requests bind a single-use state and PKCE verifier to the initiating
administrator's session, connector revision, and exact callback. Completion
rechecks active administrator access. Twilio callbacks require HMAC signatures,
account/number binding, and unique provider message IDs. Email requires a matching
verified member address and receiving-provider authentication results. Mailbox
connection baselines prior mail rather than processing the backlog.

Each execution is bound to member, message, connection generation, workspace
membership, and connector revision. Revocation is checked on admission, during
execution, and before delivery. Native homes copy only the selected provider's
authentication file into a per-message home; other members' CLI histories are
not mounted. Workspace files remain shared under the existing sandbox boundary.

A PostgreSQL advisory lock serializes worker passes; message and outbox records
survive restarts. Provider acceptance and interrupted admission are distinguished
from confirmed failure. Uncertain operations are retained for review, never
blindly replayed. Early or reordered SMS callbacks are reconciled against the
bound recipient and cannot regress terminal delivery status.

The public hosted proxy exposes only exact callback routes; it strips portal
identity/cookies from Twilio requests and forwards the signature for verification
in the control plane. App publication policy does not grant or revoke connector
ingress. OAuth completion still requires the stored administrator authority.

See [Email and SMS connectors](../connectors.md) for setup and limitations.
