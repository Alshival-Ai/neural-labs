---
name: site-generator
description: Generate and deploy a business website to the Raspberry Pi from a specified business or a location to scout. Orchestrates prospect hunting when needed, business research, the caller's chosen website template, asset preparation, implementation, QA and verified demo-pi release. Defaults to website-template-1 when no template is supplied.
---
# Site generator

Own the end-to-end workflow, not the visual design. Use the template explicitly
supplied by the user or automation; use `$website-template-1` only when none is
specified. Load that template and retain its identity in the brief. If the chosen
template is unavailable, report the missing dependency rather than substituting
another. Keep typography, layout, palette, components, motion choices and UI/UX
guardrails in the selected template; do not load a second presentation director.

## Resolve the request

Accept a business name with enough location/URL/Place ID context to identify it,
a city or precise area to scout, or an existing project to resume. Infer known
context; ask only for missing location or ambiguous identity that prevents a
correct selection. Do not choose a business elsewhere to fill an underspecified
request.

An invocation of this workflow normally requests a website and Raspberry Pi
hosted preview. Record that output intent before work. Honor an explicit
private-build or local-review request by stopping before remote publication.
A hosted business concept is not an official production launch: retain the
current demo disclosure, privacy and non-submitting behavior unless a separately
authorized production workflow handles those changes.

Read [workflow-contract.md](references/workflow-contract.md) before creating
project state. It defines the current helper interfaces, input branches, evidence
contracts, template selection and release handoff.

## Select once, then research

- **Location only:** use `$prospect-hunter` to find, screen and reserve one suitable
  business. Preserve the supplied city/area, category preferences, exclusions and
  opportunity criteria. If an area spans cities, resolve the geographic scope and
  pass each candidate's verified city to the existing city-based helpers; do not
  turn a ZIP code into an invented city or search outside the requested area.
- **Specific business:** skip hunting and competitive ranking. Resolve that exact
  identity and initialize the named-business path. A good existing website or
  chain status is not a reason to replace an explicitly selected business. Keep
  factual and media safeguards; never fabricate identity to satisfy a helper.
- **Existing project:** inspect durable state and release evidence before work.
  Resume genuinely unfinished work without reselecting. A completed site is not
  a new prospect or an unfinished run. For an explicitly requested revision,
  preserve the existing domain and release and follow the deployment revision
  process; never erase success records to bypass a checkpoint.

Use `$business-research-and-media` on the selected identity. Complete factual
research and actual authentic-image inspection before design, stock sourcing or
implementation. Record findings, source access limitations and media usage basis
in the pipeline's evidence formats. Missing facts remain missing.

## Build using the chosen template

Prepare the website brief with selected business, customer needs, primary action,
content evidence, intended output and `experience.templateSkill`. Use the selected
template to produce the design notes and storyboard. The template owns visual
choices and applicable acceptance criteria. Preserve explicit compatible user
requirements; AUTO applies only to omitted choices.

Use the existing conversion/content and domain references linked from the workflow
contract for truthful business copy. Plan asset roles before sourcing, prefer
usable authentic identity media, and use the workspace Pexels tools only for
remaining conceptual roles. Preserve local files, provenance and credits; do not
imply that representative or generated media depicts the actual business.

When the template selects video, use `$web-video-asset-preparation` to inspect and
prepare it. When it selects interactive media, use `$cinematic-interactions` for
the relevant implementation and input/fallback tests. These are conditional
implementation dependencies, not a quota for effects.

Begin the build only after the evidence gate passes. Implement the prepared
static `site/` with local assets, publisher-compatible external scripts and the
recorded content/integration limitations. Keep non-public research outside `site/`.
Respect existing project conventions and the destination's size/security limits.

## Validate and deploy

Run the pipeline's local browser QA plus the chosen template's visual and
interaction checks. Inspect the screenshots; report unavailable browser/device
checks as incomplete. Resolve failures before release. Save `VALIDATION.md` and
require the helper-generated `BUILD-RESULT.json` to pass; never hand-author a pass.

For the normal hosted-preview output, load `$deploy` and `$demo-pi`. Inventory
the Raspberry Pi and deployment registry first, reserve a suitable unoccupied
hostname, prepare the static release with the deploy helper, and publish with
the target's constrained helper. These target skills own aliases, addresses,
credentials, exact commands, immutable releases and retention. Do not copy their
infrastructure details into this skill or bypass their publisher.

Require the publisher's successful result and independently verify the public
HTTPS page, exact business identity and served assets. Repeat browser and
selected-template QA against the final URL under its actual CSP and media
delivery. Preserve a failed or ambiguous release and inspect current state before
retrying. Never overwrite another business or schedule automatic demo teardown.

## Durable automation and report

An automation must hold one exclusive process lock across the whole workflow,
record its active project in scratch, and skip overlapping runs. Preserve its
location and explicit template/effect requirements; do not infer authorization
to change schedules or subscriptions. Clear the active-project pointer only after
successful completion while retaining selection and release history.

For an automated run, call `get_automation_notification_context` with its actual
job ID and retain `job.currentRunId`. Stage the truthful result through
`notify_workspace_user` using that automation/run identity and verified public
links. Subscriber settings choose recipients and channels. Do not hard-code
recipients or claim staged notification means delivered.

Return the selected business, input path (hunted/named/resumed), template used,
project-relative report path, verified URL when published, release identity,
QA evidence and remaining limitations. A blocked workflow returns a clear failure
and its last durable checkpoint, never a claim that an unverified site is live.
Name the implemented effects and their observed QA results, plus any template
defaults omitted and why. Distinguish common browser checks from interaction
checks; a successful release or responsive screenshot is not evidence that a
scroll controller or hover overlay works.
