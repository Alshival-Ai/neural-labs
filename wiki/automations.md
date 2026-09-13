# Automations desktop app

Automations is the Neural Labs desktop client for OpenClaw's built-in scheduler.
It reads and writes the same durable jobs and run history as the
`openclaw automations` CLI. There is no second Neural Labs scheduler or database.

The dock launcher is visible to every workspace user and routes to the
Automations section inside the canonical Skills app. Every user can inspect
redacted operational state and manually run AI task automations with their own
connected ChatGPT account. Missing or paused personal connections block the run.
Manual runs do not change the original schedule or its configured account.
Administrators additionally can:

- show scheduler connectivity, enabled/running/error counts, and live job state;
- search and filter jobs;
- create and edit one-time, interval, cron, process-exit, and stream schedules;
- create system-event, agent-turn, command, and script payloads;
- pause or enable jobs;
- inspect durable execution and delivery history; and
- remove non-system jobs.

OpenClaw remains authoritative for schema validation, permissions, execution,
delivery, auto-disable behavior, and tool-policy ceilings. Command and script
payloads, condition scripts, and stream commands are unattended code execution;
the warning in the form is explanatory and is not the security boundary.

The regular-user presentation removes raw commands, scripts, agent payloads,
condition scripts, working directories, agent/model/tool settings, delivery
targets, run errors, and token usage. It keeps names, schedules, enablement,
running/error counts, and summarized run outcomes. This is a presentation and
API-authorization boundary inside a shared developer environment, not a host
filesystem confidentiality guarantee.

## Administrator connection

The ordinary Neura WebSocket deliberately cannot administer the scheduler.
Automations uses `/workspace/automations/socket`, which is also the shared
administrator connection for the Skills desktop app. Nginx gates it with the
control plane's active-administrator check before asserting a fixed trusted
proxy identity. OpenClaw grants that identity connection-only
`operator.read,operator.admin` scopes. The client does not create an OpenClaw
browser device or store a reusable OpenClaw token, so the admin grant exists
only on that trusted-proxy-authenticated WebSocket. OpenClaw's configured role
keeps admin in its ceiling but does not grant it to ordinary Neura connections,
which remain capped below admin. The connection is recycled every five minutes
so account demotion or disablement is rechecked.

The deployment CLI builds and starts containers but intentionally does not
install host Nginx configuration. After changing
`deploy/nginx/neural-labs.ai.conf`, an operator must install it into the host's
active site configuration, run `nginx -t`, and reload Nginx. See
[ADR 0005](adr/0005-admin-gated-automations-ingress.md) for the trust-boundary
decision.

The route name is historical. Its security contract is an active Neural Labs
administrator check plus a fixed OpenClaw service identity, not access to one
specific desktop app.

## Form conventions

- Interval values use durations such as `30m`, `4h`, or `1d`.
- Stream commands must be a JSON argv array such as
  `["node","scripts/events.mjs"]`.
- Command payloads accept either a JSON argv array or shell text. Shell text is
  run through `/bin/sh -lc` in the shared workspace container.
- One-time values use an ISO local date/time and the selected IANA timezone, or
  an ISO timestamp with an explicit offset.
- `Workspace default` leaves model selection to the configured OpenClaw agent.
- Job updates use OpenClaw's configuration revision when available, preventing
  a stale desktop window from silently overwriting a newer edit.

OpenClaw events trigger a prompt refresh across open Automations windows, with
a 30-second reconciliation poll as a fallback.

## Subscriptions

Open an automation and choose **Subscribe** to select results, failures, and
Neura, SMS or email channels. Account Notification Settings control channel
permission and default choices. Each subscription can select different channels;
unsubscribing or disabling a channel suppresses pending delivery. No existing
member is automatically subscribed.

Neura updates appear through the **Automations** entry in private chat history.
They persist while you are offline. Opening it creates your private follow-up
conversation if necessary; receiving an update alone does not run Neura. Replies
include recent visible results as context.

SMS needs a verified phone and the existing SMS permission. Email needs explicit
account opt-in and the administrator-configured Microsoft 365 sender (stable
mailbox ID plus address), using the existing Entra application's Mail.Send
permission. Accepted messages are not advertised as confirmed delivery.

`notify_workspace_user` now resolves channels from recipient settings. An agent
can call `get_automation_notification_context` to read subscribers' allowed
channels and the current run ID without receiving contact addresses. Automation
result submissions are staged until the scheduler outcome is durable. Missing
summaries receive a concise outcome notice; raw execution logs are never copied
into notifications.

## Alamo prospect concept workflow

