# ADR 0035: Optional automatic updates for terminal Codex

Date: 2026-09-19. Status: accepted.

## Context

The operator requested current Codex releases without rebuilding and restarting
the shared workspace for each terminal CLI update. OpenClaw separately requires
a compatible managed app-server, which must not follow the terminal release.

## Decision

Keep the exact terminal fallback pin in the release manifest and image, with its
startup version check. An operator may enable `NEURAL_LABS_CODEX_AUTO_UPDATE=true`
to check the official npm registry's stable Codex release once daily. A workspace
timer checks when due; failed attempts retain the current executable.

Install each candidate in a separate persistent directory under
`/home/node/.local/share/neural-labs/codex-terminal`. npm receives a minimal
environment, isolated HOME and cache, no user/global npm configuration, disabled
lifecycle scripts, and the explicit public registry. npm verifies package
integrity. Execute the candidate's version probe before atomically activating
its symlink. Keep previous installations for active processes and recovery.

Only workspace terminal PATH includes the launcher. OpenClaw's `/app`, its
app-server command, and the image's `/usr/local/bin/codex` remain independently
managed. New CLI launches select the activated version; running sessions retain
their existing executable. Workspace status reports the selected terminal
version. Disabling the setting retains the selected installation and stops future checks.
[ADR 0036](0036-reviewed-workspace-updates.md) supersedes the environment-only
policy with administrator settings stored in the control plane.

## Consequences

This opt-in trusts future stable official Codex npm releases without a workspace
image review. Version verification checks that the executable starts and matches
the requested version; it is not a full behavioral compatibility test. The
installation runs as the existing workspace user and grants no additional host
access. Personal login/configuration state is never copied into update probes.
Disk retention is explicit: old versions are not automatically removed.

Repository validation performs no registry requests, container operations or
host changes. Enabling updates is a separate deployment environment change.
