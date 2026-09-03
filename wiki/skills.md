# Skills desktop app

Skills gives each approved developer a small, direct library for teaching
Neura reusable ways of working. The app has three sections:

- **My Skills** are created by the signed-in developer and appear in that
  developer's Neura `$` picker. They save immediately and do not enter an
  approval queue.
- **Team Skills** are available to everyone using the shared workspace. A skill
  owner can move a personal skill here, or make it personal again, in one step.
- **OpenClaw** shows the bundled, plugin, managed, and node-hosted skills already
  available to Neura. It also searches ClawHub.

Creating or editing a Neural Labs skill writes its `SKILL.md` immediately.
Personal skills set `disable-model-invocation: true`, so they are explicit-use
skills and are removed from other users' Neura pickers. Team Skills set it to
`false` and are part of the shared agent catalog.

## Shared-development boundary

This deployment intentionally has one shared tenant home and one shared Neura
runtime. A personal skill is a usability and default-attachment boundary, not
a filesystem confidentiality boundary. Another approved developer can inspect
its files using the shared terminal or runtime access. They cannot edit or
promote it through the Skills API unless they own it or are an administrator.

Personal skills live in `/home/node/.agents/skills`, inside the persistent
tenant home. Team Skills live in `/home/node/workspace/skills`. Neural Labs
stores a small `.neural-labs.json` ownership record beside each skill it
creates. Unmanaged OpenClaw skills remain sourced from `skills.status`.

Never put tenant credentials, provider keys, customer secrets, certificates,
or private keys in a skill. The API rejects several obvious credential forms,
but that check is only a backstop.

## Authorization

Any active, authenticated workspace developer can create and edit their own
skills and share them with the team. Requests use the identity asserted by the
control plane through Nginx; client-supplied ownership is ignored. Writes also
require the configured same origin.

ClawHub installation remains administrator-only through the existing
administrator Gateway connection. Third-party installation crosses an
instruction supply-chain boundary and OpenClaw requires `operator.admin`.
Regular users can still search and inspect ClawHub results.

See [ADR 0011](adr/0011-direct-personal-and-team-skills.md) for the trust-boundary
decision. [ADR 0006](adr/0006-skills-permission-split.md) documents the previous
Workshop-first UI and remains useful history.

## Refresh behavior

The app combines the live OpenClaw catalog with the Neural Labs ownership
records. Skill events trigger a refresh and a 30-second reconciliation poll
catches filesystem changes. Newly saved skills are shown from the local record
even before OpenClaw's watcher has refreshed its effective catalog.

New Neura turns receive refreshed skills. Already-running turns keep the skill
snapshot they started with.
