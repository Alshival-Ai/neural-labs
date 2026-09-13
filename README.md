# Neural Labs

Neural Labs is an open-source, self-hosted desktop for working with AI. Run your
own instance with Neura, Files, Terminal, VS Code, reusable skills, and scheduled
automations, or invite trusted teammates into the same persistent workspace.

**[Set up your instance](https://github.com/Alshival-Ai/neural-labs/wiki)** ·
[Browse the guides](wiki/navigation.md) · [Changelog](CHANGELOG.md)

## Get started

The [quick setup](wiki/README.md) walks through host prerequisites, configuration,
HTTPS, administrator signup, connecting your ChatGPT account, and a first Neura
request. Deployment uses Docker Compose behind host Nginx.

From a checkout on a prepared host:

```bash
bin/neural-labs init
# Edit .env: hostname, HTTPS origin, administrator email, and TURN addresses.
bin/neural-labs up
```

Continue with the [HTTPS and account setup steps](wiki/README.md#4-enable-https).
The commands above do not install Nginx or configure DNS and certificates.
Microsoft sign-in and provider integrations are optional.

If your instance is already running, follow [Your first workspace session](wiki/shared-workspace.md).
Administrators can use [Manage your instance](wiki/manage-instance.md) for user
approval, integrations, updates, and backups.

Approved users share one container and filesystem. Personal chat and account
controls provide application authorization, not operating-system isolation from
other trusted developers. Read [Sharing and privacy](wiki/sharing-and-privacy.md)
before inviting users. Never commit credentials, certificates, deployment
secrets, or generated state.

## Repository layout

| Directory | Purpose |
|---|---|
| `web/` | Public landing page |
| `console/` | Login, signup, and account-approval interface |
| `control-plane/` | Accounts, sessions, authorization, and administration APIs |
| `workspace/` | Desktop and pinned OpenClaw/Codex developer runtime |
| `mcp/` | Workspace-local provider tools and retained future public MCP implementation |
| `deploy/` | Compose services and host Nginx configuration |
| `wiki/` | Documentation sources exported to the GitHub wiki |

Use `bin/neural-labs help` for lifecycle commands. Run `make validate` before
committing. Current release: **v0.3.2**; see [release history](wiki/release-history.md).
Project planning and architecture records are in the
[maintainer reference](wiki/maintainer-reference.md).
