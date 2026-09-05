# Neura desktop app

Neura is the Neural Labs desktop interface for each user's personal OpenClaw
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

Creating a private conversation has an explicit readiness transition. Neura
shows **Starting a new chat** while OpenClaw creates the session, then **Getting
Neura ready** while it acquires the exact message subscription and reconciles
recent context. The previous composer is hidden during creation, and the new
composer is enabled only after the subscription and history load both succeed.
The animated indicator respects reduced-motion preferences.

The transcript follows incoming messages while the reader is within 48 pixels
of the bottom. Scrolling upward pauses that behavior and reveals a compact
**Latest** control; using it resumes bottom-follow. WebSocket reconnects keep
the current keyed transcript mounted while history is reconciled in place, so
a transient connection change does not clear the chat or reset its scroll
position. Minimizing Neura also keeps the live app mounted.

## Conversation model

Neural Labs provisions one OpenClaw agent and one agent auth directory from the
immutable Neural Labs user ID. New conversations belong to that agent and are
also created as OpenClaw `draft` sessions. A named Gateway role allowlists only
that agent and sets `sessions.others` to `none`, so the Gateway—not only the
desktop sidebar—rejects another user's roster, transcript, subscription, or
mutation request. The default role has an empty agent allowlist until the user
connects a personal account. Legacy `main`-agent private Neura sessions are
deleted once during the development migration to avoid retaining interactive
history under the system account.

The sidebar separates **Your chats** from **Team chats**. Team chats are an
explicit sharing mode and must never be inferred merely because two approved
developers use the same deployment. See [Team Chats](team-chats.md) for channel
membership, live updates, `@Neura`, attachments, and MCP behavior. Every
approved Neural Labs user can:

- create and switch conversations;
- rename, archive, and restore conversations;
- permanently delete conversations after confirmation;
- send, steer, queue, and stop agent runs;
- attach files or images up to 15 MB each; and
- approve or deny agent actions exposed by OpenClaw.

The app filters history to the signed-in user's personal agent and excludes child,
cron, heartbeat, and automation sessions. New private conversations use the
`neura-private` category and `draft` visibility. Team channels are durable
control-plane records rather than shared OpenClaw sessions. A user can
explicitly copy a private conversation into a restricted or Everyone channel,
and `@Neura` invokes the message author's personal OpenClaw agent only for that
channel turn.

## Voice

The wave control has deliberately different behavior in each chat scope. In a
private chat it opens a live, two-way WebRTC audio session directly between the
browser and OpenAI Realtime. The authenticated workspace server exchanges only
the browser's SDP offer for an SDP answer, keeps the standard OpenAI API key on
the server, and ends the session after five minutes. The user can end it sooner
with the same wave control.

In Team Chat, the wave records a voice memo instead of opening a live call.
Tapping it again stops recording. The memo is sent to the workspace server for
OpenAI transcription, saved under `team-uploads/` as a playable channel
attachment, and posted with its transcript as an `@Neura` message. The visible
transcript therefore becomes durable Team Chat history and is included in the
same bounded context used for that Neura turn. Both paths fail closed when the
server-side `OPENAI_API_KEY` is absent; this key is separate from personal
ChatGPT OAuth credentials.

## Personal OpenAI connection

Open **Settings → Personalization → Your ChatGPT account** to connect through
OpenClaw's device-code flow. The UI shows only the verification URL, one-time
code, expiry, and safe connection status. OpenClaw stores OAuth material in the
personal agent's persistent auth directory; the control plane and browser do
not store the token. Neural Labs accepts only the signed-in developer's local,
deterministically named OAuth profile and pins that profile as the personal
agent's sole OpenAI credential. OpenClaw's inherited workspace profiles and
another developer's profiles never count as a personal connection. Pause
removes the Gateway role but retains the credential, and Resume restores access
without a new sign-in while that credential remains valid.

Neural Labs uses one shared OpenAI provider definition and model policy, not a
separate provider implementation per teammate. Each teammate's personal agent
has its own credential profile and prepared runtime-auth route. The account
controller refreshes that route through the authenticated internal Gateway
client after login so a newly saved token is usable without restarting the
workspace.

On page load, Neural Labs provisions and verifies the personal agent before it
starts the Neura WebSocket. If the safe account status is disconnected or paused, an
actionable desktop toast opens Settings directly on Personalization. The login
flow can begin before a Gateway browser profile exists; after successful OpenAI
authentication, Neural Labs assigns the matching personal role.

Private Neura and Team Chat `@Neura` turns fail closed when this connection is
missing, paused, expired, or not model-ready. They never fall back to the
workspace service credential. The separate Workspace connection continues to
run automations, heartbeats, and other background work.

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
explicit commentary intended for display. Assistant messages marked with
OpenClaw's `commentary` phase become **Progress update** steps inside this card,
both live and after history reload; only the final answer remains in the main
chat. Older unphased preambles are folded when a later tool, plan, or same-turn
assistant answer establishes that they were intermediate. Routine transport
states such as model startup still drive run and queue state but do not appear
as synthetic completed work. OpenClaw approval events render inline with only
their allowed decisions. Assistant text is rendered as Markdown without raw
HTML.

Team Chat uses the same timeline. After the author's isolated personal run
completes, the workspace stores the bounded tool summary exposed by the runner
with the Team Chat run and includes it in later shared transcript handoffs. The
temporary execution state is removed, and author-specific private sessions
remain inaccessible through the Team Chat API.

## Gateway boundary

The browser uses WebCrypto Ed25519 device identity and stores its device key and
issued device token in browser-local storage. Nginx first authenticates the
Neural Labs session, then overwrites trusted-proxy identity headers. OpenClaw
auto-approves a device only through that trusted proxy and grants the desktop
the operator read, write, approvals, and questions scopes. The user's named role
then limits those operations to the user's personal agent. A runtime-generated
password is used only by a loopback administrative client for role assignment
and completed-run history projection; it is never returned to the browser or
placed in the repository.

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
