# Skills and graphical builder

Skills holds reusable Alshival workflows and automations for Codex and Claude.

- **My Skills** contains your editable personal skills.
- **Team Skills** contains workspace-managed skills shared with everyone.
- **Library** contains read-only built-in and installed packages, including
  `deploy` and the website toolkit below, plus ClawHub discovery. Installed packages are already usable by the
  team; they do not need to be copied into Team Skills to run.
- **Drafts** contains autosaved work in progress.
- **Automations** shows the native scheduler and durable run history.
- **Proposal history** preserves earlier workshop records for administrators.

To adapt a Library skill, choose **Customize a copy**. The copy appears in
**My Skills**, where you can edit its instructions and publish changes. Choose
**Share with team** to put that copy in **Team Skills**. It has its own command;
the installed original stays available and can receive product updates without
overwriting your customization. Neither version can change hosting permissions,
workspace isolation, or administrator settings through skill instructions.

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

**Test in Alshival** validates the current draft, takes an immutable snapshot, and
runs that snapshot in a new private Alshival session without installing it. The
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

## Built-in deploy skill

The read-only `deploy` skill is installed with Neural Labs for both native providers.
See [Deployments](deployments.md) for publication, lifecycle controls, and hosting setup.

## Built-in website toolkit

Fresh installations include these read-only Library packages for both Codex and
Claude. Existing installations receive them with a normal runtime upgrade;
a source checkout update alone does not update a running container.

| Skill | Use |
| --- | --- |
| `site-generator` | Build or redesign a website from a brief, business or existing project |
| `local-business-website-builder` | Business-specific composition, useful content and conversion paths |
| `business-research-and-media` | Verify a selected business and inspect usable authentic media |
| `cinematic-interactions` | Implement selected scroll, pointer, text and media effects |
| `web-video-asset-preparation` | Prepare local video, posters and smooth-motion assets |

Examples:

```text
Use $site-generator to build a portfolio from the files in projects/portfolio.
Use $local-business-website-builder for the bakery described in my uploaded brief.
Add a reduced-motion-friendly horizontal gallery using $cinematic-interactions.
Generate a website that says Hello, World! and $deploy.
```

No Maps listing, public domain or paid media key is required for basic website
creation. Research uses available sources and records gaps. Image generation is
optional and requires a separately available configured tool and user request;
a model connection does not supply it. Supplied assets, licensed media and original
layout/graphics remain supported. Prospect hunting and staff publishing workflows
are not installed as part of this toolkit.

Building defaults to a local preview. `$deploy` discovers the installation's
hosting settings: local by default, or the configured wildcard domain. The skill
does not manage host SSH, DNS or certificates. See [Deployments](deployments.md)
for wildcard domain setup and custom domains. A local URL refers to the instance
machine; remote viewers need the supported preview route or a tunnel.

Use **Customize a copy** to change a built-in workflow, then optionally **Share
with team**. Product upgrades preserve those copies and existing project files.
The default packages remain read-only. Existing same-name saved packages retain
precedence; updating the product does not silently replace their instructions.

### Skill dependencies

Packages may declare required supporting skills in
`references/skill-dependencies.json`:

```json
{"schemaVersion": 1, "skills": ["cinematic-interactions"]}
```

Use at most 16 unique skill slugs. Declarations resolve only against the current
actor's accessible, enabled skills and never grant access. During light-context
execution, an explicit skill selection includes its transitive supporting packages
without loading unrelated skills. Only the originally selected skills receive
explicit invocation instructions. Read supporting instructions only as needed.
Missing/disabled dependencies, invalid declarations and cycles fail the selected
workflow; fix the package or its availability before retrying. Unknown dollar
variables are not treated as mandatory skill selections. Dependencies are read
from the same immutable, ownership-checked snapshot as other package resources.

The site generator provides a static output structure checker, while cinematic
interactions provides a media inspection helper. These checks do not replace
browser review or prove design quality. See the skill's linked references for
commands and record unperformed checks as incomplete.
