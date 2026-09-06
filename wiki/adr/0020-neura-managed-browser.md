# ADR 0020: Isolated managed browser for Neura QA

## Status

Accepted

## Context

Neura can build and repair websites in the shared workspace but could not
verify them in a real browser because the workspace image contained neither a
Chromium executable nor an enabled OpenClaw browser tool. Installing a browser
interactively would disappear on the next workspace replacement. Attaching to
a developer's personal browser would also expose unrelated cookies and signed-
in sessions to agent activity.

Website QA commonly targets both public deployments and a preview server
started on loopback inside the workspace container. OpenClaw blocks private-
network browser navigation by default, so unrestricted private-network access
is unnecessary and would widen the agent's reach beyond that requirement.

## Decision

Install Debian Chromium and web-font packages in the versioned workspace image.
Enable OpenClaw's bundled browser plugin and add its `browser` tool to the
workspace tool profile. Use the isolated, headless `openclaw` profile with the
explicit `/usr/bin/chromium` executable. The container boundary is relied on
for process isolation, so Chromium starts with `noSandbox` in the same manner
documented for containerized Linux browser runtimes.

Retain OpenClaw's SSRF policy and add only exact `localhost` and `127.0.0.1`
hostname exceptions for workspace-local preview servers. Do not enable broad
private-network navigation, a remote CDP endpoint, the user's existing-session
profile, or a new browser control listener.

## Consequences

- Browser support survives normal image rebuilds and workspace replacement.
- Private and Team Neura runs can use deterministic tabs, snapshots,
  screenshots, interaction actions, browser errors, and request inspection.
- Browser state belongs to the dedicated OpenClaw profile and does not reuse a
  teammate's host-browser identity or cookies.
- Agent-driven browser navigation cannot reach arbitrary Compose, LAN, host, or
  metadata-service addresses. Loopback services inside the workspace container
  remain reachable because that is required for local QA and the agent already
  has shell and filesystem access within the same trust boundary.
- The workspace image becomes larger and Chromium updates require rebuilding
  the image from current Debian repositories.
