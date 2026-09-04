# ADR 0016: Scope Team Chat terminals to channel membership

- Status: Accepted
- Date: 2026-09-03

## Context

The original Team Terminal is a workspace-wide collaboration surface: every
active user can discover and attach to its shared PTY. Team Chat also supports
restricted channels, so launching a terminal from one of those channels must
not make its terminal visible or joinable by users outside the channel.

The workspace container owns live PTYs, while the control plane owns users,
channel audiences, and restricted membership. A channel member list supplied
by the browser would let a client widen terminal access and would duplicate
authorization state outside its source of truth.

## Decision

Keep PTY processes in the workspace runtime and add an optional Team Chat
channel identity to Team Terminal sessions. The workspace asks a private,
control-token-protected control-plane endpoint to authorize the authenticated
workspace actor against that channel. The endpoint returns only an allow result
and bounded channel metadata; it does not return the channel roster.

Recheck authorization when listing sessions, creating or opening a
channel-scoped terminal, issuing a socket ticket, consuming the one-use ticket,
and periodically while sockets remain attached. Failure to reach the control
plane fails closed for channel-scoped terminals. A removed or disabled member
therefore loses discovery and new connection access immediately and has an
existing terminal socket closed on the bounded revalidation interval.

Allow multiple Team Terminal sessions per Team Chat channel. A collapsed rail
in the channel shows live-session count; its plus action creates a new session,
and the expanded rail lists channel terminals with channel-member and connected
participant presence. Selecting a listed session opens that exact PTY.
Workspace-wide Team Terminals created explicitly in the Terminal app remain
available for intentionally workspace-wide collaboration and are labelled
separately from channel-scoped sessions.

## Consequences

- Restricted Team Chat membership now protects terminal discovery, ticket
  issuance, attachment, input, output, presence, reactions, and voice signaling.
- Everyone-channel terminals dynamically admit every active user, matching the
  Team Chat audience rule.
- Channel membership remains authoritative in PostgreSQL; the browser cannot
  grant terminal access and the workspace does not persist a copied roster.
- Terminal contents still operate on the shared workspace filesystem. Channel
  membership is an access boundary for that live PTY, not a per-file ACL.
- Live terminal state remains ephemeral and disappears when the workspace
  container restarts, consistent with existing Team Terminal lifecycle rules.
