# Cinematic production in acts

Use after business research and before design. This adapts the original
`video-scroll-website` act workflow (historical commit `aa0ccb5`, 2026-08-29) to
Neural Labs' current skills and pipeline. Restore its central discipline:
establish a distinctive direction, prove one coherent experience, then develop
the rest with the same care.

## What an act means

An act is a unit of production with a message, composition and completion check.
It may also become a chapter of the visitor's story, but production order and
page order need not match. Act I proves the riskiest selected media behavior even
when its final position is below a static opening. With no selected motion,
Act I proves the strongest still composition and its usable responsive layout.

Use `Act I`, `Act II` and later act names in the working storyboard and validation
notes. Visible act/chapter titles are an optional editorial choice for later
sections, not required copy; useful hero context labels remain a composition choice. The number of
acts is independent of the effect budget. A new act does not require another
video, controller, pinned region or full viewport of empty scroll travel.

Continue through passing gates within the authorized request. Honor an explicit
user review hold; do not invent additional approval turns. These checks live in
the existing Markdown artifacts and do not introduce new pipeline state values.

## Stage 0 — Give the experience a direction

In `DESIGN.md`, define the website's job, primary visitor action, one-sentence
art direction, intended impression and the evidence behind it. Have the selected
template resolve type, palette, shapes, image treatment and section rhythm.

Use `STORYBOARD.md` to make the direction concrete. For each act/scene record:

- stable scene ID, act, page position and the customer question it answers;
- message and actual proposed heading/body copy, with factual status;
- media role, local asset or acquisition need, and authentic/conceptual class;
- desktop and mobile composition: focal point, crop and text placement;
- entry, progression and exit, including the relationship to adjacent sections;
- interaction primitive, input behavior and selected effect ID when applicable;
- local scroll range and media time/frame range only for a scrubbed scene;
- complete static/reduced-motion/media-failure presentation and load priority;
- what must be observed to call this act complete.

Keep ranges and scene transitions explicit enough to implement. Choose scene
duration from the message and meaningful media change. Several copy beats can
share one effect; do not create extra controllers simply to mark chapters.
Essential business information and actions remain reachable without finishing
the story. Record assets canonically in `MEDIA.json`, with selected scroll-video
IDs matching its existing `scrollVideoEffects` records.

## Use the Neural Labs specialists

Resolve these from the installed skill locations. The operator provisions the
interaction, media-preparation and deployment skills separately from the bundled
workflow; a fresh repository clone does not guarantee they are installed.

| Work | Current owner and handoff |
| --- | --- |
| Find a business when only an area is supplied | `$prospect-hunter`; retain its selected identity and reservation |
| Research and inspect authentic media | `$business-research-and-media`; use Neural Labs Google Places tools and the existing research evidence contract |
| Art direction, composition and visual QA | The selected template, default `$website-template-1`; supply the business brief and storyboard |
| Acquire conceptual assets | Neural Labs Pexels tools or configured `image_generate` after discovery; follow the template asset-direction reference, planned roles and local provenance |
| Prepare selected video and posters | `$web-video-asset-preparation`; pass the chosen local source and intended role, retain verified derivatives |
| Implement interactive media | `$cinematic-interactions`; pass selected modules, explicit order/placement, asset mapping and the required behavior as the implementation brief |
| Evidence and build lifecycle | `prospect-video-site` scripts/references through [workflow-contract.md](workflow-contract.md); do not invoke another workflow director |
| Publish and verify a requested hosted preview | `$deploy` and `$demo-pi`; retain their inventory, immutable release and verification interfaces |

Read only the interaction recipes needed by the storyboard: section scroll
video scrub, GSAP text, sticky image scenes, parallax, image reveal, pointer scrub, triggered playback or frame sequence.
For combined scenes, include their order and handoffs. Reuse the project's
framework and primitives; keep each effect's progress local and preserve native
page scrolling. Triggered playback is not forward/reverse video scrubbing, and
an image sequence is not a video source. Test the actual chosen primitive.

Use the current publisher's local external-script, media, size and file-count
limits. Report a missing selected dependency. Do not import old private provider
wrappers, deployment commands, host paths, credentials or fixed recipients.

## Act I — Cinematic proof

Build a small, finished slice with real media and copy. It should demonstrate
the visual idea and its hardest behavior, including the surrounding transition.
Do not build out generic sections while the central experience is still weak.

Pass this gate only after browser inspection establishes:

- the composition communicates the intended message with readable typography,
  a deliberate crop and clear visual hierarchy;
- selected interactions respond to their intended inputs; scroll-scrubbed media
  advances and rewinds visibly and settles after rapid input;
- text and media progression stay coherent, with no overlapping narrative panels;
- navigation and actions work in normal flow before and after the scene;
- desktop, tablet and mobile layouts work, including touch/keyboard equivalents;
- no JavaScript, failed media and reduced motion preserve usable static content;
  selected scroll-video fallbacks also meet the template's reason/opt-in contract;
- local controllers and prepared media satisfy the site's delivery constraints.

Record captures, observed behavior, failures and fixes in `VALIDATION.md` under
the act's name. A partial-page proof is not a completed build: run the pipeline's
whole-site QA and `complete-build` only after the site is complete. Unavailable
browser checks remain incomplete; do not declare the gate passed from code alone.

## Act II and later — Continue the story

Add the next useful part after the preceding proof is stable. Preserve the
visual system while varying scale, density and media treatment to support each
message. An immersive moment can resolve into an editorial section, authentic
gallery, service details or a simple action. Choose the sequence from the
business rather than assigning every site those same chapters.

Check each act's own behavior and its handoff: clean sticky release, no stale
fixed layer or gesture conflict, readable mobile flow and later media loaded
near its section. Reuse passing controllers instead of duplicating event logic.
Test the complete journey forward and backward after composition is assembled.

Final acceptance combines the chosen template's visual review, every selected
effect's behavioral checks and the pipeline's build evidence. Repeat applicable
QA on the final HTTPS URL after an authorized publication. A pass in one act or
a successful release cannot stand in for the complete experience.
