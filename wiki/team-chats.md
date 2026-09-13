# Team Chats

Team Chats are durable, multi-user channels inside the Neura desktop app. They
are separate from private Neura conversations: a new private conversation is
still an OpenClaw creator-only `draft`, while a Team Chat is stored by the
control plane in PostgreSQL and has an explicit audience.

## Using Team Chats

Open Neura and use the **Team chats** section in the conversation sidebar.

- Create an **Invited teammates** channel by selecting at least one active
  Neural Labs user.
- Create an **Everyone** channel to include every active user, including users
  approved later.
- Use `@handle` to mention a channel member. Each user can edit their unique
  handle in Settings → Personalization.
- Type `$` to open the same enabled-skill picker used in a private Neura chat.
  Sending a `$skill-name` command asks Neura to run that skill. Use `@Neura`
  for a general request; `$Neura` is not an agent mention. Before dedicated Team
  Neura activation, the author connects a personal account in **Settings → Model
  Provider**. After activation, Team Chat uses the dedicated account. See
  [AI accounts](ai-accounts.md). An ordinary mention such as `@teammate` does not
  invoke the agent.
- Images appear as embedded previews, while other attachments appear as
  download cards. User attachments are uploaded into the shared workspace under
  `team-uploads/`, and Neura can attach files it generated in the workspace.
  The channel message stores a reference to the file. The shared Files app can
  therefore also see these files; channel membership is not a file ACL in V1.
- Use the wave control to record a voice memo. Tap it again to stop and send.
  Neural Labs stores a playable audio attachment, transcribes the memo through
  the server-side OpenAI provider, and posts the transcript as an `@Neura` turn
  so spoken instructions are included in agent context.
- Use the collapsed terminal rail on the right to see whether the channel has
  active terminals. Expand it to see session status, channel-member bubbles,
  and currently connected terminal participants. The plus action starts another
  channel terminal; selecting a card joins that exact session. Restricted-channel
  terminals are visible and joinable only by current channel members;
  Everyone-channel terminals follow the active-user audience. The browser never
  supplies or widens the terminal member list.

Messages, typing indicators, membership changes, agent status, unread counts,
and mentions update live over the authenticated Team Chat WebSocket. A lost
connection is retried automatically. Draft text remains in the composer while
the socket reconnects, and sending is disabled until live delivery is restored.
When a Neura turn is queued, the transcript immediately shows a starting row;
it changes to a working row when execution begins. The run is owned by the
server, continues if the author switches channels, closes the browser, or is
inactive, and is restored in the channel snapshot after reconnecting. A single
turn may work for up to 10 minutes, exceeding the five-minute inactivity window,
before the execution timeout ends it.

## Membership and channel management

The channel creator and Neural Labs administrators can rename a channel,
manage its members, and delete it. A member can leave a restricted channel.
The creator cannot be removed. Everyone channels always follow the set of
active users, so they do not have an editable member list.

Only administrators can pin or unpin channels. Pinned channels appear first for
every user who can access them; all other visible channels are ordered by recent
activity. A restricted channel that a user cannot access is returned as not
found, including through direct API or WebSocket requests.

To turn a private Neura conversation into a channel, open its action menu and
choose **Share as Team Chat**. Neural Labs copies up to the last 250 user and
assistant messages into a new channel and then archives the original private
conversation. The private source remains creator-only and can be restored from
the archive. A source conversation can be shared only once by its creator.

## Neura execution path

`@Neura` or a `$skill-name` command queues a durable agent-run record and issues
a random, short-lived capability. Only a hash of that capability is stored in
PostgreSQL. The control plane sends the recent channel transcript and the run
capability to the workspace's authenticated internal runner. The runner starts
an isolated OpenClaw execution using the selected Team account policy. Until
an administrator first activates dedicated Team Neura, it uses the message
author's personal agent. After activation, queued requests capture the applied
Team model defaults and use the dedicated credential. Missing credentials fail
the turn without falling back to a personal, background, or audio API account.

For that process only, OpenClaw receives an MCP server configuration whose
authorization header comes from the run capability. The built-in MCP surface
can inspect channel metadata, read the current channel, and post as Neura with
shared-workspace file references. It
cannot select or access another channel. Neura receives up to 250 recent
messages plus bounded, redacted plans, commands, file operations, and tool
results from earlier Neura turns as handoff context. The same public work
details are stored with the run and shown in a collapsed timeline below the
Team Chat answer. Raw model reasoning is not included. The complete
orchestration prompt remains capped at 1 MiB. The capability expires when the
run finishes or after 20 minutes. Two Team Chat Neura turns may execute
concurrently; additional turns remain queued.

The dedicated-appliance defaults allow 128 KiB messages, 100 attachments per
message, 500 messages per history page, 2,000 members or imported messages per
channel operation, and up to 16 MiB of copied private-chat text. These remain
finite so a malformed client cannot allocate memory without bound.

## Workspace tools and public MCP

Team Chat's internal tools use a short-lived capability scoped to the current
channel. They do not require public MCP ingress. The public `/mcp` and OAuth
routes return `404`, including when Microsoft web login is enabled. The
[future public MCP reference](mcp-entra-oauth.md) describes retained development
code, not a supported connection for this deployment.

## Operations and recovery

Team Chat channel, message, membership, read, mention, and run state lives in
the normal PostgreSQL database and is covered by the standard Neural Labs
backup procedure. Workspace attachments are covered by the shared workspace
volume backup. Live socket tickets are intentionally short-lived and are not
useful backup data.

After upgrading an existing instance, update the control-plane and workspace images, including their
bundled desktop and local MCP builds so database migrations and the agent bridge are installed.
The repository does not make host changes during validation. An operator applies
the deployment with the normal deployment command after reviewing the diff.
