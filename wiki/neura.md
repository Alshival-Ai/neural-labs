# Neura desktop app

Neura is the Neural Labs desktop interface for each user's personal OpenClaw
agent. It runs in the workspace image and connects directly to the version-
matched OpenClaw Gateway browser protocol through the authenticated same-origin
WebSocket at `/workspace/neura/socket`.

## Phone navigation and composing

At phone-sized app widths, the top-left menu opens a collapsible **Conversation
history** drawer. It contains searchable private chats and Team channels, plus
Recent and Archived views and always-visible conversation actions. Selection,
the close button, Escape, or tapping the backdrop dismisses it. The drawer traps
focus and restores it to its opener; it does not change the desktop sidebar
preference. Team channels expose their terminal list through a separate toolbar
button and drawer, leaving the conversation full-width.

The composer grows with a multiline draft, has larger touch targets, and stays
above the visual viewport's keyboard boundary and the floating desktop dock.
Long code blocks and tables scroll within the transcript rather than widening
the app. Shift+Enter adds a newline; the visible send controls also work on phones.

## Planning and sending in private chats

Private chats have a **Normal / Draft plan** selector. Draft plan sends an ordinary
request asking Neura to propose steps before implementation. This is an advisory
prompt: it does not restrict tools or enforce Codex's native Plan mode. Existing
tool permissions and approvals still apply. The choice is local to the current
browser tab and conversation; refreshing returns the composer to Normal.

**Implement plan** sends the latest completed plan back as a normal chat request
and keeps your unsent draft. Plan cards are reconstructed from durable chat
messages after reconnecting. A later user message makes the earlier plan inactive.
Old proposed-plan signatures remain readable for existing history.

With focus in the composer:

- **Enter** sends when idle and steers the current run when Neura is working.
- **Ctrl/Cmd+Enter** queues a follow-up during a run, or sends when idle.
- **Shift+Enter** inserts a newline.
- **Ctrl/Cmd+Shift+P** switches between Normal and Draft plan when idle.
- **Tab / Shift+Tab** navigate controls; plain Tab or Enter can accept a skill suggestion.

During a run, visible **Steer** and **Queue** controls offer the same actions on
touch screens. Stop remains available separately. The UI disables drafting
selection while its run or queue is busy; this is not a cross-tab runtime policy.
Queued planning requests retain their ordinary message text. Structured
clarification cards use upstream question APIs and restore pending questions
after reconnecting, independently of the drafting selection. Team chats retain
their existing behavior.

See [ADR 0028](adr/0028-upstream-openclaw-boundary.md) for the separation between
Neural Labs features and the unchanged OpenClaw runtime.

## Gateway lifecycle

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

## Project placement

New project work belongs in `projects/<project>` beneath the shared workspace,
for example `/home/node/workspace/projects/lemonade-lab`. The Files app's `~`
denotes `/home/node/workspace`, not the shell home `/home/node`. Briefs, assets,
source, and generated output stay with the project. Existing legacy projects
are not moved automatically.

The operator-maintained instruction block is
[`workspace/project-guidance.md`](../workspace/project-guidance.md). It is also
installed near the top of the persistent workspace `AGENTS.md`, which all personal
agents share and Team Chat execution uses. Preserve other workspace instructions
when updating this block. This changes guidance, not filesystem permissions.

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

The composer has one primary send/voice control. An empty draft shows the mic;
text or queued attachments show Send. Private chat has an Open/Hold switch:
Open starts a continuous microphone session, while Hold transmits only while the
wave is pressed. Private chat opens a two-way WebRTC session directly between the
browser and OpenAI Realtime. A persistent call bar provides mute/unmute and hangup,
including while typing. Mute disables the outgoing audio track. Hold mode only
transmits while pressed; release, lost focus, and touch cancellation close the mic.
Changing conversations or closing Neura releases its media. Calls stop after five
minutes. The authenticated server exchanges SDP and keeps the provider key private.

In Team Chat, the wave is always hold-to-talk and has no mode switch. Releasing
it transcribes and posts the voice memo rather than opening a live call. The original audio is saved under
`team-uploads/` and the visible transcript becomes durable channel history. Posting
a memo explicitly sets `invokeAgent: false`, even if its transcript contains a
mention or skill command. Teammates can later summon Neura with `@Neura`; recent
transcripts enter that run's bounded channel context, with older history
accessible through channel-scoped tools. This does not copy team history
into unrelated private Realtime calls.

