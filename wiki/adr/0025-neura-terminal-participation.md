# ADR 0025: Neura participation in interactive terminals

> Design history: for current instructions, see [Terminal desktop app](../terminal.md).
> See the [decision index](../maintainer-reference.md#architecture-decision-history) for amendments and related records.

- Status: Accepted
- Date: 2026-09-06

## Context

The agent's background command executor cannot open a Neural Labs desktop window
or transfer a running process to the Terminal app. Users also need Neura to inspect
sessions they opened themselves, including output generated before opening chat.
The provider MCP is shared, while terminal visibility is user/channel scoped.

## Decision

Add terminal discovery, launch, read, and input tools to the existing loopback-only
provider MCP. An authenticated browser message mints a one-hour, memory-only
capability binding its actor, conversation and optional channel, with immutable
snapshots of up to three sessions ordered by per-user human interaction recency.
Each snapshot carries at most 4 KiB of eligible output. The composer has no terminal
selector. Creation, explicit focus and human input update recency; output,
reconnects and agent activity do not. Writes always name an explicit terminal ID.
Team runs receive equivalent context through the authenticated control-plane
runner. The model cannot authorize access by supplying a user ID. The capability
permits the conversation's accessible terminals, not other users' personal sessions
or other channels' terminals in a Team Chat.

The local MCP calls a workspace-control-token-protected internal terminal bridge.
Every tool call resolves the actor's current active status through the control
plane and applies personal ownership or current Team Chat membership. A private
chat may inspect the user's accessible Team Terminals. A Team Chat can inspect
only its matching channel. Reads recheck authorization and sharing after waiting.

Desktop launches use a user-scoped SSE stream, an atomic single-desktop claim, a
30-second deadline and one-hour idempotency retention. The PTY remains deferred
until a browser acknowledges the terminal-ready frame. Closing or missing the
launch deadline cannot run the command later. Processes stay inside the existing
workspace environment and working directories stay within the workspace root.

Terminal output stays in the existing bounded session buffer. Each chunk records
whether agent sharing was enabled when it arrived. Paused chunks remain excluded
from later agent reads even after sharing resumes. The owner controls personal
sharing; the creator or an administrator controls Team sharing. All participants
see the setting. Status-only permits process-status reads but rejects agent input.
Only human-authenticated endpoints can change that setting.

## Consequences

Neura can inspect previous output on demand and participate in the same PTY as the
user. The UI indicates available/active participation and shows agent input
activity without separately recording input text. A question is read-only intent;
agent instructions require an action request before typing. There is no automatic
secret detection, persistent terminal recording, or separate credential store.

The chat transport carries the capability in machine context hidden by the UI,
so underlying OpenClaw conversation state must remain private. Expiry bounds token
reuse; expiry does not withdraw output already returned to an agent. Prompt output
is treated as untrusted data. The retained buffer is not an authoritative rendered
screen for full-screen terminal applications.

This remains the documented trusted shared-workspace architecture. Capabilities
and personal terminal visibility are application controls, not OS isolation from
workspace users with unrestricted sudo. No host port, mount, privilege, provider
credential, or public ingress boundary is expanded. Activation requires an operator
to deploy the workspace image; repository validation remains non-mutating.

## Automatic recent context revision

Private messages carry the bounded snapshots in hidden machine context. Team
messages carry only an opaque capability in the private run queue; its actor and
channel are checked before the original snapshots are delivered to the model.
Pausing sharing before queued delivery removes captured output, and removed or
inaccessible sessions are omitted. No new snapshots replace queued context.
Previously delivered content cannot be withdrawn from a model's conversation.
