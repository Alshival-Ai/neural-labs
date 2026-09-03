# ADR 0012: Collaborative skill builder and automation read model

- Status: Accepted
- Date: 2026-09-03
- Extends: ADR 0011 and ADR 0005

## Context

Direct `SKILL.md` creation made first-party skills easier to understand, but it
could not represent a complete Codex skill package, preserve unpublished work,
or let two developers edit safely at the same time. The separate Automations
app also split two closely related ideas: reusable agent workflows and the
schedules that invoke them.

Automation names, enablement, schedules, and run status are useful shared
operational state. Command, script, payload, working-directory, tool, model,
and delivery-target configuration remains administrator material because it
can describe unattended execution and internal destinations.

## Decision

Make Skills the canonical desktop app for reusable workflows. Its navigation
contains My Skills, Team Skills, Drafts, Automations, and OpenClaw. Retain the
Automations dock icon as a shortcut that focuses the Skills window's
Automations section instead of creating a second app instance.

Store unpublished skill and automation drafts below the persistent tenant
state directory. A draft manifest contains ownership and collaborator IDs;
editable fields, package text, shared test history, and status use a persisted
Yjs document. Draft WebSockets require authenticated proxy identity, the exact
configured origin, a dedicated subprotocol, and draft access. The owner chooses
collaborators. Every administrator can inspect and edit every draft. A skill
draft may be published by its owner or an administrator; an automation draft
may be published only by an administrator.

Treat `SKILL.md` as the canonical skill instruction source while keeping the
graphical identity fields synchronized with it. Support `agents/openai.yaml`,
`references/`, `scripts/`, and `assets/`. Use only the canonical `$skill-name`
shortcut. A published slug is immutable. Owners edit Neural Labs-managed skills
directly; other skills are duplicated into a new personal draft.

Test an unpublished skill by sending an immutable inline package snapshot to a
new private Neura session. Persist test summaries in the shared draft, display
agent steps compactly, and let only the initiating user resolve approvals or
stop that run. Testing does not install the draft into the effective catalog.

Expose operational automation state to every active workspace user through the
ordinary `operator.read` Neura connection. Before rendering that state for a
non-administrator, replace payload content and remove condition scripts,
working directories, tools, model/thinking settings, agent identity, delivery
targets, token usage, and errors. All scheduler mutations and unredacted reads
continue through the administrator-only connection established by ADR 0005.

Do not add a public port or widen the ordinary Neura connection's scopes.

## Consequences

- Developers can build a complete skill package without losing access to raw
  source or creating half-written catalog entries.
- Character-level concurrent edits converge instead of overwriting an entire
  document with the last save.
- Draft collaboration is an authorization boundary in the app and API, but it
  is not a confidentiality boundary against approved users with shared-host
  filesystem access.
- Regular users can understand whether team automations are healthy without
  receiving the configuration needed to reproduce or redirect them.
- Administrator publication remains the execution boundary for automations.
- The new draft state needs the existing persistent tenant home during backup
  and restore.
