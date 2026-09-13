# Sharing and privacy

A Neural Labs instance is one shared development environment. It works for a
single owner or mutually trusted teammates. Separate instances or virtual
machines are needed for people who must not be able to inspect each other's
workspace files or credentials.

## What is personal and what is shared?

| Item | Who can access it through the app? | What to keep in mind |
|---|---|---|
| Private Neura chat and personal AI connection | The owning user | Workspace administrators with filesystem/root access remain in the same OS trust domain |
| Team Chat history | Current channel members | Everyone channels also include newly approved users |
| Files, projects, and Trash | All approved workspace users | A restricted chat's uploaded attachment can still be in shared Files |
| Personal Terminal | Its owner | Commands run in the shared container; a personal tab does not create a private filesystem |
| Team Terminal | All approved users, or the parent chat's members for a channel terminal | Participants share input and output |
| Personal skills | Managed by their owner through the app | Stored in the shared persistent home; personal scope does not encrypt their files |
| Team skills | Available to the workspace | Writable Team packages can also be managed by administrators; bundled/plugin sources remain protected |
| Builder drafts | Owner, invited collaborators, and administrators | Shared tests expose their visible results to draft collaborators |
| Desktop layout | Per user and browser profile | Clearing site data resets layout without deleting server data; Files pins are separately synced |
| Phone number and sign-in methods | The owner through account APIs | Stored account data and backups are also accessible to database operators |

## Files, previews, and attachments

Saving a chat attachment with **Download to Workspace** places it in shared
Files. Downloading to your computer is a separate action. Private generated
media requires a short-lived ticket tied to its owning conversation; that does
not make a copy saved into the workspace private.

Static website previews and Image Editor use isolated browser frames. Website
preview links are temporary capabilities, not public hosting URLs. VS Code is
embedded in the desktop's origin and shares settings and extensions across the
workspace. Only install extensions you trust with this environment.

Files normally moves deletions and replaced items to shared Trash for 90 days.
Any approved member can restore or permanently delete them. Permanent deletion,
expiry, and filesystem deletion outside Files require a backup for recovery.
See [Files](files.md) for the exact recovery behavior.

## AI account and terminal access

Personal, background, and dedicated Team accounts have separate routing rules.
The audio API key is not a text-model fallback. See
[AI accounts and models](ai-accounts.md) before connecting a shared account.

Neura's terminal participation controls determine which output it receives and
whether it can type. Review the selected mode before working with sensitive
terminal content. **Draft plan** in Neura asks for a plan; it does not restrict
tools or enforce an approval boundary. See [Terminal](terminal.md) and
[Neura](neura.md) for these controls.

## Host and administrator access

The workspace can use passwordless sudo inside its container. It has no Docker
socket, host home mount, privileged mode, or host namespaces. Application HTTP
and Gateway ports bind to loopback and are reached through Nginx session checks.
PostgreSQL is not published to the host. The separately configured TURN relay
carries voice traffic; its deployment is described in the
[network settings](container-deployment.md#voice-relay-and-network-settings).

Host operators and Docker administrators can inspect deployment secrets and
must be trusted with them. Keep `.env`, provider credentials, certificates,
workspace state, and backups out of Git. Shared skill mounts remain read-only;
personal skills belong inside the persistent workspace home.

Public MCP and OAuth discovery routes are disabled in this deployment. Enabling
Microsoft web login does not expose workspace tools on the internet.

The [maintainer reference](maintainer-reference.md) links to the historical
architecture decisions behind these boundaries.
