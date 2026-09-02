# ADR 0007: Make Neura conversations private by default

- Status: Accepted
- Date: 2026-09-01

## Context

Neural Labs previously created every Neura conversation with OpenClaw
`shared` visibility. The workspace's ordinary developer role may participate
in shared sessions, so another approved developer could open and write in a
conversation they did not create. Sidebar filtering would not fix this because
the Gateway would still authorize direct history, subscription, and mutation
requests.

Neural Labs also intends to add Slack-like Team Chats. Sharing must therefore
be an explicit transition, not a property inherited by every new agent chat.

## Decision

Create private Neura conversations as OpenClaw `draft` sessions with category
`neura-private`. OpenClaw treats `draft` as creator-only and enforces that rule
for roster visibility, transcript reads, event subscriptions, agent sends, and
session mutations.

Set the ordinary `maintainer` role's `sessions.others` capability to `none`.
This is the deny-by-default backstop for legacy records and prevents a stale
client from using an old `shared` flag to enter another creator's transcript.

When a creator first loads legacy Neural Labs conversations, convert their
creator-owned `shared` sessions to `draft`, except sessions durably marked with
the future `neura-team` category. Separate private and team conversations in
the desktop sidebar. A future Team Chat may become non-draft only through an
explicit share or channel-creation flow and must use Gateway membership for
restricted channels.

## Consequences

- Approved users no longer receive implicit access to another user's new
  Neura conversations.
- Existing private-intent chats become protected when their creator next opens
  the upgraded desktop.
- Administrators do not gain Neura transcript access through the ordinary
  Neura WebSocket, which continues to omit `operator.admin`.
- Team channels require a separate data and permission design for membership,
  mentions, human-only messages, and file references. That design must replace
  the blanket `none` capability with a policy proven to honor explicit channel
  membership without restoring deployment-wide transcript access.
