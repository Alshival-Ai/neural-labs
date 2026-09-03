# ADR 0008: Store Team Chats as explicit control-plane channels

- Status: Accepted
- Date: 2026-09-01

The channel and capability decision remains current. ADR 0013 changes only the
OpenClaw execution owner: a `$Neura` turn now uses the message author's personal
agent instead of the shared `main` agent.

## Context

Private Neura conversations are creator-only OpenClaw sessions. Neural Labs
also needs Slack-like collaboration in which humans can speak without invoking
the agent, invite a defined set of teammates or Everyone, mention users, attach
shared files, and deliberately call Neura with `$Neura`.

Changing an OpenClaw session from private to shared would not supply the needed
human channel model, membership administration, pins, unread state, or Entra
MCP operations. It would also risk weakening the creator-only boundary that
protects private agent transcripts.

## Decision

Store Team Chat channels, explicit restricted memberships, messages, mentions,
read cursors, and agent-run state in control-plane PostgreSQL. Treat Everyone
as a dynamic audience of all active users. Keep private Neura conversations in
OpenClaw as `draft` sessions and implement sharing as a one-time, labelled copy
of recent history into a new Team Chat; do not change the private source's
visibility.

Use an authenticated same-origin WebSocket for live channel messages, typing,
membership refreshes, and Neura run status. The browser obtains a 60-second,
single-use ticket through its cookie-authenticated, CSRF-protected session. The
upgrade verifies the exact public origin. Every subscription, post, read cursor,
and broadcast rechecks active channel access.

Run `$Neura` through the shared workspace but do not grant the long-running
workspace or browser a deployment-wide Team Chat credential. Each run receives
a random capability scoped to one channel. Store only its hash, require the run
to be active, expire it after 20 minutes or on completion, and expose only
current-channel MCP tools to the agent process.

Add Team Chat tools to the existing Entra-authenticated public MCP server. The
MCP-to-control-plane bridge uses the existing private configuration token only
on the Compose network. The control plane does not trust forwarded profile
fields for authorization: it maps the validated Entra tenant and stable subject
or object ID to an active Microsoft identity before applying ordinary channel
permissions.

Workspace attachment paths are metadata references, not per-channel file ACLs.
This is consistent with the V1 shared developer workspace: all approved users
can browse the shared workspace even when a message containing a file reference
belongs to a restricted channel.

## Consequences

- Human Team Chat traffic does not consume an agent turn unless it contains
  `$Neura`.
- Private OpenClaw transcripts remain inaccessible to other developers until
  their creator explicitly copies one into a channel.
- Imported history is labelled and submitted by the authenticated creator's
  desktop; the control plane does not cryptographically attest that copied
  assistant text came from OpenClaw.
- Durable collaboration state is included in PostgreSQL backups, while live
  fan-out and typing state are ephemeral.
- Removing a member immediately prevents new reads and socket broadcasts, but
  cannot revoke information the member already viewed.
- The control plane now trusts the workspace internal runner to keep the
  per-run capability out of logs and child processes other than the selected
  OpenClaw execution. The capability's narrow scope and expiry limit the impact
  of accidental disclosure.
- The public MCP configuration token now authorizes an internal Team Chat bridge
  as well as runtime configuration reads. It remains private to the MCP and
  control-plane containers and never authorizes an end user by itself.
- Per-file privacy would require a separate storage authorization design and is
  intentionally outside V1.