Failed memos stay in memory in the current tab for playback, transcription retry,
audio-only sending, download, or discard. Audio-only posts have no transcript for
Neura. The memo is retained until the server acknowledges saving it; retries reuse
one request ID and any completed transcription/upload. Changing channels aborts
in-flight work and preserves the pending memo for its original channel. Refreshing
or closing the tab loses unsent audio, so download it first. Both voice API paths
fail closed without server-side `OPENAI_API_KEY`; personal ChatGPT OAuth credentials
are separate.

## Browser QA

Neura can use OpenClaw's bundled browser tool for multi-step website QA. The
workspace image installs Debian's Chromium package plus broad-coverage web and
emoji fonts; OpenClaw already supplies the Playwright-backed control runtime and
its `browser-automation` skill. Both private Neura turns and isolated Team Chat
turns inherit the browser tool.

The default `openclaw` profile is a dedicated agent-only profile. It runs
headless in the workspace container, uses `/usr/bin/chromium`, and does not
attach to a developer's host browser, cookies, or signed-in sessions. Neura can
open public HTTP(S) sites, take accessibility snapshots and screenshots, and
click, type, wait, or inspect browser errors and requests. It should use the
bundled browser skill's status, stable-tab, snapshot, and stale-reference loop
for longer QA tasks.

OpenClaw's private-network navigation guard remains active. Only exact
`localhost` and `127.0.0.1` destinations are added so Neura can test preview
servers that it starts inside its own workspace container; the rest of the
Compose and host private network is not browser-addressable through this grant.
The browser requires no additional public listener.

The same image includes FFmpeg and FFprobe for seek-oriented video derivatives,
WebP and ImageMagick image utilities, and rsync for local site assembly. The
team's website-builder skills treat ordinary style and effect choices as
evidence-led `AUTO` decisions: complete showcase builds receive a full-bleed
media opening and one purposeful viewport-scale scroll-video or frame-sequence
scene whenever compatible media passes the quality gates.
Neura asks about effects only when the user wants to choose; factual identity or
unsafe conversion ambiguity can still stop a build. Cinematic runtime media is
stored locally, classified as authentic, representative, or generated, and
verified before browser QA.

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

In private and Team chats on every viewport, Enter sends and Shift+Enter inserts
a new line. During an active private run, Enter steers the run; queueing remains
an explicit choice in Send options. When an `@` mention or `$` skill popup is
open, Enter accepts the highlighted suggestion. IME composition does
not accidentally submit a message. The split send control exposes both
active-run choices. Neura also recognizes a
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
File-change steps reveal the bounded, credential-redacted patch or generated
content so the user can review what the agent changed.
Durable tool calls and results from `chat.history` are reconstructed into the
same UI after a reload. Known credential-shaped values are redacted, and raw
reasoning content is never projected—the UI uses a generic thinking label or
explicit commentary intended for display. Assistant messages marked with
OpenClaw's `commentary` phase—whether top-level or carried in signed text-block
metadata—become **Progress update** steps inside this card,
both live and after history reload; only the final answer remains in the main
chat and streams as it is generated. While a run is active, a refresh treats
the unfinished assistant tail as work-in-progress rather than guessing that its
last durable message is the answer. Older unphased preambles are folded when a
later tool, plan, same-turn assistant answer, or active-history reload establishes
that they were intermediate. Routine transport
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

## Chat history and attachments

Your Chats initially shows five recent conversations. Load more chats reveals
five more in its own scrolling section, keeping Team chats accessible below.
Collapse Your Chats to make more room; this preference is remembered for each
Neura window on the current device. Searching temporarily opens matching private
history, and clearing the search restores the collapse preference. An older open
conversation remains reachable under Current chat.

Images display inline and open in an image preview. Videos play directly in chat
with native playback, seeking, volume, and fullscreen controls. A paused first
frame provides a preview without autoplay; offscreen videos wait until they are
near the viewport to load. Playback depends on the browser's codec support, and
Download remains available when a video cannot play. Private video playback uses
the same authorization tickets and supports byte-range requests for seeking.

Use an attachment's overflow
button or right-click menu for **Download** to your computer or **Download to
Workspace**. The workspace action asks for a folder and filename, starts in
Downloads, and remembers your last successful destination. Workspace files are
shared with approved workspace users. Existing filenames offer Keep both,
Replace, or Cancel; the source attachment cannot replace itself.

New attachment-only messages do not repeat filenames in their text. Historical
captions remain intact when their origin is ambiguous. Private media uses the
existing short-lived authorization tickets; if a ticket expires, the app tries
one refresh through the owning conversation before showing an error.
