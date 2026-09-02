# ADR 0009: Run provider MCP inside the trusted shared workspace

- Status: Accepted
- Date: 2026-09-01

## Context

Site-building agents need Google Places, Google Geocoding, and Pexels search
plus controlled media downloads. V1 is a trusted staff workspace: approved
users share files, the agent, and an intentionally unrestricted sudo boundary.
Publishing these provider tools through the retained Entra MCP would add an
unneeded network and authorization surface.

Downloaded media must persist with generated projects, remain attributable, and
be included in disaster recovery. Provider keys must remain outside this public
repository.

## Decision

Build the provider MCP into the workspace image and supervise it as a child of
the workspace entrypoint. Bind it to workspace loopback only and register it
automatically with the shared OpenClaw runtime. Make MCP readiness part of
workspace readiness and restart the container if the MCP exits.

Inject the existing Google and Pexels env files into only the workspace
container. Accept that all approved workspace users can reach the MCP and,
because they already have unrestricted sudo in this explicitly trusted
environment, can inspect its process environment.

Searches return bounded normalized results and required attribution. Pexels
downloads require a short-lived signed selection, accept only existing projects
below `/home/node/workspace/projects`, constrain output to
`site/assets`, reject symlink escapes and overwrites, cap bytes and content
types, install atomically, and write digest-addressed provenance.

Return `404` for all public MCP and OAuth paths. Disable the legacy host MCP
services and the separate Compose MCP service while retaining their code,
configuration, certificates, and Entra design for a future reviewed release.

## Consequences

- Provider tools and raw credentials are available to every approved workspace
  user; this is an explicit V1 trust decision, not tenant isolation.
- The provider MCP cannot be called directly from the public network.
- Projects, downloaded media, and provenance live in the workspace volume and
  are included in the existing backup archive until manually deleted.
- OpenClaw receives the MCP registration automatically; staff do not configure
  it per account.
- A future public MCP must re-evaluate tool authorization, rate limits,
  credential isolation, and download-write authority before provider tools are
  exposed.
