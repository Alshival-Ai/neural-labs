# ADR 0034: Owner-scoped Claude account connections

Status: Deployed; authenticated live-account completion acceptance remains operator-driven.
Date: 2026-09-19

## Decision

Extend the fixed personal, Team Neura, and Background AI bindings to Claude.
Both providers can remain connected. A model's provider selects its credential
owner; connecting alone never rewrites defaults. Workspace administrators may
explicitly choose API-key billing instead of a subscription for each workload.
This supersedes the Claude placeholder decision in ADR 0023.

Use the unmodified Claude Code 2.1.226 CLI. Settings starts only `claude auth
login` in an isolated native credential home, then opens that exact PTY as a
private session in the existing Terminal app. Terminal's existing
`/workspace/api/terminals/socket` WebSocket handles output, input, resize,
clipboard paste and reconnect. There is no separate Settings terminal or HTTP
or SSE terminal I/O. The Terminal app displays Anthropic's allowlisted native
sign-in URL; the user pastes the returned code into the native prompt.

The control plane returns a terminal ID after a same-origin, CSRF-protected
connect action. Terminal's authenticated APIs issue single-use, 60-second
WebSocket tickets bound to the initiating actor and session. Only that actor
can access the sign-in session, including workspace-owned logins. Active
membership and workspace administrator role are checked on access and during
socket heartbeats. The process always remains in the provider owner's native
home; no generic shell or command string is used to launch it. Neura cannot
list, read, write, or enable participation in these sessions. Output remains
bounded in memory and is cleared on completion or closure; no shell history or
audit receives the sign-in code. Closing the session cancels the native login.
Reopening an unfinished connection focuses the same Terminal session; reconnect
replays output only, never input. Instances need no additional DNS, callback URL
or exposed port.

Claude owns subscription storage and refresh inside a persistent, per-agent
configuration directory. Reconnect advances a generation to prevent native
sessions from being resumed under a replacement login. Workspace API keys use
OpenClaw's owner-scoped credential profiles and explicit order, saved through
its public SDK using protected stdin. Browser APIs return safe status, never
saved keys or subscription tokens. Ambient provider credentials are stripped
from text runtimes.

The `neural-labs-claude` plugin registers a CLI backend using the public plugin
SDK outside the unchanged `/app` tree. Every configured Claude model uses this
adapter, including explicit conversation and job selections. The adapter checks
the owning agent, saved pause state and generation before process admission.
Native Claude tools are disabled; tools are supplied through OpenClaw's bounded
MCP bridge and retain Gateway authorization. Native Claude's separate tool
permission surface is not enabled by this integration. Reasoning uses native
CLI controls. The CLI owns its persistent conversation files; OpenClaw retains
its existing transcript and session ownership checks.

OpenAI pause now stores a per-provider pause flag and an explicit empty native
auth order. Refresh must not restore that order while paused; Resume restores
the owner's single profile. Another active provider can retain the personal
Gateway role. Claude pause blocks new processes and requests abort of active
Claude chats. Disconnect retires the native login without deleting application
conversation history or silently selecting a different provider.

## Compatibility and acceptance

Existing OpenAI endpoints, identities, policy revisions and credentials remain.
New routes live under `/api/{account|admin/workspace}/model-providers/anthropic/connection`.
Mutations use action suffixes; workspace routes distinguish `workload=team`
from Background AI. The personal `/model-providers/access` endpoint reports the
connection selected by the personal default. Manual runs capture their effective
model at acceptance; scheduled jobs retain their assigned owner. Voice remains
on its separately configured OpenAI audio API key.

The isolation here is application ownership inside the repository's existing
trusted shared workspace, not an OS boundary against privileged maintainers.
Workspace operators must use accounts authorized for their intended workload.

Offline acceptance covers authentication boundaries, login races, owner paths,
pause/reconnect/disconnect, runtime admission, catalogs, policy application and
UI behavior. Live release acceptance additionally requires the image-built SDK
adapter and CLI, remote browser code entry without a callback, two simultaneous
personal accounts, separate Team/Background accounts, key billing selection,
streaming, MCP tools, resume and manual/scheduled executions. Synthetic tests
and CLI help checks do not establish live provider compatibility.

Operators build and promote an immutable image digest, back up native state,
and restart workspace and control plane together. No host mutations or live
provider requests are part of repository validation. Rollback retains credential
directories and restores configuration and policy backups together; do not drop
credentials or policy state automatically.

References: [Claude authentication](https://code.claude.com/docs/en/authentication),
[OpenClaw CLI backend plugins](https://docs.openclaw.ai/plugins/cli-backend-plugins),
[Hosted Claude Code](https://code.claude.com/docs/en/legal-and-compliance).
