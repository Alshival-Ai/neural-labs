# OpenClaw 2026.9.5 upgrade record

Deployed on 2026-09-19 from OpenClaw 2026.9.2. The official runtime and matching
Gateway client, protocol and SMS packages are pinned to 2026.9.5. The terminal
Codex CLI is independently pinned to 0.155.1. OpenClaw's Codex plugin expects
app-server 0.154.0.

## Release coordinates

- Upstream source: `ec9c1a13db8938e5a3eaa51fca2e981cde2395a9`.
- Official image: `ghcr.io/openclaw/openclaw:2026.9.5@sha256:ea298b62be8955d3ef750e2004a610dd90c3a30e5f9886e5d654d78a0c573218`.
- Image source label and `openclaw --version` agree with the release commit.
- The image provides Node 24.19.0, meeting the newer Node requirement.
- Its bundled Codex executable successfully reports 0.154.0.

## Compatibility review

Reviewed intervening 2026.9.3, 2026.9.4 and 2026.9.5 migration notes, including
Node support, SQLite/Doctor recovery, credential ownership, agent-owned Workshop
skills, scheduler behavior, plugin SDK changes and Gateway transport changes.
Neural Labs retains explicit session-tree isolation, disabled cross-agent tools
and disabled Swarm. Its Claude adapter uses the public plugin-entry and
provider-auth SDK interfaces, rather than the retired execution-policy helpers.

The earlier persistent Codex app-server override is a separate installation
outside `/app`; see the [recovery explanation](../openclaw-upgrades.md#sms-reply-recovery-on-202692).
It must match the new plugin's expected version when retained. The terminal CLI
version does not select OpenClaw's app-server.

The custom external app-server setup is retained using a versioned installation
at `/home/node/.local/share/neural-labs/codex-app-server-0.154.0`. The public
`plugins.entries.codex.config.appServer.command` setting points to its
`node_modules/.bin/codex`. The previous 0.153.4 directory is retained.

Daily stable terminal Codex updates are enabled through the separate opt-in
mechanism in [ADR 0035](../adr/0035-terminal-codex-automatic-updates.md). The
app-server does not automatically follow terminal CLI releases.

The deployed Neural Labs workspace image is
`sha256:90f45fa42cab9653c245ecbfe5d14646a9caad0328c071cddf6aba537b46301e`.

## Recovery

Previous deployment environment, release manifest and exact running image were
recorded outside the repository before deployment changes. The normal recovery
backup includes PostgreSQL and stopped-workspace state. Image rollback alone
does not reverse database migrations.

## Validation

- `make validate` passed with the new integration packages and auto-update tests.
- Public CLI dry-run, atomic-write and invalid-batch checks passed.
- Synthetic 2026.9.2 state migrated with owned credentials, auth order,
  transcripts, files and disabled schedules preserved. Cross-agent session
  access was denied; new agents did not inherit personal accounts, and logout
  preserved other owners.
- Restoring the synthetic backup under 2026.9.2 passed the preservation checks.
- Browser-role tests passed anonymous rejection, ownership, administrator
  access and pause/resume. The probe now retries the explicit startup-sidecar
  `UNAVAILABLE` response because liveness precedes connection readiness.
- The official SMS package installed at 2026.9.5 and rejected an invalid webhook
  signature with HTTP 403. No outbound SMS was sent.
- A real isolated terminal Codex auto-update installed and verified 0.155.1.
  Automated tests cover failed downloads, mismatched executables, concurrent
  checks, prerelease rejection, downgrade prevention and the pinned fallback.
- All 127,741 upstream `/app` entries match the official base; fingerprint
  `bcf4bcafa05a209f8756941fa9178807076fec349249cf2ef2bf4f1a68c3a9a5`.

## Live deployment checks

The deployment doctor passed all service, Gateway, desktop, MCP and loopback
binding checks. The replacement workspace became healthy with zero restarts.
Administrative RPC worked, SMS reported enabled/configured/running with no
channel error, and all 19 schedules remained visible, including 11 disabled jobs.
A private verification conversation using an owned personal OpenAI account
returned `UPGRADE_OK` through the running Gateway and custom Codex app-server.
No messaging-channel delivery was requested.

The daily terminal update check ran successfully. An interactive workspace shell
resolved the managed launcher and reported Codex 0.155.1. The image fallback and
custom app-server separately reported 0.155.1 and 0.154.0.

The forced main-agent Astra headless probe did not have a usable auth profile;
it is not claimed passed. A direct local personal-agent probe was refused because
the Gateway owned the active state directory. The successful live check above
used the running Gateway instead. No credential or permission policy was relaxed.

Upstream evidence: [2026.9.3 release](https://github.com/openclaw/openclaw/releases/tag/v2026.9.3),
[2026.9.4 changelog](https://github.com/openclaw/openclaw/blob/v2026.9.5/CHANGELOG/2026.9.4.md),
[2026.9.5 release](https://github.com/openclaw/openclaw/releases/tag/v2026.9.5),
[Codex dependency](https://github.com/openclaw/openclaw/blob/v2026.9.5/extensions/codex/package.json).
