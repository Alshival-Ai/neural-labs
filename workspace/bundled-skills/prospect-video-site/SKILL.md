---
name: prospect-video-site
description: Run one authorized Neural Labs local-business prospect concept from bounded city discovery through an original cinematic site, browser QA, optional demo-pi publication, and preference-aware automation notification.
---
# Prospect video site

This is the Neural Labs workflow director. Require a city or a prepared project.
For a scheduled run, read `get_automation_notification_context` using the job ID
provided by the automation and retain its `job.currentRunId`. It is the run's
notification identity, not a value to invent. No SMS/email recipients are fixed
in this skill. The automation's explicit hosted-preview request authorizes the
existing `$deploy` and `$demo-pi` release after QA; do not downgrade to local-only.

## Durable work and discovery

Use `$prospect-hunter` to find, screen and reserve exactly one fresh business. All
research, briefs, production assets and deliverables live in
`/home/node/workspace/projects/<business-slug>/`. Only `site/` is public output.
Use the helper's `status` command before resuming, then inspect `RELEASE-RESULT.json`,
`RELEASE-VERIFICATION.json` and deployment inventory. Successful release evidence
wins over a stale `qa-passed` stage or scratch pointer: that prospect is complete.
Resume only genuinely unfinished work. A normal new invocation selects a fresh
business, not another verification or rebuild of an already published prospect.
One-time recovery reminders expire when the requested release succeeds; rebuilding
a completed site requires a new explicit user request. Clear the active-project
scratch pointer after success, retaining the completed identity and release record.
Never restart discovery on an existing genuinely in-progress project. Keep a per-automation exclusive process lock
through the build/publish workflow, and record the active project in automation
scratch. An overlapping invocation must return a skipped/busy report, not start
another site. Do not leave detached work after claiming completion.

The helper owns selection and build checkpoints; the tested deployment skills
own release records and remote inventory. Never copy another tenant's state,
credentials, notification recipients or deploy scripts into this instance.

## Research before design or stock sourcing

After discovery, use `$business-research-and-media` to research the selected
business and inspect authentic imagery before design or stock sourcing. Follow
[the prospect research output contract](references/business-research-and-media.md)
for `researchPass`, evidence notes and media records required by this pipeline.

## Direct a distinctive site

Read [website-brief-contract.md](references/website-brief-contract.md), then
write `WEBSITE-BRIEF.json`, `research.json`, `SOURCES.md`, `DESIGN.md`, and
`STORYBOARD.md` before substantial implementation. Set
`experience.presentationProfile: cinematic-media-first` and
`experience.motionPolicy: auto`. All other omitted creative decisions are AUTO.
Read [conversion-and-content.md](references/conversion-and-content.md) to turn
the research into the customer journey, copy and usable actions.
Use `$website-template-1` for visual decisions, UI/UX guidelines, the media-first
opening, responsive behavior and optional motion. Supply the verified identity,
content, primary action and usable assets; record its decisions in `DESIGN.md`
and the website brief. For a verified restaurant also read
[restaurant.md](references/restaurant.md).

Use the shared [act production guidance](../site-generator/references/act-production.md)
for the storyboard, Act I proof and Act II/later continuation, while retaining
this director's lifecycle. Prove the chosen visual direction and highest-risk
interaction before expanding the page; a static header and later cinematic
scene are valid. Record act checks in `VALIDATION.md` and reserve the pipeline's
complete-build handoff for the finished site. Do not invoke a second director.

Follow [the presentation integration contract](references/cinematic-media-first.md)
to retain the profile values and hooks required by this pipeline's browser QA.

## Truthful media and implementation

Apply `$business-research-and-media`'s authentic-media findings and
preview/production distinctions, recording them using the
[prospect research output contract](references/business-research-and-media.md).
Missing production clearance alone does not justify skipping photo inspection
or replacing usable preview imagery with stock. Preserve source-specific use
restrictions, attribution and unresolved production follow-up.

Before a stock search, define the asset's communication role, subject, setting,
light, orientation, crop and negative space. Download only selected assets with
a planned placement. Confirm the provider's current license/API requirements;
stock is not public domain and must not become a business logo or proof of work.
Record generated media as generated conceptual content, never documentary evidence.

