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

Choose **New skill** to open a dedicated full-window builder. The metadata form
and raw package source are two views of the same collaborative document.
`SKILL.md` remains canonical. The Edit view groups Basics, Instructions, and
Availability before expandable Appearance and Advanced settings. Write the
instructions directly in the form; use Source for the package files. The
package browser supports:

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

Owners can edit their managed skills. Administrators can also edit packages
in the writable Team skill root, including installed packages without app
ownership metadata. Administrators cannot edit another user's personal skill
through this API. Bundled and plugin instruction roots remain read-only.

For a skill you cannot edit, use **Duplicate to My Skills** to make your own
copy, then edit it independently.

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

Administrators can choose **New automation** in the Automations section. Automation drafts use
the same autosave, collaboration, validation, and explicit-publish lifecycle as
skills. The sectioned editor groups Basics, What to run, When to run, and
Delivery, with execution settings under Advanced. Controls adapt to the selected
action and schedule while preserving hidden settings. The action picker
includes **Use a skill**: selecting `release-notes`
creates an agent-turn payload beginning with `$release-notes`, followed by the
optional prompt.

Every active user can read operational automation names, schedules, enabled or
running state, and run outcomes. The regular-user view removes commands,
scripts, payloads, conditions, working directories, tool/model settings,
delivery targets, errors, and usage details. Administrator reads and every
schedule-management mutation continue through the administrator-only Gateway
connection. Members can manually run eligible AI tasks through the authenticated
HTTP adapter using their own connected account; see [Automations](automations.md).

## Duplicate or delete a saved item

Right-click an item, use its **…** button, or press Shift+F10. Duplicating a
skill copies its supported package files with new personal ownership. Draft
copies are unpublished and have independent collaborators. Automation copies
are paused and omit subscribers and run history.

Delete requires confirmation. Owners can delete their own skill packages;
administrators can also delete writable Team packages. Bundled/plugin sources
and other users' personal packages remain protected from these administrator
API actions. Deleting a draft does not remove an already published skill.

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

## Kiki Models API skill

The Kiki deployment has an operator-installed `models-api` Team Skill, invoked
with `$models-api`. Its package lives in `/home/node/workspace/skills/models-api`
in the persistent workspace home; the operator copy is in `skills/models-api`
on the deployment host. Include both in deployment backups; the operator copy
is ignored by Git, as are other instance-specific skills.

The skill covers live model discovery, Nomic and Qwen embeddings, GPT OSS chat,
and Wan2.2 text-to-video and image-to-video jobs. Its Python helper handles bearer
authentication, JSON requests, saved video job IDs, and MP4 downloads.
For requests in Neura, the skill instructs the agent to attach the downloaded
MP4 to its final reply through OpenClaw’s native media directive. Neura then
shows inline playback and Download / Download to Workspace actions. The skill
also documents verification and the deployed 16 MiB outgoing video limit.

Configure `MODELS_API_URL` and a dedicated `MODELS_API_KEY` in the protected root
`.env`. Compose passes these into the workspace and OpenClaw agent environment;
recreate the workspace after changing them. The Kiki endpoint is
`http://192.168.10.113:8000`. Never copy the key into a skill, generated project,
browser code, or chat. The skill instructs agents to read live `/models` and
`/openapi.json` when checking current capabilities and limits.
