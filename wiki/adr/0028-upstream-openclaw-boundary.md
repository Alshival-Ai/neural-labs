# ADR 0028: Unmodified upstream OpenClaw runtime

Date: 2026-09-06

Status: Accepted; deployed on 2026-09-06; upgraded from OpenClaw 2026.8.2 to 2026.9.2.

## Context

Neural Labs' pending native-planning feature rebuilt OpenClaw from source with a
downstream patch and overlaid its compiled bundles. That patch failed to apply
against 2026.9.2 in twelve files. The image also replaced OpenClaw's managed Codex
launchers with the independently installed terminal CLI. These changes made an
upstream update depend on maintaining private runtime and protocol contracts.

## Decision

Inherit OpenClaw from an official image pinned by digest. Keep its complete
`/app` tree unchanged, including compiled code, extensions and managed binaries.
Do not fetch, patch or rebuild upstream source in the Neural Labs Containerfile.
The release manifest must have an empty patch inventory. Offline validation
rejects source patches and explicit runtime modifications; an operator image
comparison checks the resulting tree before promotion.

Neural Labs owns the desktop, HTTP adapters and provisioning under
`/usr/local/lib/neural-labs`, its static assets under `/usr/local/share/neural-labs`,
its MCP tools, and public OpenClaw configuration. Integrate through published
Gateway packages, public CLI operations and supported plugin/skill mechanisms.
The config adapter uses `openclaw config set --batch-json`; it does not import
hashed private bundles. Read-only discovery of upstream skills/extensions and
the upstream Docker health check do not modify the runtime.

The terminal Codex CLI is a separate tool with its own version pin and account
cache. OpenClaw selects its own bundled Codex by default. If an upstream image lacks
its native app-server executable, an operator may install the exact upstream
app-server package separately in persistent workspace storage and select it with
the supported plugin command setting. This must preserve `/app` and the separate
terminal CLI; verify a real personal-agent reply and record the recovery in the
[upgrade guide](../openclaw-upgrades.md). Startup verifies the terminal CLI
separately and identifies the model catalog's runtime as OpenClaw.

Private-chat drafting is an application workflow over ordinary `chat.send`
messages. The composer does not write custom session collaboration fields or
private implementation-handoff parameters. The drafting choice is local to the
tab and session; plan presentation can be reconstructed from saved messages.
Existing proposed-plan signatures remain readable. Upstream question APIs stay
available independently of the drafting selection.

## Trust and behavior

Drafting is an advisory request to propose work before implementation. It is
**not** native Codex Plan mode, a tool restriction or a server-enforced approval
boundary. The UI states that tool permissions remain the same. Implement plan
submits the selected plan as an ordinary user message. Existing access checks,
tool approvals, private account ownership, session isolation and SMS policies
remain in force. No new mount, ingress or credential-sharing boundary is added.

For 2026.9.2, explicitly keep `tools.sessions.visibility: "tree"`,
`tools.agentToAgent.enabled: false`, and `tools.swarm.enabled: false`. Upstream
now broadens these defaults; Neural Labs retains its existing session-tool
boundary and channel-scoped Team MCP collaboration. Browser roles still require
the owned agent and `sessions.others: "none"`. Auth checks continue to require
the exact personal OAuth profile in its agent-local store; an inherited main
profile or a fresh agent's shared-store display path is not a personal login.

SMS installation must have an official, exact-version npm install record.
Matching package code installed from a local path does not grant the upstream
trusted ingress capability. Startup checks public `plugins inspect` metadata
and uses the official npm installer when that record is absent or mismatched.

## Consequences

Updating OpenClaw no longer requires rebasing source patches or rebuilding its
runtime. Browser client/protocol and SMS package versions still need alignment,
and public interfaces, account ownership, access defaults and state migrations
still require candidate tests. The 2026.9.2 credential-store migration and new
agent-tool defaults passed the recorded acceptance checks; unchanged upstream
files alone do not prove compatibility with future releases. See the [upgrade guide](../openclaw-upgrades.md).
