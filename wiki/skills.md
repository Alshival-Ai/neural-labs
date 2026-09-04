# Skills and graphical builder

Skills is the canonical desktop app for reusable Neura workflows and the
automations that run them. It has five sections:

- **My Skills** contains managed skills owned by the signed-in developer.
- **Team Skills** contains skills available to everyone in the workspace.
- **Drafts** contains autosaved skill and automation work in progress.
- **Automations** shows the OpenClaw scheduler and durable run history.
- **OpenClaw** shows bundled, plugin, managed, and node-hosted skills and
  provides ClawHub discovery.

The Automations dock icon is retained as a shortcut. It focuses the existing
Skills window and selects Automations; it does not open a separate app.

## Graphical skill builder

Choose **+ Skill** to open a dedicated full-window builder. The metadata form
and raw package source are two views of the same collaborative document.
`SKILL.md` remains canonical. The package browser supports:

- `SKILL.md` instructions and frontmatter;
- `agents/openai.yaml` display metadata, icons, default prompt, invocation
  policy, and MCP dependency declarations;
- text files below `references/` and `scripts/`; and
- uploaded binary files below `assets/`.

Edit unpublished package source in the builder's collaborative source view.
Those Yjs drafts are not ordinary workspace files; after publication, their
files can be opened from Files in VS Code.

Changes autosave to server-side draft state. They do not affect the live skill
catalog until an authorized user chooses **Publish**. Validation checks the
frontmatter, canonical name, default prompt, package paths and sizes, and
common credential shapes before publication.

The only generated shortcut form is `$skill-name`. It uses the lowercase,
hyphenated package slug. Once published, that slug cannot be renamed; duplicate
the skill to create a differently named package.

Owners can edit Neural Labs-managed skills directly. A read-only, unmanaged,
system, or other-owner skill offers **Duplicate to My Skills**, creating an
independent personal draft.

## Collaboration and testing

The draft owner selects up to 50 collaborators. Collaborators receive
character-level Yjs updates, live presence, current-file selection, and shared
test history over the authenticated builder WebSocket. Every administrator can
inspect all drafts so operational work cannot be hidden from workspace
administration.

The owner or an administrator can publish a skill. Only an administrator can
publish an automation.

**Test in Neura** validates the current draft, takes an immutable snapshot, and
runs that snapshot in a new private Neura session without installing it. The
test panel shares compact thinking/tool/command steps and the final result with
draft collaborators. Only the initiating developer can resolve that test's
approval prompt or stop it.

## Automation builder

Administrators can choose **+ Automation** from Skills. Automation drafts use
the same autosave, collaboration, validation, and explicit-publish lifecycle as
skills. The action picker includes **Run a skill**: selecting `release-notes`
creates an agent-turn payload beginning with `$release-notes`, followed by the
optional prompt.

Every active user can read operational automation names, schedules, enabled or
running state, and run outcomes. The regular-user view removes commands,
scripts, payloads, conditions, working directories, tool/model settings,
delivery targets, errors, and usage details. Administrator reads and every
scheduler mutation continue through the administrator-only Gateway connection.

## Storage and trust boundary

Published personal skills live under `/home/node/.agents/skills`; Team Skills
live under `/home/node/workspace/skills`. Drafts live under
`/home/node/.local/state/neural-labs/builder-drafts`. These paths are inside the
persistent tenant home and should be included in normal tenant backups.

“Personal” and draft collaboration are default-attachment and API
authorization boundaries, not confidentiality boundaries. Approved developers
share the tenant filesystem and may inspect files with the shared terminal.
Never put tenant credentials, provider keys, customer secrets, certificates,
or private keys in a skill or automation. Credential scanning is a backstop,
not a secret-management system.

Requests derive their actor from the identity asserted by the control plane
through Nginx. Writes require the configured same origin. The builder socket
also requires the dedicated WebSocket subprotocol and draft authorization.
There is no new public port.

See [ADR 0012](adr/0012-collaborative-skill-builder-and-automation-read-model.md)
for the collaboration and automation-read decision and [ADR 0011](adr/0011-direct-personal-and-team-skills.md)
for the published-skill ownership model.
