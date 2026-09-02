# Neural Labs

Neural Labs is an open-source, self-hosted control plane and authenticated MCP
server. This repository contains:

- `web/`: the public landing page;
- `console/`: the React account, login, signup, and approval interface;
- `control-plane/`: onboarding, session security, authorization, and console
  APIs;
- `mcp/`: the Microsoft Entra-protected Streamable HTTP MCP server;
- `workspace/`: the shared desktop plus the pinned OpenClaw and Codex developer
  runtime, including the Neura agent and persistent Files apps;
- `deploy/`: loopback-only Compose and host Nginx configuration;
- `wiki/`: setup, operations, security decisions, and recovery runbooks.

Start with the [container deployment guide](wiki/container-deployment.md), then
follow the [manual Entra app setup](wiki/entra-app-setup.md) if Microsoft sign-in
or authenticated MCP access is required.

```bash
bin/neural-labs init
# Edit the single root .env, including NEURAL_LABS_INITIAL_ADMIN_EMAIL.
bin/neural-labs up
```

Use `bin/neural-labs help` for status, logs, health checks, safe updates,
backups, and shutdown. Compose remains the deployment source of truth.

Approved users share one persistent, always-on workspace. After the stack is
started, an administrator opens the dock's **Settings** app and connects the
shared OpenClaw runtime to a ChatGPT/Codex subscription from its Workspace
section; see the [workspace guide](wiki/shared-workspace.md). The
[administrator settings guide](wiki/desktop-settings.md) covers access,
authentication, MCP, and audit controls.
The [Files guide](wiki/files.md) documents browser uploads, folder management,
downloads, deletion, and the shared-filesystem boundary. The
[Editor guide](wiki/editor.md) covers shared text-file creation, editing,
version-aware saves, and conflict handling.
The [Automations guide](wiki/automations.md) covers the administrator-only
OpenClaw scheduler app and its dedicated trusted-proxy boundary.
The [Skills guide](wiki/skills.md) covers the live OpenClaw catalog, Skill
Workshop, ClawHub discovery, and the developer-read/administrator-write split.

Never place tenant credentials, certificates, deployment secrets, or database
backups in the repository.