`prospect-video-site` composes existing cinematic, video-preparation and tested
`deploy`/`demo-pi` skills. `prospect-hunter` adds bounded discovery and
atomic duplicate reservations. `business-research-and-media` supplies reusable
business research and authentic-image inspection; the prospect skill retains its
research output contract and build gates. `website-template-1` owns the reusable visual and UI/UX guardrails. The installer
includes the discovery, research, prospect and template skills.
New concepts use a full-bleed media opening and
explicit AUTO motion (zero to two meaningful effects), unique business-specific
art direction, recorded facts/media provenance and desktop/tablet/mobile QA.
Only `site/` is published; research and manifests remain in the project.

The explicit operator installer `bin/install-prospect-automation.mjs` runs inside
the workspace container after the new image is deployed. It backs up affected
skills and installs the job paused with `0 8-16/2 * * 6,0`, America/Chicago. It
does not run or enable the automation. Public demos use existing constrained
publishing and indefinite retention; no prospect outreach is authorized.

## Item actions

Right-click a skill, automation, or draft, or use its **…** button. Keyboard
users can press Shift+F10 and navigate the menu with arrow keys. The same actions
are available without changing which item is open.

Duplicate saves a personal skill copy with the complete supported package, or a
paused automation with its scheduler configuration. Copies receive unique names.
Automation subscribers, run history, and scratch state are not copied. Draft
copies remain unpublished and have independent ownership and collaborators.

Delete always asks for confirmation. Skill owners can delete their own packages;
administrators can also delete writable Team packages. Built-in/plugin skills
remain protected. Running and system-managed automations cannot be deleted here.
Deleting a draft or automation leaves previously published skills, generated
projects, and public sites intact.

### Research before stock media

The Alamo workflow now requires a separate selected-business research pass before
stock search or implementation. It follows official website/social sources,
resolves and visually inspects relevant Google Place photos, and seeks usable
business imagery before selecting conceptual media. Blocked sources require an
alternative-source attempt rather than an automatic stock-only conclusion.

`researchPass` version 1 and private evidence notes are checked by begin-build
and complete-build. Authentic assets record preview/production status, usage
basis, attribution, and production follow-up. Photo inspection is separate from
permission to retain an API image indefinitely. Historical published projects
are not rewritten; resumed unpublished projects need the new evidence.

### Website Template 1 design review (2026-09-08)

The template now routes to `references/design-system.md` for header/navigation,
font pairing and fallback, role-based colors, spacing and section rhythm,
buttons and component states, galleries, practical information, and footer UX.
The existing media-first reference continues to own scene geometry and hooks.

Review sources were the workspace `site-generator`, `cinematic-media-first`,
local-business builder and restaurant guidance, plus Beast's Alamo automation
instructions and its archived `railyard-83-publish.zip` and
`cosmetology-salon-static-site.zip` HTML/CSS. The archives' exact automation-run
provenance was not established. No source assets, business copy, credentials or
runtime state were imported into the template.

Railyard's CSS declares Bebas Neue/Manrope, condensed headlines, warm ink/paper,
orange/brass accents, section labels and strong filled actions. The salon CSS
uses Georgia with selective italic, a sans fallback stack, warm paper and rose,
compact navigation, fine rules and a collapsing footer grid. These informed
optional design directions, not mandatory fonts or copied page compositions.
Tight headline leading, small navigation text and hidden mobile navigation were
not promoted into defaults. Inspect actual font loading, mobile access and zoom.

This review inspected source artifacts; no browser backend was available for
fresh screenshot or interaction verification. Skill structure and relative
references were validated. Future site builds still require their normal visual
and interaction QA.

### Deprecated presentation skills (2026-09-08)

`website-template-1` supersedes `cinematic-media-first` for presentation guidance.
It covers identity and header composition, type/palette/spacing, media geometry,
optional effects, native scroll, responsive and accessible fallbacks, framework
preservation and visual QA. Its AUTO motion policy permits zero to two effects;
the former default mandatory effect is intentionally not inherited.

The obsolete `cinematic-media-first`, `site-generator` and
`local-business-website-builder` packages are retired from the active Neural Labs
workspace skill directory into protected skill backups. The latter two directly
invoked the retired presentation skill. Their relevant prospect content and
conversion guidance already lives inside `prospect-video-site`; interaction
mechanics remain in `cinematic-interactions`. The installer archives these old
packages after installing the replacements, preventing a reinstall from leaving
both versions active.

The paused Colorado prospect automation's explicit presentation-skill invocation
is migrated to `website-template-1` without enabling it or changing its schedule.
Keep the `cinematic-media-first` presentation-profile value and DOM attributes:
these are persisted data/QA contracts, not an invocation of the deleted skill.
The similarly named prospect reference is an integration contract pointing to
the new template. Historical design-review notes remain historical.

### Retired local-business builder coverage audit (2026-09-08)

Reviewed the archived entrypoint and all eleven references against the remaining
skills. The package remains in the protected retirement backup for recovery.

