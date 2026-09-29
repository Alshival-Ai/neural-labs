# ADR 0037: Alshival-managed identity and deployment

Status: accepted for implementation; production admission requires deployment acceptance.

## Context

The full Neural Labs desktop is reused by Alshival workspace hosting. Alshival
owns membership, roles, sign-in, service coverage, placement, and runtime cleanup.
Standalone installations continue to own their local identity and configuration.

## Decision

`NEURAL_LABS_AUTH_MODE` defaults to `standalone`. The `alshival` adapter requires
an HTTPS portal origin, immutable workspace/instance UUIDs, and a private signing
secret available only to the control plane. PostgreSQL records the identity
binding. Ordinary startup refuses switching authorities or importing a standalone
account database. An explicit offline operator adoption can preserve native user
IDs when an existing installation joins a portal. It requires a complete,
one-to-one subject-to-UUID mapping with expected emails, a previously bound
standalone authority, no existing managed identities, and current membership in
the target portal. The operation is transactional, defaults to rollback, and
invalidates old sessions. It never links an account by email during sign-in.
Login, session authorization and imported historical authors resolve the stored
issuer/workspace/subject binding before deriving IDs for new users.

Visitors enter through the portal. A member's explicit launch posts a one-use,
60-second handoff to the workspace origin. The control plane redeems it through
an HMAC-authenticated protocol. Session grants are encrypted in PostgreSQL, never
put into URLs or the workspace container. Every authenticated request checks the
portal login, live membership, role, coverage, and runtime generation. Browser
WebSockets also require repeated authorization at the platform ingress.

Managed users cannot configure local signup, passwords, passkeys, Entra identity,
users, or the standalone host updater. Desktop preferences, Team Chat handles,
providers, Files, Terminal, skills, and automations remain in Neural Labs. Personal
provider connections remain separate from explicitly authorized background work.

Alshival MCP access uses the existing portal verifier and independent API & MCP
service entitlement. A workspace process cannot establish a human identity by
claiming an agent ID. The plugin therefore uses only the explicit, narrow workspace
background grant. Personal tool calls require a current browser session and CSRF;
neither credential is delivered to a tenant process. Human approval scopes are
excluded from background credentials. Membership reconciliation disables removed
users, closes their sessions, pauses their provider connections, cancels personal
runs, and retains their files/history. Workspace background authority is separate
from an individual browser login.

## Host boundary

The renderer in `deploy/managed/render.py` emits a private, root-owned descriptor,
Compose configuration, and loopback Nginx ingress. PostgreSQL, the control plane,
and the desktop have one bounded persistent slot and independent container limits.
Only the desktop receives its workspace control token. Portal signing secrets,
the database password, and the master encryption key remain outside it. Public
listeners and TLS are managed by Alshival; no Docker socket is mounted in a tenant.

The Alshival host worker owns execution leases, full-stack stop and cleanup,
assignment/generation fences, migration journals, and verified recovery copies.
The standalone updater is not installed for these stacks. A managed deployment
must be admitted on its native architecture; building an image is not acceptance.

## Consequences

A portal outage denies new human access. Coverage loss fences the managed runtime.
Recovery copies are local migration artifacts, not a claim of NAS backup or a
verified disaster recovery process. Nested customer website publishing is a
separate feature; this decision reserves one workspace hostname for the desktop.

Membership lookup failures close managed readiness and are retried. A timeout,
failed transport or invalid response is not an authoritative empty membership
list: it must not permanently pause provider connections, disable users or delete
sessions. Human requests still require current portal authorization and host
execution leases remain enforced. Confirmed removals retain the native revocation
path; confirmed members regain their managed account status without changing
provider connection preferences.

The optional private Claude adapter declares backend ownership and a non-secret,
private-runtime capability marker through OpenClaw's public provider discovery API.
The marker permits choosing that CLI runtime, never making an Anthropic bearer
request. Provider settings continue to attest the exact owner's login. Every
execution resolves its agent directory, checks the owner's connection generation
and pause state, clears ambient provider credentials, and uses only that owner's
Claude home or explicitly owned API-key profile. No portal credentials or shared
provider login are used to satisfy this runtime capability contract.
