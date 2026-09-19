# Maintainer reference

User documentation starts with [Quick setup](README.md) and the
[guide directory](navigation.md). This page holds implementation history,
project planning, and documentation maintenance.

## Maintain the documentation

Edit the task guide when behavior changes. Add an architecture decision when a
trust boundary or significant design choice changes; avoid a new ADR for a
routine UI adjustment or bug fix. Keep dated validation evidence in a release
or upgrade record. Readers should not need an ADR to complete a user task.

- [Publishing the wiki](wiki-publishing.md)
- [Documentation audit and follow-ups](documentation-audit.md)
- [Release history](release-history.md)
- [Roadmap](../roadmap.md) and [work tracker](../tracker.md)
- [Web frontend development](web-frontend.md)

## Historical and future references

- [Retired Editor](editor.md): VS Code is the current source editor.
- [Standalone web deployment transition](web-deployment.md): use Compose for new deployments.
- [Future public MCP](mcp-entra-oauth.md): not exposed by the supported stack.
- [Site-generation workflow history](reference/site-generation-history.md): optional workflow and deployment notes, separated from general Automations help.

## Architecture decision history

These records explain why decisions were made. Their dates, original UI names,
and superseded implementation details remain historical. The **Current guide**
column below is the source for present-day instructions. “Accepted” records can
contain details amended by later records; it does not mean every original
sentence still describes the current runtime.

We retain the records and their URLs for security/design traceability. In
particular, shared workspace trust, ingress authorization, credential ownership,
and media isolation remain useful decisions even after the UI changes.

Known amendments: 0002's admin console moved into the desktop in 0004; 0003's
shared chat/account and permanent-delete behavior was amended by later privacy,
account, and Files work; 0006's authoring restrictions were superseded by 0011;
0013's Team account routing was amended by 0023; 0023's runtime replacement and
API-key text-account decisions were superseded by 0028 and 0032; 0033's September
12 amendment permits member manual AI runs while schedule management stays admin-only.

### Deployment and access

| Decision record | Current guide |
|---|---|
| [ADR 0001: Containerize application services behind loopback ingress](adr/0001-loopback-web-ingress.md) | [Deploy your Neural Labs instance](container-deployment.md) |
| [ADR 0002: Embed the control-plane console](adr/0002-embedded-control-plane-console.md) | [Authentication and administrator model](authentication.md) |
| [ADR 0003: Use one shared developer workspace](adr/0003-shared-developer-workspace.md) | [Sharing and privacy](sharing-and-privacy.md) |
| [ADR 0004: Move administrator settings into the workspace desktop](adr/0004-desktop-admin-settings.md) | [Settings](desktop-settings.md) |
| [ADR 0009: Run provider MCP inside the trusted shared workspace](adr/0009-workspace-local-provider-mcp.md) | [Workspace-local provider MCP](workspace-provider-mcp.md) |
| [ADR 0014: Microsoft-bootstrapped passkeys](adr/0014-microsoft-bootstrapped-passkeys.md) | [Passkeys](passkeys.md) |

### AI accounts and conversations

| Decision record | Current guide |
|---|---|
| [ADR 0007: Make Neura conversations private by default](adr/0007-private-neura-sessions.md) | [Neura desktop app](neura.md) |
| [ADR 0008: Store Team Chats as explicit control-plane channels](adr/0008-explicit-team-chat-channels.md) | [Team Chats](team-chats.md) |
| [ADR 0013: Bind interactive Neura to personal OpenAI accounts](adr/0013-personal-neura-openai-accounts.md) | [AI accounts and models](ai-accounts.md) |
| [ADR 0018: Relay generated Neura media with short-lived capabilities](adr/0018-private-neura-generated-media.md) | [Neura desktop app](neura.md) |
| [ADR 0019: Scope Neura voice by private and team chat boundaries](adr/0019-neura-openai-voice.md) | [AI accounts and models](ai-accounts.md) |
| [ADR 0020: Isolated managed browser for Neura QA](adr/0020-neura-managed-browser.md) | [Neura desktop app](neura.md) |
| [ADR 0023: Scoped model connections and versioned workload defaults](adr/0023-model-provider-policies.md) | [AI accounts and models](ai-accounts.md) |
| [ADR 0026: Explicitly save chat attachments into the shared workspace](adr/0026-chat-attachment-workspace-saves.md) | [Files desktop app](files.md) |
| [ADR 0028: Unmodified upstream OpenClaw runtime](adr/0028-upstream-openclaw-boundary.md) | [Updating the OpenClaw runtime](openclaw-upgrades.md) |
| [ADR 0032: Restrict the workspace OpenAI API key to audio](adr/0032-audio-only-workspace-api-key.md) | [AI accounts and models](ai-accounts.md) |

### Files, terminals, and desktop

| Decision record | Current guide |
|---|---|
| [ADR 0010: Embed code-server in the authenticated desktop](adr/0010-embedded-vscode.md) | [VS Code desktop app](vscode.md) |
| [ADR 0015: WebRTC Team Terminal voice](adr/0015-team-terminal-webrtc-voice.md) | [Terminal desktop app](terminal.md) |
| [ADR 0016: Scope Team Chat terminals to channel membership](adr/0016-team-chat-scoped-terminals.md) | [Terminal desktop app](terminal.md) |
| [ADR 0017: Launch static-site previews inside the authenticated desktop](adr/0017-private-desktop-site-previews.md) | [Files desktop app](files.md) |
| [ADR 0021: Recoverable Files operations and isolated image editing](adr/0021-files-explorer-image-editor.md) | [Files desktop app](files.md) |
| [ADR 0025: Neura participation in interactive terminals](adr/0025-neura-terminal-participation.md) | [Terminal desktop app](terminal.md) |
| [ADR 0027: Team Terminal GIF reactions and browser media access](adr/0027-team-terminal-reactions.md) | [Terminal desktop app](terminal.md) |

### Skills, automations, and integrations

| Decision record | Current guide |
|---|---|
| [ADR 0005: Give the desktop Automations app a dedicated admin ingress](adr/0005-admin-gated-automations-ingress.md) | [Run and manage automations](automations.md) |
| [ADR 0006: Split Skills reads from administrator mutations](adr/0006-skills-permission-split.md) | [Skills and graphical builder](skills.md) |
| [ADR 0011: Direct personal and team skills](adr/0011-direct-personal-and-team-skills.md) | [Skills and graphical builder](skills.md) |
| [ADR 0012: Collaborative skill builder and automation read model](adr/0012-collaborative-skill-builder-and-automation-read-model.md) | [Skills and graphical builder](skills.md) |
| [ADR 0022: Private profile phone verification](adr/0022-profile-phone-verification.md) | [Settings](desktop-settings.md) |
| [ADR 0024: Global Twilio SMS/MMS channel](adr/0024-twilio-sms-channel.md) | [Settings](desktop-settings.md) |
| [ADR 0029: Settings-managed provider credentials](adr/0029-settings-provider-credentials.md) | [Workspace-local provider MCP](workspace-provider-mcp.md) |
| [ADR 0030: Preference-aware automation notifications](adr/0030-automation-notification-subscriptions.md) | [Run and manage automations](automations.md) |
| [ADR 0031: Authorized saved-item context actions](adr/0031-skill-context-actions.md) | [Skills and graphical builder](skills.md) |
| [ADR 0033: Personal accounts for manual automation runs](adr/0033-personal-manual-automation-runs.md) | [Run and manage automations](automations.md) |
| [ADR 0034: Owner-scoped Claude connections](adr/0034-claude-account-connections.md) | [AI accounts and models](ai-accounts.md) |
