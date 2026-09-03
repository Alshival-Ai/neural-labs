# Neura desktop app

Neura is the Neural Labs desktop interface for the shared OpenClaw `main`
agent. It runs in the workspace image and connects directly to the version-
matched OpenClaw Gateway browser protocol through the authenticated same-origin
WebSocket at `/workspace/neura/socket`.

The socket remains open for the desktop session. Neura subscribes to the shared
conversation roster and acquires a targeted `sessions.messages.subscribe`
lease for the selected conversation before loading its history or enabling the
composer. Roster events trigger a fresh `sessions.list` request; the
`sessions.subscribe` acknowledgement is control-plane metadata and is never
treated as the conversation list. OpenClaw then delivers streaming `chat` events and durable
`session.message` commits over that same connection. Neura reconciles the two
projections so a committed final answer replaces its temporary streaming row
without waiting for a page refresh.

The transcript follows incoming messages while the reader is within 48 pixels
of the bottom. Scrolling upward pauses that behavior and reveals a compact
**Latest** control; using it resumes bottom-follow. WebSocket reconnects keep
the current keyed transcript mounted while history is reconciled in place, so
a transient connection change does not clear the chat or reset its scroll
position. Minimizing Neura also keeps the live app mounted.

## Conversation model

New Neura conversations are private to their creator. Neural Labs creates them
as OpenClaw `draft` sessions, so the Gateway—not only the desktop sidebar—hides
their roster entries, transcripts, subscriptions, and mutations from other
users. The ordinary developer role also sets `sessions.others` to `none`, so
legacy shared metadata cannot bypass the private default. During the V1
privacy migration, creator-owned legacy Neura sessions
that predate this rule are converted from `shared` to `draft` when their owner
connects.

The sidebar separates **Your chats** from **Team chats**. Team chats are an
explicit sharing mode and must never be inferred merely because two approved
developers use the same deployment. See [Team Chats](team-chats.md) for channel
membership, live updates, `$Neura`, attachments, and MCP behavior. Every
approved Neural Labs user can:

- create and switch conversations;
- rename, archive, and restore conversations;
- permanently delete conversations after confirmation;
- send, steer, queue, and stop agent runs;
- attach files or images up to 15 MB each; and
- approve or deny agent actions exposed by OpenClaw.

The app filters the history to the configured `main` agent and excludes child,
cron, heartbeat, and automation sessions. New private conversations use the
`neura-private` category and `draft` visibility. Team channels are durable
control-plane records rather than shared OpenClaw sessions. A user can
explicitly copy a private conversation into a restricted or Everyone channel,
and `$Neura` invokes the OpenClaw agent only for that channel turn.

## Run controls

When Neura is idle, Enter sends the draft. While a run is active, Enter steers
the run and Ctrl/Cmd+Enter queues a follow-up. Shift+Enter inserts a new line.
The split send control exposes both active-run choices. Neura also recognizes a
run reported active by the session roster, including one started before this
browser opened the app; receiving an intermediate durable assistant message
does not change the composer back to idle.

Queued prompts appear in a compact, scrollable FIFO panel above the composer.
Each row shows its queue position and attachment count and can be removed before
it begins. Neural Labs admits queued prompts immediately with OpenClaw's
`followup` mode, so the Gateway starts the next prompt when the current run
finishes; delivery does not depend on a tab timer or on keeping the Neura window
visible. The queue row becomes an ordinary user transcript message when that
turn starts. A follow-up admission acknowledgement is not mistaken for the end
of the original run.

Stop aborts the current run but does not stop the always-on Gateway. Closing or
minimizing the desktop window also leaves the run active.

Switching conversations releases the old message subscription and acquires one
for the new conversation. After a transport reconnect, the browser restores
the roster subscription, restores the selected conversation subscription, and
then reloads durable history. Sending stays disabled during this short recovery
window so an answer cannot be started before its live event channel exists.

Tool, plan, safe progress, and operation events appear as a compact collapsed
timeline in the transcript. Expanding it reveals individual steps; command
steps can then reveal their bounded command, output, exit code, and duration.
Durable tool calls and results from `chat.history` are reconstructed into the
same UI after a reload. Known credential-shaped values are redacted, and raw
reasoning content is never projected—the UI uses a generic thinking label or
explicit commentary intended for display. OpenClaw approval events render
inline with only their allowed decisions. Assistant text is rendered as
Markdown without raw HTML.

## Gateway boundary

The browser uses WebCrypto Ed25519 device identity and stores its device key and
issued device token in browser-local storage. Nginx first authenticates the
Neural Labs session, then overwrites trusted-proxy identity headers. OpenClaw
auto-approves a device only through that trusted proxy and grants the desktop
the operator read, write, approvals, and questions scopes for `main`.

The OpenClaw Control UI is disabled and `/workspace/openclaw/` is retired. The
Gateway continues to bind inside the workspace bridge and its published host
port remains loopback-only.

## Build and tests

The source is under `workspace/desktop/` and uses React, TypeScript, and Vite.
The workspace image runs `npm ci` and builds the immutable browser assets in a
separate image stage. Run the focused checks with:

```bash
npm --prefix workspace/desktop run validate
node --test workspace/http-server.test.mjs
```

`make validate` includes these checks with the rest of the repository.
