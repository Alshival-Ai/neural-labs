# ADR 0011: Direct personal and team skills

- Status: Accepted
- Date: 2026-09-02
- Supersedes: ADR 0006 for first-party skill authoring

## Context

The Workshop-first Skills UI required administrators to create, evaluate, and
apply proposals for every reusable instruction. That lifecycle was appropriate
for an untrusted shared catalog but made ordinary personal customization hard
to understand. Neural Labs already operates as one trusted, shared developer
environment in which approved users can edit workspace files and run shells.

OpenClaw 2026.8 exposes agent-scoped catalog reads but no user- or
session-scoped skill install target. Personal behavior therefore cannot be
implemented by pretending each web account has a separate OpenClaw agent.

## Decision

Let every active workspace developer directly create and edit skills they own.
Store personal skills under the persistent tenant home at
`/home/node/.agents/skills` and Team Skills under
`/home/node/workspace/skills`. Store Neural Labs ownership and scope metadata
beside each managed skill.

Personal skills are user-invocable but set `disable-model-invocation: true`.
The Neura picker combines OpenClaw status with the authenticated user's Neural
Labs ownership records and excludes other users' personal skills. Team Skills
are model-visible and available to every user.

Treat “personal” as a default-attachment and edit-authorization boundary, not
a confidentiality boundary. Approved developers share the tenant home and may
inspect another user's files through that shared development environment.

Accept skill mutations only through authenticated workspace ingress, derive
the actor from the proxy-asserted user header, require same-origin writes, use
generated safe directory names, refuse symbolic-link traversal, and reject
obvious credential material.

Keep ClawHub installation on the administrator Gateway. It remains a
third-party instruction supply-chain mutation requiring `operator.admin`.

## Consequences

- Personal and first-party Team Skills no longer require proposal approval.
- Skill owners can share with the team or return a skill to personal scope in
  one step.
- Other users do not see personal skills in their Neura picker by default, but
  the shared filesystem does not promise secrecy.
- Name collisions are workspace-wide because OpenClaw skill keys share one
  effective catalog.
- The older proposal methods remain available in OpenClaw for advanced or
  externally sourced governance, but the Neural Labs desktop does not expose
  them as the normal authoring path.
