# Team Chats

Each workspace has one durable **Team Channel** in PostgreSQL, shared with every active member. Private Alshival conversations remain separate. Open conversation history in the compact Alshival widget to select the Team Channel or a private conversation.

New task comments appear in this channel and task-message replies become task comments. Ordinary channel messages remain chats. Historical comments stay on their tasks without being backfilled into the fresh channel. See [Workspace task graph](project-management.md) for the one-time legacy channel reset and upgrade requirements.

## Using the Team Channel

- Use `@handle` to mention a channel member. Each user can edit their unique
  handle in Settings → Personalization.
- Type `$` to open the same enabled-skill picker used in a private Alshival chat.
  Sending a `$skill-name` command asks Alshival to run that skill. Use `@Alshival`
  for a general request; `$Alshival` is not an agent mention. An administrator
  selects a dedicated Team connection and model under **Settings → Model Provider
  → Advanced connections** before Team Chat can run Alshival. See
  [AI accounts](ai-accounts.md). An ordinary mention such as `@teammate` does not
  invoke the agent.
- Images appear as embedded previews, while other attachments appear as
  download cards. User attachments are uploaded into the shared workspace under
  `team-uploads/`, and Alshival can attach files it generated in the workspace.
  The channel message stores a reference to the file. The shared Files app can
  therefore also see these files; channel membership is not a file ACL in V1.
- Use the wave control to record a voice memo. Tap it again to stop and send.
  Neural Labs stores a playable audio attachment, transcribes the memo through
  the server-side OpenAI provider, and posts the transcript as an `@Alshival` turn
  so spoken instructions are included in agent context.
- Use the collapsed terminal rail on the right to see whether the channel has
  active terminals. Expand it to see session status, channel-member bubbles,
  and currently connected terminal participants. The plus action starts another
  channel terminal; selecting a card joins that exact session. Channel terminals follow the active-user audience. The browser never
  supplies or widens the terminal member list.

Messages, typing indicators, membership changes, agent status, unread counts,
and mentions update live over the authenticated Team Chat WebSocket. A lost
connection is retried automatically. Draft text remains in the composer while
the socket reconnects, and sending is disabled until live delivery is restored.
When a Alshival turn is queued, the transcript immediately shows a starting row;
it changes to a working row when execution begins. The run is owned by the
server, continues if the author switches channels, closes the browser, or is
inactive, and is restored in the channel snapshot after reconnecting. A single
turn may work for up to 10 minutes, exceeding the five-minute inactivity window,
before the execution timeout ends it.

## Membership

The Team Channel includes current active workspace members. Restricted channels and channel creation/deletion are retired. Administrators can manage the channel’s supported settings. Member removal immediately removes channel access; private conversations and their histories are not imported into the channel. Channel terminals follow the same active workspace membership checks.

## Alshival execution path

`@Alshival` or a `$skill-name` command queues a durable agent-run record and issues
a random, short-lived capability. Only a hash of that capability is stored in
PostgreSQL. The control plane sends the recent channel transcript and the run
capability to the workspace's authenticated internal runner. The native runtime
launches Codex app-server or Claude Code using the administrator's saved Team
connection and model. Before launch and during execution, the control plane
checks the run capability, channel membership, Team connection generation, and
managed portal membership when applicable. Missing or paused Team credentials
fail the turn without choosing a personal account.

For that turn only, the CLI receives a local MCP token. The trusted workspace
service forwards Team MCP requests with the run capability after revalidating
execution authority. The built-in MCP surface
can inspect channel metadata, read the current channel, and post as Alshival with
shared-workspace file references. It
cannot select or access another channel. Alshival receives up to 250 recent
messages plus bounded, redacted plans, commands, file operations, and tool
results from earlier Alshival turns as handoff context. Raw model reasoning is
not included. The complete
orchestration prompt remains capped at 1 MiB. The capability expires when the
run finishes or after 20 minutes. Turns in one channel execute in order;
independent channels can run concurrently.

Native CLI command and file permission requests appear in Team Chat for
administrators only. An administrator chooses **Allow once** or **Decline**;
the message author cannot approve the CLI action. Pending approvals stay with
the active run across browser reconnects. Revoking membership or the Team
connection stops native execution on its next authority check.

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
