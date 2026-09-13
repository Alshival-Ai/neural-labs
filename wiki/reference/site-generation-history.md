# Site-generation workflow history

These dated implementation notes were previously mixed into the Automations
guide. They record a particular workflow's development and deployment context;
they are not required setup for a personal Neural Labs instance. The named
operator skills and publishing targets are not provisioned by a fresh clone.

For current user instructions, see [Automations](../automations.md) and
[Skills](../skills.md). Maintainers can inspect the bundled
[site-generator contract](../../workspace/bundled-skills/site-generator/references/workflow-contract.md)
and [operator installer](../../bin/install-prospect-automation.mjs) before
adapting this optional workflow to another deployment.

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
