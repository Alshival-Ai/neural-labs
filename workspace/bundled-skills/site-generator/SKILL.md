---
name: site-generator
description: Create a polished, business-specific website through research, creative direction, an Act I cinematic proof, narrative continuation, browser QA and verified Raspberry Pi publication. Accepts a specified business, a location to scout or a project to resume; uses the caller's chosen template and defaults to local-business-website-builder for name-and-address requests.
---
# Site generator

Create a site that makes the business feel understood: a strong visual concept,
considered typography, compelling media, purposeful interactions and a clear
visitor journey. Take time to compose and inspect the experience. A page full of
generic sections is not a finished design, even when it passes automated QA.

Own the finished experience and its production sequence. Use the template
explicitly supplied by the user or automation; use `$local-business-website-builder` only
when none is specified. The template is the art director for layout, palette,
components and motion. Give it a rich business brief and review the result as
a whole. Retain its identity in the brief; report a missing template rather than
substituting another or loading a second presentation director.

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
Read [act-production.md](references/act-production.md) before design for the
Act I proof, storyboard contract, specialist handoffs and continuation gates.
These are working checkpoints within the authorized task, not extra approval
turns or mandatory visible section titles.

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

For the matched Google Places listing, call `google_place_details` and, when
photos are available, `google_place_photo`; actually view promising images.
Use suitable, source-compatible business photos for identity, premises, work or
gallery roles rather than merely recording that photos exist. Follow the research
skill's attribution and acquisition rules; when a Places photo cannot be retained
as a static asset, seek its usable business-controlled original. Record specific
unavailability or rejection reasons instead of silently defaulting to stock.

## Stage 0 — Creative direction and storyboard

Prepare the website brief with selected business, customer needs, primary action,
content evidence, intended output and `experience.templateSkill`. Use the selected
template to produce the design notes and storyboard. The template owns visual
choices and applicable acceptance criteria. Preserve explicit compatible user
requirements; AUTO applies only to omitted choices.

Study the current website when one exists. Understand the offering, audience,
setting, authentic imagery and what makes this business worth visiting or
choosing. Separate the website's job from the visitor's primary action. Translate
that understanding into a one-sentence art direction and a story worth scrolling
through, then use the template to choose its visual language.

Pass usable brand guidance, logos and official visual cues into that handoff.
Have the template record the headline approach, display/body font roles, palette
basis and action placement in DESIGN.md. Review whether those choices fit this
business instead of inheriting the previous site's hero, colors and controls.
For the default template, choose an original hero composition and useful context
labels based on this business. Read its asset-direction and visual-review
references; retain a clear, reachable primary action.
Encourage advanced UI effects that serve the business's content, while leaving
their type, combination and placement to the template's creative direction.
The header/hero can be static. A scroll-video background may appear in a middle
or later section when it helps tell that part of the story; it is not a required
opening treatment. Avoid carrying the same effect sequence from site to site.

Write `DESIGN.md` and `STORYBOARD.md` before substantial implementation. Plan
ordered acts/scenes, the customer question and message of each, media/copy
relationships, transitions and mobile/static versions. Identify the experience
that will establish the design's quality in Act I. An act can contain still
composition, useful business content or interactive scenes; it is not synonymous
with a video or full-screen section. Let the story determine the page length.

## Prepare the selected media

Use the existing conversion/content references for truthful copy. For new builds
read `$local-business-website-builder` references/business-photo-direction.md and
asset-policy.md. Complete BUSINESS-VISUAL-BRIEF.json before implementation. Use
the inspected place to shape an original composition and meaningful feature.
Prefer usable authentic imagery, then coordinated generated representative
assets from a discovered configured provider. Stock requires the explicit choice
or documented fallback in that policy. Do not automatically search Pexels.
Preserve provenance, license/credit and honest representative labeling.

When the template selects video, use `$web-video-asset-preparation` to inspect and
prepare it. When it selects a cinematic interaction, use `$cinematic-interactions` and its
shared `references/effect-catalog.md` to resolve the exact recipe, including
text/DOM scroll effects and interactive media. Follow the selected recipe's
input, fallback and browser checks. These are conditional
implementation dependencies, not a quota for effects.

## Act I — Prove the signature experience

Begin the build only after the evidence gate passes. Implement the prepared
static `site/` with local assets, publisher-compatible external scripts and the
recorded content/integration limitations. Keep non-public research outside `site/`.
Respect existing project conventions and the destination's size/security limits.

Build the smallest coherent proof of the visual direction around the strongest
message and highest-risk selected interaction. Compose its real copy, prepared
media, typography, entry, progression and exit. If the signature scene belongs
later in the page, prove it there with enough surrounding flow to test it; Act I
does not force an animated header.

Inspect it in a browser on desktop, tablet and mobile. Prove the intended inputs,
readable static state and clean return to document flow. Refine weak composition
or unreliable motion before expanding. Record observed Act I results in
`VALIDATION.md`; a static design proves its composition and usability without
manufacturing a video test. Follow the act reference's completion criteria.

## Act II and later — Narrative continuation

Continue only after Act I passes its applicable checks. Develop the remaining
story from the storyboard, reusing the visual system and working interaction
primitives. Give each scene a new message and a deliberate transition. Combine
cinematic moments with readable business sections that help visitors decide
and act. Later acts can be entirely static; the effect budget spans the site.

Inspect each addition and its handoff before expanding further. Load later media
near its section, keep controls independent of the cinematic sequence and check
the complete forward/reverse journey. Preserve the same standard of composition
through the practical information and closing action; do not append filler to
make the site longer.

## Final inspection and release

Run the pipeline's local browser QA plus the chosen template's visual and
interaction checks. Inspect the screenshots; report unavailable browser/device
checks as incomplete. Resolve failures before release. Save `VALIDATION.md` and
require the helper-generated `BUILD-RESULT.json` to pass; never hand-author a pass.
Review the full scroll journey as well as individual captures: does the site
build interest, vary pace, explain the actual business and make its next step
easy? Refine composition, transitions, copy and mobile pacing until they support
the recorded direction. A working controller alone does not establish quality.

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
Describe the art direction, the acts/visitor journey, the implemented effects
and why their placement fits the content. Include act-gate and final QA results.
Distinguish common browser checks from interaction
checks; a successful release or responsive screenshot is not evidence that a
scroll controller or hover overlay works.
