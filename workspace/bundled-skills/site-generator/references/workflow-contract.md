# Workflow and pipeline contract

The tested helpers currently live in the `prospect-video-site` package. Use its
scripts and data references as a workflow engine; do not invoke that package's
opinionated presentation director. Keep it installed as this engine dependency.
Resolve all paths from the actual installed skill locations.

All work lives under `/home/node/workspace/projects/<business-slug>/`; only
`site/` is published. Never copy another tenant's secrets or generated state.

## Input branches

For a location-only request, `$prospect-hunter` creates and reserves the project
in `prospect` mode. Read its selected handoff and state; do not initialize again
with a different mode or identity. Preserve a requested ZIP/area constraint as
well as the candidate's verified city.

For a named business, resolve its exact Place ID, name, city and category from
supplied context and bounded identity lookup. This is not competitive scouting;
do not apply the hunter's weak-website, category-diversity or chain filters.
Initialize a new project and use the same atomic reservation interface:

```text
python3 <pipeline-dir>/pipeline.py init --run-dir <project> --mode named --city <verified-city>
python3 <pipeline-dir>/candidates.py reserve --run-dir <project> --city <verified-city> --place-id <verified-place-id> --business-name <verified-name> --address <verified-public-address-or-empty> --hostname <available-domain> --category <verified-category> --business-kind <general|restaurant>
python3 <pipeline-dir>/pipeline.py record-selection --run-dir <project>
```

Here `<pipeline-dir>` is `../prospect-video-site/scripts` relative to this skill.
The current engine requires a real Place ID and city even for named businesses.
If there is no matching listing, report this engine limitation with the supplied
identity preserved; do not invent a Place ID, substitute a prospect or claim
selection passed. Identity support beyond Places requires an explicit engine
extension rather than misleading field values.

Inventory existing local reservations and `$demo-pi` before reserving. If the
business already has an unfinished project, resume it. If already published,
report that result unless the request explicitly asks for a revision. The current
helper refuses to rebuild completed runs; do not delete its release evidence.

## Evidence and content

Read these engine references for the required data formats:

- [Research output](../../prospect-video-site/references/business-research-and-media.md):
  `researchPass`, source notes, photo-inspection evidence and media decisions.
- [Website brief](../../prospect-video-site/references/website-brief-contract.md):
  identity, content, conversion, assets and integrations. The template selection
  rules below replace its legacy fixed presentation default for this workflow.
- [Conversion and content](../../prospect-video-site/references/conversion-and-content.md):
  truthful copy and practical actions. Follow the selected template for visual
  QA rather than that reference's default-template routing.
- [Publication and handoff](../../prospect-video-site/references/publication-and-handoff.md):
  truthful demo metadata, noindex, preview verification and production limitations.
- [Restaurant overlay](../../prospect-video-site/references/restaurant.md): only
  when the selected business is factually a restaurant.

Write `research.json`, `SOURCES.md`, `WEBSITE-BRIEF.json`, `DESIGN.md`,
`STORYBOARD.md`, `MEDIA.json` and later `VALIDATION.md` outside `site/`.
`MEDIA.json` uses schema version 1, an evidence-backed `authenticMediaSearch`,
`business-authentic|conceptual-ui` asset classes and explicit `scrollVideoEffects`.
Keep the current maximum of two scroll-video effects and verified local derivatives.
The publisher limits are 12 MiB per video, 25 MiB total video, 50 MiB/200 static
files overall, with no symlinks. These are engine constraints, not design choices.

## Template selection and QA

Store the supplied skill name without `$` in `experience.templateSkill`; default
to `website-template-1` only when no template was supplied. Load it before design.
If multiple templates conflict, resolve the intended choice rather than merging
incompatible instructions. Missing templates must not cause silent fallback.

For `website-template-1`, follow its own presentation reference and hooks; record
`presentationProfile: cinematic-media-first` and `motionPolicy: auto` unless the
caller supplies a compatible explicit motion requirement. The profile value is
a validator identifier, not the name of another skill to load.
For this template, its preferred AUTO effects and default budget of two override
the legacy brief's illustrative budget of one and equally optional motion
guidance. Record selected effects in the brief and concrete exceptions in
DESIGN.md; retain explicit user budgets and static requests.

For another explicitly supplied template, use the engine's `evidence-led` profile
when the cinematic geometry checks do not apply. Run and record that template's
actual acceptance checks in addition to the common browser checks; evidence-led
is not permission to skip visual QA. If it selects the same media-first contract,
use that profile and its checks. Do not copy the default template's visual rules
into an alternative template. Unsupported engine requirements must be reported,
not disabled by falsifying a report or relabeling the chosen template.

```text
python3 <pipeline-dir>/pipeline.py status --run-dir <project>
python3 <pipeline-dir>/pipeline.py begin-build --run-dir <project>
node <pipeline-dir>/qa-site.mjs --site-dir <project>/site --output-dir <project>/qa --business-name <verified-name>
python3 <pipeline-dir>/pipeline.py complete-build --run-dir <project>
```

Require `BUILD-RESULT.json` status `qa-passed`. Use only local external executable
scripts. When scroll video is selected, add `--require-scroll-video` to both local
and public QA commands so missing effect hooks cannot silently skip its checks.
Complete the template's hover/reveal input checks and before/after captures
separately in VALIDATION.md; the common helper does not automate these checks.
Maintain the preview's disclosure, noindex, no analytics and no submitting
forms. Domain/content checks and selected-effect tests apply with every template.

## Release

Load `$deploy` and `$demo-pi`; follow their preparation, inventory, publication and
verification interfaces. Preserve their registry and release records. After a
successful publish repeat QA with `--url <final-HTTPS-URL>` in place of `--site-dir`
and `--output-dir <project>/release-qa`. Inspect served identity/assets and template
behavior before returning the public URL as verified.

Stop after local QA for an explicit private/local output. Creating this skill or
editing an automation does not itself authorize executing an example website run.
