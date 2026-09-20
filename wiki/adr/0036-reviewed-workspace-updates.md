# ADR 0036: Admin policy and reviewed workspace updates

Date: 2026-09-19. Status: accepted; host bootstrap is an explicit operator action.

## Decision

Settings → Updates stores an administrator's policy and revision in PostgreSQL.
OpenClaw automatic installation defaults off. Terminal Codex imports the existing
environment default once, then follows the saved policy. Turning Codex updates
off retains the selected executable. Its app-server is a separate, image-pinned
installation selected through OpenClaw's public plugin configuration.

A root-owned host worker accepts only reviewed releases from the Neural Labs
GitHub repository. It verifies both the manifest and immutable image with GitHub
artifact attestations, including the exact signing workflow, tag, source commit,
and hosted-runner requirement. Publication requires the `workspace-releases`
environment's required-reviewer rule and migration/restore tests. Matching host
and control-plane fingerprints are required for automatic workspace deployment.
Changes outside this compatibility boundary require an operator upgrade.
OpenClaw’s native automatic updater is explicitly disabled; the host worker owns
automatic OpenClaw activation.

The worker has a dedicated bearer token for update coordination. The workspace
receives only its existing workspace-control token, which may read policy and
report terminal Codex status. Browsers cannot submit image names, URLs, shell
commands, or deployment descriptors. Administrative writes use membership,
role, CSRF, same-origin, optimistic revision, and audit controls.

## Trust boundary

Docker remains exclusively on the host. A host TCP maintenance proxy owns the
existing loopback workspace ports and forwards them to separate loopback backend
ports. It preserves the original trusted host hop, closes existing connections
when gated, and fails closed on missing or invalid gate state. No host socket,
root filesystem, host home, or another workspace's state is mounted in a tenant.
The root-owned deployment descriptor stays outside the repository.

The default OpenClaw window is Sunday 03:00–05:00 America/Chicago. Administrators
may edit days, local start/end, and IANA timezone. Windows must end on the same
day. Scheduling walks UTC instants through the timezone to handle DST. Manual
installation bypasses the window but requires an idle workspace. Open terminals,
editor connections, active writes, file jobs, chat/cron runs, team runs, and
notification sends prevent cutover. Unavailable activity reporting is not idle.

The control plane gates new work before host ingress and workspace schedulers
are paused through the public global cron setting, preserving individual jobs
and including system-owned monitors. The worker checks activity again, stops the workspace, retains an
archive and originals for all three named volumes, and starts the candidate on
clones. Quiet startup disables native channels, cron, provider startup work,
Gmail watchers, and every configured heartbeat before the Gateway starts.
Runtime probes check version, public RPC activity contracts and integration/
isolation configuration. Native migration, ownership, role and SMS contracts are
also exercised against synthetic state before a release can be published.

Before the durable commit decision, failure returns to the prior image and
original volumes. After that decision, recovery uses the candidate; it never
rewinds newly accepted writes. A normal restart keeps heartbeat and scheduler
ledgers paused until explicit activation. The control plane then admits work
before schedulers resume, so notification callbacks can be accepted. An
interruption during activation retains the selected volumes and requires
operator recovery instead of restarting potentially active work. Unverifiable recovery leaves ingress and control
plane gates closed. Automatic recovery never restores the control-plane database.
Failed releases are held from automatic retry. Backups and old volumes are
retained indefinitely in this first version; capacity checks block new updates
instead of deleting recovery data.

## Operational consequences

An operator must prepare and activate the host services, configure release
reviewers and registry access, and publish a first reviewed release. Repository
validation performs no host installation, registry publication, or production
container changes. See [the operator guide](../workspace-updates.md) for bootstrap,
recovery and the separate Docker rehearsal command.