Use `pexels_search_photos`, `pexels_search_videos`, and `pexels_download_media`
for conceptual media, reviewing choices rather than accepting provider rank.
The download tool requires the existing project slug and a destination under
`site/assets/`. Retain its provenance and visible creator/Pexels credits.
Stock images must never appear to depict this actual business, staff, products
or results. Do not fetch credentials or use Beast's Pexels wrapper.

Write `MEDIA.json` with `schemaVersion: 1`, `authenticMediaSearch` containing
`completed: true`, `result: usable-found|none-usable`, and nonempty
`sourcesChecked` entries (`sourceType`, `url`, `outcome`). Every asset needs
`identityClass: business-authentic|conceptual-ui`, source/license/credit,
local path and intended role. `scrollVideoEffects` is an explicit array of
zero to two unique `{id,purpose}` records. Keep non-public manifests outside site/.

Use `$web-video-asset-preparation` for audio-free H.264 MP4 with short GOP and
local posters. Inspect representative start/middle/end frames before selection;
reject static or heavily cut footage for seeking. Verify with ffprobe. Each
video stays under 12 MiB, all videos under 25 MiB, and the whole static site under
50 MiB / 200 files with no symlinks.

Run `python3 {baseDir}/scripts/pipeline.py begin-build --run-dir <project>`.
Build semantic responsive `site/index.html` with relative local assets. Execute
JavaScript only from local external files; the host blocks inline scripts and
handlers. Include an independent Neural Labs / Alshival.Ai concept disclosure,
a visible https://alshival.ai link, and robots `noindex,nofollow,noarchive`.
No analytics, submitting forms, accounts, payments or invented social proof.
Follow [publication-and-handoff.md](references/publication-and-handoff.md) for
preview metadata, local preview reporting and any future production handoff.

For selected scroll video, use `data-scroll-video-effect` on the region and
`data-scroll-video` on the video, plus the cinematic background hooks. Use a
bounded native scroll range and short-GOP seeking, clean sticky release and
latest-target settling. Essential copy/CTAs remain ordinary readable HTML.
Handle missing/failed media, no JavaScript, Save-Data and reduced motion without
overlapping panels or hidden content. Reduced motion/Save-Data show a named
motion opt-in and a visible reason; explicit opt-in restores geometry and motion.

## QA, release and report

Run `node {baseDir}/scripts/qa-site.mjs --site-dir <project>/site --output-dir <project>/qa --business-name <verified name>`.
Inspect its desktop/tablet/mobile screenshots and iterate until intentional.
Complete `$website-template-1`'s visual and accessibility QA and the manual
content and conversion checks in
[conversion-and-content.md](references/conversion-and-content.md#manual-qa).
Require the report's geometry, CSP and selected-effect checks to pass. Selected
scroll effects must visibly move forward and backward, settle after rapid
scroll, and pass reduced-motion fallback plus opt-in restoration at all sizes.
Write `VALIDATION.md` with results, screenshot inspection, and physical-device
limitations. Run `pipeline.py complete-build --run-dir <project>` and require
`BUILD-RESULT.json` status `qa-passed`. Never hand-edit a passing result.

For explicitly authorized hosted previews, load `$deploy` and `$demo-pi`, use
only their tested preparation/publishing helpers, and preserve their registry,
immutable releases and indefinite retention. Never overwrite another business.
Repeat the same QA with `--url <final HTTPS URL>` instead of `--site-dir` and
`--output-dir <project>/release-qa`. Verify current served assets, CSP, HTTPS and
business identity. Preserve failed or ambiguous release state and stop; do not
blindly redeploy. Return a verified URL only after all release checks pass.

If scheduled, call `notify_workspace_user` with `automationId`, the captured
`runId`, `outcome`, a concise truthful `message`, and verified public `links`.
This stages subscriber delivery until OpenClaw records the final run outcome;
it does not select channels or mean delivery completed. Never include raw logs,
private research, internal capabilities or secrets. Save a full release report
in the project and return its project-relative path and verified public URL in
run history. A blocked workflow must clearly return failure, preserve its last
checkpoint, and never claim a blocked site is live.
