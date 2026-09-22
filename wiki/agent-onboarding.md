# Deploy Neural Labs with your agent

Give an agent with access to your intended host this repository and ask it to
deploy your own Neural Labs. The repository's [AGENTS.md](../AGENTS.md) contains
the deployment workflow and maintenance rules. The agent should handle host
preparation, configuration, deployment, and verification, then guide you through
the account steps that require your participation.

For example:

> Read AGENTS.md and deploy Neural Labs on the host available through my SSH
> alias `my-lab`. Use `https://lab.example.org` and `owner@example.org` as the
> initial administrator. This is a persistent installation. Inspect the host,
> preserve existing services and data, and complete the documented onboarding.
> Ask me for any missing access or deployment choices. Report what you verified
> and anything still waiting on me.

Replace those example values with yours. If you have not chosen a host or domain,
say so; the agent should help establish those choices before provisioning. Do
not include passwords, SSH private keys, or provider tokens in the prompt. Use
your agent's existing authorized connections and the product's account UI.

## What you are deploying

The Neural Labs project site is the entry point to the project. Your installation
is the complete product under your own HTTPS hostname, with its own landing page,
accounts, and workspace. You do not need to reuse the project's public domain or
its administrators' configuration.

| Component | Responsibility |
|---|---|
| Landing container | Public site and links to this instance's signup/login |
| Control-plane container | Account UI, authentication, approval, administration, and APIs |
| Workspace container | Desktop, Neura, files, terminals, editors, and persistent developer runtime |
| PostgreSQL container | Persistent account and control-plane data |
| TURN container | Relay for Team Terminal voice; currently included even for text-only setup |
| Host HTTPS ingress | Route requests and enforce authentication before workspace access |

The landing page can be customized independently. Preserve the instance's
signup/login links and proxy routes when replacing it. A working landing page
alone does not establish that accounts or the workspace are ready.

## Choose the destination once

The agent should reuse details already provided and inspect the target before
asking you to supply information it can discover. The choices it needs are:

| Choice | What the agent needs |
|---|---|
| Destination | Existing host/SSH alias, or hosting account and an agreed provisioning budget |
| Access | Public or private use, final hostname, and access to the appropriate DNS/TLS setup |
| Owner | Exact initial administrator email; you choose the password during signup |
| Lifetime | A persistent installation, or a disposable test with an explicit cleanup request |

Both public and private installations need an HTTPS origin trusted by their
clients. Private DNS and certificates must work on the devices that will use
the workspace. The agent must identify required manual DNS, certificate, or
provider-consent steps rather than pretending they happened.

## Match the platform to the deployment

The current deployment path is a Linux host with native containers, Docker
Compose, and host Nginx. That host may be a physical machine, an existing server,
or a cloud VM. Hosting location and CPU architecture are separate decisions.

| Target | Current path |
|---|---|
| Linux amd64 | Standard Compose deployment; managed updates have additional bootstrap and release requirements |
| Linux ARM64 | Native manual deployment; see the tested Pi setup and its limits |
| Other architectures, non-Linux hosts, or managed container platforms | Assess a compatible Linux VM or implement and test an adapter before claiming support |

Read the [Pi guide](raspberry-pi-deployment.md) and
[managed update runbook](workspace-updates.md) for their actual acceptance scope.
An ARM64 build does not establish ARM64 managed-update support. Check pinned
image availability and native tools before spending time on a build. Do not
substitute an unreviewed upstream image or enable emulation to conceal a missing
native image.

An alternative deployment adapter must preserve the complete application's
authentication routes, long-lived WebSocket/SSE connections, persistent workspace
and database storage, service isolation, and recovery procedure. Voice adds TURN
TCP/UDP requirements. A static-site host alone cannot run this package. The
current host updater also requires its documented systemd/Docker environment.
Changes to these boundaries need architecture review and an acceptance test on
the target, not just edits to agent instructions.

## Run setup through the first useful session

The agent follows [Quick setup](README.md) and
[Container deployment](container-deployment.md). It installs missing host tools,
sets resource limits from the actual machine, generates private instance secrets,
configures the final origin and administrator, starts all services, and sets up
authenticated HTTPS ingress. Existing installations require inspection and a
backup before replacement; they are not fresh-install test fixtures.

Once the instance is reachable, you:

1. Open the exact signup URL and use the configured administrator email.
2. Open the workspace and connect your personal AI account through Settings.
   Follow [AI accounts](ai-accounts.md) for the chosen provider and any interactive
   sign-in or consent steps.
3. Send a first Neura request and check its reply.

The agent should help complete these steps and resume verification afterward.
If it cannot access the browser or you are not ready to connect an account, it
must report the remaining step explicitly. Optional integrations can follow
later; a background account does not replace your personal connection.

## Define completion by evidence

The final handoff should be short and useful to the owner:

- The working instance URL and whether administrator signup and the first AI
  reply were verified or still need owner action.
- The target, architecture, source revision, and deployed image identifiers.
- Locations of private configuration and backups, without secret values.
- How to inspect status/logs, stop/start the stack, back up, and update through
  the supported method for that installation.
- Checks that passed, outstanding problems, and optional features not tested.

The agent verifies signed-out rejection and authorized access separately. It
checks all services, actual HTTPS requests, Files/Terminal, and an AI reply once
credentials are connected. It follows [Backup and restore](backup-restore.md),
using isolated synthetic state for a destructive recovery rehearsal rather than
rewinding a live workspace. Known [doctor and readiness caveats](troubleshooting.md)
must be explained without suppressing other errors.

For a persistent installation, leave the service running and retain recovery
information. For an explicitly disposable test, remove only resources introduced
by that test and verify cleanup against the original host inventory. A successful
installation is evidence for that target; release approval still requires the
release acceptance checks.