| Archived guidance | Current owner / disposition |
| --- | --- |
| Intake and evidence | `business-research-and-media`; prospect research contract and conversion/content reference |
| Lead discovery | `prospect-hunter`; missing-site uncertainty and private identity handling in research |
| Conversion architecture | Prospect `conversion-and-content.md` and brief; template controls action presentation |
| Style translation | `website-template-1` and its design-system reference; evidence-to-design decision ledger |
| Visual system and assets | Template roles/crops/type/tokens; research provenance and prospect media manifest |
| Licensed asset sourcing | Research authentic-media inspection; prospect role-first stock planning, provider rules, credits and generated-media classification |
| Site specification | Existing `WEBSITE-BRIEF.json` contract; no competing YAML schema added |
| Effect questionnaire | Template preserves explicit choices and distinguishes media primitives; mandatory questionnaire intentionally replaced by existing AUTO policy |
| Local preview | Prospect `publication-and-handoff.md`; exact route/readiness, server lifecycle and observable reporting |
| Local SEO and trust | Research identity/privacy handoff; prospect metadata and future production checklist |
| Quality gates | Template visual/accessibility review, prospect content/metadata checks, pipeline/browser QA and interaction recipes |

The review restored gaps in private-address and missing-site handling,
role-first stock planning, current provider-rule checks, generated-media status,
explicit-effect preservation, metadata, preview reporting and production handoff.
Old requirements for manual-only candidate selection and mandatory cinematic
motion are superseded by the authorized bounded discovery and AUTO workflows.
The old builder also offered generic production/redesign/audit orchestration;
these modes are not claimed as equivalent capabilities of the prospect director.
Their useful checks remain as conditional handoff guidance without expanding the
concept-only workflow or restoring the deprecated skill.


### Hunting and research separation (2026-09-08)

`prospect-hunter` replaces `prospect-business-discovery`. It owns bounded candidate
search, identity/eligibility screening, deduplication, reservation and selection
handoff. It forwards already-observed links/photo metadata without resolving or
inspecting photos and explicitly leaves deeper research pending.
`business-research-and-media` owns the selected business's detailed facts, visitor
journey, authentic photo inspection, media acquisition and evidence records. It
does not scout replacements or reserve another candidate. The prospect director
calls these stages in that order. Existing helper paths, reservation formats and
research gates remain unchanged. The old installed name is archived after the
replacement is installed; direct automation references are migrated if present.

### Prospect opportunity screening (2026-09-08)

`prospect-hunter/references/scouting-and-selection.md` now defines independent
business eligibility, explicit chain/franchise/big-box exclusions, website
presence classifications and evidence-led ranking. Favor no-official-site-found,
social-only presence or observed website weaknesses over an already adequate
site. Keep unknowns distinct from defects; a missing listing link, dated footer
or single failed fetch is not proof. Inspect only enough to establish the
selection opportunity, then hand off deeper research separately.

Beast's archived discovery skill supports the retained bounded city search,
category diversity, shortlist, chain exclusions and reservation behavior. The
explicit no-site/outdated-site priority and big-box exclusion reflect the user's
clarification; those exact criteria were not found in the archived files reviewed.

### Site generator orchestration (2026-09-08)

`site-generator` is a new workflow director, distinct from the retired skill that
previously used that name. It chooses the supplied template and defaults to
`website-template-1` only when none is supplied. UI design remains in the template.
It routes location-only requests through `prospect-hunter`, supplied businesses
through the existing named-selection mode, then uses business research, template
application, conditional media preparation/interactions, browser QA and the
`deploy`/`demo-pi` Raspberry Pi publisher. Hosted preview is the normal output;
explicit private/local requests stop before deployment.

The old prospect package remains an installed engine dependency for its tested
scripts and evidence contracts. Its director is not invoked by the new generator.
The engine now accepts an explicit alternative `experience.templateSkill` with
its `evidence-led` profile; default-template and legacy prospect requests retain
the existing cinematic geometry gates. All common research, media, CSP, selected
motion, size and release checks still apply. Alternative templates require their
own visual acceptance checks as well as common QA.

The named path currently requires a real Google Places identity, as enforced by
the existing selection/research engine. Missing listings are an explicit blocker,
not grounds to fabricate IDs or scout a substitute. Completed-run revisions also
retain existing release protection. These limitations are recorded in the new
workflow contract. The skill does not claim a generic official-production launch.

Colorado and Alamo automation instructions informed the workflow; neither job's
payload, schedule, enabled state or subscriptions were changed during creation.
Explicit caller requirements (including Colorado's selected-effect requirement)
are preserved when supplied. The installer now includes the new `site-generator`
and no longer retires that name. The prior package remains in historical backups.
Validation: skill/frontmatter and local links; ten pipeline/helper tests including
named selection, alternate template acceptance and default geometry enforcement.
No example site build, remote release or notification was triggered.
