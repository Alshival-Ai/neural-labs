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
  Sending a `$skill-name` command asks Neura to run that skill through the
  message author's personal OpenAI account. Use `@Neura` for a general request;
  `$Neura` is not an agent mention. The author first connects that account in Settings →
  Personalization. An ordinary mention such as `@salvador` does not invoke the
  agent.
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
a headless OpenClaw execution on the message author's personal agent in the
shared workspace. A missing, paused, or expired personal account fails the turn
rather than falling back to the automation service account.

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

## Public MCP tools

When Microsoft MCP access is enabled, the public Neural Labs MCP server also
offers these authenticated tools:

- `list_team_channels`
- `list_team_directory`
- `read_team_channel`
- `list_team_channel_members`
- `create_team_channel`
- `post_team_channel_message`

The MCP server forwards the already validated Entra tenant, subject, and object
ID to the control plane over the private Compose network. The control plane maps
that identity to an active Neural Labs Microsoft identity and then applies the
same channel membership rules as the desktop. An Entra account without active
Neural Labs access cannot use the Team Chat tools.

## Operations and recovery

Team Chat channel, message, membership, read, mention, and run state lives in
the normal PostgreSQL database and is covered by the standard Neural Labs
backup procedure. Workspace attachments are covered by the shared workspace
volume backup. Live socket tickets are intentionally short-lived and are not
useful backup data.

After upgrading an existing instance, rebuild the control plane, MCP, workspace,
and desktop images so database migrations and the agent bridge are installed.
The repository does not make host changes during validation. An operator applies
the deployment with the normal deployment command after reviewing the diff.
