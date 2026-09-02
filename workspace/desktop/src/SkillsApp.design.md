# Skills desktop app design handoff

`SkillsApp` is an isolated React prototype for the Neural Labs desktop. It is intentionally not imported into `App.tsx`, registered in the desktop launcher, or connected to the running workspace container. All visible records are explicit placeholders supplied through overridable props.

## Product shape

The design separates three jobs that OpenClaw treats differently:

1. **Library** is the effective catalog for an agent. It makes eligibility, enable state, source precedence, invocation, per-agent visibility, node availability, files, and revisions visible in one working surface.
2. **Workshop** is the governed authoring path. A create or update remains a proposal until it is scanned, evaluated, and explicitly applied. Stale target hashes, warnings, quarantine, revision requests, and immutable history are represented.
3. **Discover** is the ClawHub path. Search results show publisher identity and scan state; the detail panel keeps version, install reference, requirements, changelog, target scope, and third-party trust guidance beside the install action.

The visual treatment continues the Neural Labs Spectrum Paper system: dark working rails, warm paper, compact technical typography, and cyan/violet/pink/coral/amber/mint used as functional wayfinding rather than decoration.

## OpenClaw parity represented

- `SKILL.md` plus support-file bundles.
- Effective source ordering across workspace, project agent, personal, managed, bundled, plugin, and node-hosted roots.
- Load-time gates for OS, binaries, environment names, configuration, and connected nodes.
- Separate user invocation and model invocation; direct tool dispatch is shown when present.
- Per-agent allowlists and personal/team/shared scope.
- File-watcher refresh behavior and session-pinned managed revisions.
- Managed-library immutable history and rollback integration seam.
- Workshop create/update proposal lifecycle, target and draft hashes, scanner gate, evaluator request, apply, revise, reject, and quarantine concepts.
- Collection review/history scan as a proposal generator, not a live mutation.
- ClawHub owner-qualified install references, exact versions, publisher identity, and `passed`, `warning`, or `unscanned` trust states.
- Explicit warning that skills are instructions within one trust domain; they do not grant credentials, tools, or isolation.

## Integration seams

`SkillsAppProps` exposes the product actions without prescribing transport:

- `onRefresh` → refresh `skills.status` and related read models.
- `onToggle` → `skills.update` for a configurable skill entry.
- `onInvoke` → attach the selected skill reference to a new Neura turn.
- `onShare` → the managed library ownership/share operation implemented by the Neural Labs service.
- `onRollback` → select/restore an immutable managed revision.
- `onProposalAction` → proposal evaluate/apply/request-revision/reject/quarantine Gateway methods.
- `onPropose` → create a Workshop proposal; the component never writes a live `SKILL.md`.
- `onInstall` → `skills.install` with the ClawHub slug/version and the selected workspace or personal target.
- `onScanHistory` → proposal history scan.

The OpenClaw Gateway version currently installed in this project also exposes read methods for `skills.status`, `skills.search`, `skills.detail`, `skills.securityVerdicts`, `skills.skillCard`, and `skills.bins`, plus upload/install/update and proposal endpoints. The adapter should normalize those results into `SkillRecord`, `ClawHubResult`, and `SkillProposal`; keep protocol objects out of the view component.

## Responsive behavior

- Desktop: persistent product navigation, library/proposal list, and working detail pane.
- Tablet: compact icon rail, narrower source lists, and single-column overview cards.
- Mobile: top section navigation; Library uses list-to-detail navigation; dense secondary actions collapse while primary invocation and proposal controls remain available.

The narrowest Discover layout currently favors browsing cards and intentionally hides the persistent detail rail. Integration can open the same detail content as a sheet when a result is selected.

## Files

- `SkillsApp.tsx` — types, placeholders, component, and callback seams.
- `skills-app.css` — scoped responsive visual system.
- `SkillsApp.test.tsx` — eligibility, invocation, Workshop, ClawHub scope, and proposal tests.

## Implementation notes

- Replace all `PLACEHOLDER_*` exports with normalized Gateway and Neural Labs service data.
- Preserve exact ClawHub security verdict wording from the server. Do not infer “trusted” from popularity or publisher appearance.
- Configuration values shown by this UI should identify required environment variable names only; never return secret values.
- Enforce authorization and scanner gates server-side. Disabled buttons and client state are guidance, not a security boundary.
- Refresh the effective catalog after mutations, but preserve the session revision already pinned to an active conversation unless the user explicitly refreshes it.
- The component uses only existing React and `lucide-react` dependencies.

Parity references: [OpenClaw Skills](https://docs.openclaw.ai/tools/skills), [Skill Workshop](https://docs.openclaw.ai/tools/skill-workshop), [Skills configuration](https://docs.openclaw.ai/tools/skills-config), and [ClawHub](https://docs.openclaw.ai/clawhub).
