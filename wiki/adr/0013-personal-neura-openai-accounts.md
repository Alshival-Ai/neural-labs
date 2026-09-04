# ADR 0013: Bind interactive Neura to personal OpenAI accounts

- Status: Accepted
- Date: 2026-09-03

## Context

Neural Labs originally routed every Neura conversation and Team Chat agent turn
through the OpenClaw `main` agent and its workspace-owned OpenAI credential.
That made interactive usage by every approved teammate consume one
administrator-configured account. Automations and unattended jobs still need a
stable service credential, but a human's interactive Neura work should use that
human's own ChatGPT/Codex entitlement.

The workspace remains one trusted developer appliance. Approved developers can
open a shell and become root inside the workspace container, so separate auth
files in that container are an application boundary and an attribution control,
not isolation from a hostile teammate.

## Decision

Create one OpenClaw agent for each Neural Labs user on first use. Derive its
non-secret agent ID from the immutable Neural Labs user UUID, give it a unique
OpenClaw agent/auth directory and deterministic OAuth profile ID, and keep its
workspace path pointed at the shared developer workspace. OpenClaw normally
merges the `main` agent's provider profiles into other agents at read time, so
Neural Labs must reject inherited profiles and pin each personal agent's auth
order to its one locally stored OAuth profile. A bare `--agent` flag is not an
isolation boundary.

The `openai` provider implementation and default model policy remain shared;
the credential profile and runtime agent are per-user. After a device-code
login or auth-order change, Neural Labs asks the authenticated loopback Gateway
client to refresh that agent's prepared model-auth state and verifies the exact
personal profile in the Gateway response. A CLI disk-status check alone is not
sufficient because a running Gateway may still hold a stale auth snapshot.

Add a Personalization card that starts OpenClaw's ChatGPT device-code login for
that personal agent. The browser receives only the verification URL, one-time
code, expiry, and safe status metadata. OAuth tokens remain in OpenClaw's
persistent per-agent auth store. Neural Labs does not store them in PostgreSQL,
the root `.env`, URLs, or browser storage. Pausing changes the user's Gateway
role to `unlinked` and retains the credential; resuming restores access without
another login when the credential is still valid.

Map each trusted-proxy OpenClaw user profile to exactly one dynamic role whose
agent allowlist contains only that user's personal agent and whose
`sessions.others` policy is `none`. The default `unlinked` role has an empty
agent allowlist. An unlinked, paused, expired, or otherwise unavailable personal
account must fail closed; interactive Neura never falls back to `main`.

Keep public browser WebSockets on the existing authenticated trusted-proxy
route. Generate a new internal Gateway password at workspace startup and use it
only for the Gateway process and a loopback administrative client that
provisions profile roles. It exists
in runtime memory/environment, is not written to OpenClaw configuration or the
repository, is not exported to browsers, shells, or agent-run child processes,
and is rotated on every workspace start. Team Chat uses OpenClaw's isolated
`agent exec` mode with a temporary config that selects the message author's
already-provisioned personal agent. The temporary config and prompt are removed
after the turn, and the child needs no administrative Gateway credential. No
new listener or host port is added.

Keep `gateway.auth.trustedProxy.allowLoopback` disabled. Although the workspace
is a trusted developer appliance, enabling that option would let any local
process impersonate a Neural Labs browser identity by supplying proxy headers.
The runtime-only password fallback is narrower: it authenticates only the
in-process administrative client, while browser identity continues to arrive
from the separately authenticated container-network proxy address.

When a Team Chat message invokes `@Neura` or a `$skill-name`, carry the immutable message-author ID
with the durable run record and execute the turn on that author's personal
agent. Supply the recent shared channel transcript, including bounded public
work details from prior Neura turns. Persist redacted plan, command, file, and
tool-result projections with the run and render them as the same collapsed
timeline used by private Neura chats. Never persist or display raw reasoning.

Retain the workspace-owned `main` credential for automations, heartbeats, and
other background/system work. Keep its Gateway role available only to the
separately administrator-gated service identity. Delete legacy `main`
`neura-private` sessions once during this development migration so old
interactive history does not remain under the system account.

## Consequences

- Interactive model usage is attributed to the human who initiated it.
- A Team Chat run cannot start until its message author has connected and
  enabled a personal OpenAI account, even if another participant is connected.
- Team members share the human/agent transcript and safe execution timeline,
  but not the author's private Neura sessions or raw reasoning.
- Automations remain independent of a particular user's login, logout, pause,
  or account expiry.
- Rebuilding or recreating the workspace retains personal OAuth material in the
  existing OpenClaw volumes. Removing a user credential permanently requires a
  separate explicit credential-removal operation; Pause is intentionally
  reversible.
- A workspace-root user can still inspect or alter other users' OpenClaw state.
  Teams requiring adversarial tenant isolation need separate containers or VMs.
- The control-plane database gains a bounded JSON activity projection on Team
  Chat run records; it does not gain an OpenAI credential table.
- Periodic access reconciliation is idempotent. It changes a profile only when
  its role is outside the permitted unlinked, personal, or service state, so it
  does not disconnect an already restricted user's live Neura socket.

## Rejected alternatives

- Falling back to the workspace account when personal auth is missing would hide
  billing/identity mistakes and violate the ownership requirement.
- Sending API keys through the browser or control plane would create additional
  secret stores and bypass the supported ChatGPT device-code flow.
- Proxying and rewriting every Gateway frame would duplicate OpenClaw protocol
  authorization logic. Named roles provide the required agent allowlist while
  preserving the direct WebSocket data path.
- Moving automations onto a human account would make unattended work depend on
  that person's employment, permissions, and token lifetime.
