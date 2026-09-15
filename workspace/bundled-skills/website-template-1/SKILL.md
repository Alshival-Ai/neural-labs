---
name: website-template-1
description: Art-direct a business-specific website when selected by the user or calling workflow. Shape a cinematic story in acts with expressive typography, media-first composition, purposeful advanced interactions, responsive pacing and visual QA; retain creative freedom in style, section order and effect placement.
---
# Website Template 1

Give the business a memorable visual experience. Use scale, typography, media,
layering and pacing to make its story compelling and its next step clear. Keep
composition, palette and section rhythm specific to the supplied identity and
content. This template sets a quality standard and media hierarchy, with room
for a fresh creative direction on every site. Apply it when selected.

Inspect the existing framework, styling, components and working page structure.
Preserve compatible primitives and the caller's chosen stack.

Consume the caller's verified content, audience, primary action, usable assets,
intended output and technical constraints. Record design decisions in the
requested brief or design notes. Research, factual approval, integration setup,
file schemas and publication remain with the calling workflow. Do not infer
business facts or permission to publish from a design assignment.

## Visual direction

Prefer supplied brand guidance and usable official visual cues, then verified
audience, positioning and context. Identify representative media and reversible
creative assumptions. Stock imagery is not evidence of a real brand's palette,
atmosphere, staff or work.

Connect each design observation to its evidence status, design consequence and
replacement trigger. Record one recognizable composition idea, customer feeling,
display/body typography roles, responsive sizing, color roles and contrast,
spacing, shape, image treatment and section rhythm. Express these as consistent
tokens rather than unrelated values. Avoid generic SaaS cards or reproducing a
previous site's composition.

Read [design-system.md](references/design-system.md) before implementation for
header/navigation composition, font selection, responsive type, palette roles,
spacing, buttons, section rhythm, galleries and footer design. Choose and record
the applicable options; example font pairs are illustrations, not a shortlist.
Choose the palette from usable brand guidance, logos and official materials;
when these are absent, use the business's character, audience and positioning
and record the palette as a creative assumption. There is no default accent color.

Do not place an eyebrow, category/location label or decorative section number
above the hero heading. Let the business name itself be the dominant headline
when it makes a strong identity statement, with a catchphrase or slogan below;
an editorial headline is another option. Choose the hierarchy, type treatment
and alignment for this business. Put useful category/location context naturally
in supporting copy or practical details. Explicit user design choices take precedence.

## Compose a story in acts

Turn the art direction into an ordered storyboard before building the full page.
Think in acts: establish an impression, develop the visitor's understanding and
resolve into a useful next step. These are narrative functions, not three
mandatory sections. Choose the number, order, names and treatment from the
business's content. A service list or quiet still composition can carry an act
as effectively as an immersive scene.

Give each scene a clear message and compose copy, media and interaction together.
Decide what appears at entry, what changes as the visitor explores, and how the
scene hands off. Shape a rhythm of immersive and quieter passages, generous
space and denser practical content. Avoid making every section the same height,
card arrangement, text position or animation. Each act should add information
or feeling rather than restating the opening.

When the workflow builds in gated acts, use Act I to establish the visual
standard with real copy and media before expanding. The proof may belong later
in the page; the header can remain static. Visible `Act I`/`Act II` or editorial
chapter labels are available in later sections when they suit the design, but
the storyboard's production labels need not appear on the site. Keep the hero
heading guidance above. An act count is not an effect count.

## Media-first composition

Read [media-first-presentation.md](references/media-first-presentation.md) for
the opening geometry, optional scenes, interaction behavior and QA hooks.
Use a near-viewport full-bleed media field with readable identity and a dominant
headline. Hero buttons are optional; keep useful next steps discoverable through
navigation, inline links or relevant page sections without waiting for motion.
Do not substitute a split hero, framed video or bounded image card for the
opening media field.

Map each asset to a communication role with an intentional desktop/mobile crop,
focal point, aspect ratio, alt-text purpose and replacement notes. Keep source
and usage records in the caller's asset manifest. Use efficient image and font
loading and reserve media space. Essential identity, copy and actions must work
before media or animation loads.

Use suitable inspected Google Places/business photos supplied by the research
handoff for authentic identity, premises, work and galleries, following the
recorded usage basis and acquisition restrictions. Complement them with Pexels
photos or videos for thematic wallpapers, full-bleed backgrounds, textures,
section imagery and selected effects. Both sources can serve the same site:
authentic photos establish the business; conceptual media supports its visual
theme. Match Pexels assets to the chosen brand palette and mood, retain credits
and representative labels, and do not imply stock depicts the actual business.

## Interaction and responsive behavior

Choose one clear primary action from the supplied customer journey and verified
destinations. Place it at natural decision points with consistent language;
secondary actions should support it. Do not automatically pair a call button
with directions. One action, supporting text links or no hero buttons are valid
choices. Choose control shape and treatment to fit the visual direction, without
requiring a filled button. A mobile sticky action is appropriate only when it
remains reachable without covering content, trapping scroll or competing with
navigation.

Honor an explicitly requested compatible effect and record the selected primitive,
assets, placement and selection source. AUTO applies to omitted choices. If an
explicit choice cannot work, report the constraint rather than silently replacing
it with a familiar effect. Video seeking, numbered image frames and two-image
reveals have distinct asset and rendering requirements.

Resolve effect names and recipe IDs from `$cinematic-interactions` at its actual
installed path: read `references/effect-catalog.md`, then only the selected
recipes and `references/gsap-scroll-foundations.md` when using GSAP. The catalog
also covers text reveal, perspective, zoom, sticky scenes, ticker, rotation,
spiral and horizontal galleries, and layered parallax. Preserve this template's
AUTO policy and effect budget; no new questionnaire is needed unless the user
asks to choose. Record each actual display name, recipe ID, section, assets and
fallbacks in DESIGN.md. Use `references/framer-scroll-effects.md` for a named
Framer example. Text/DOM effects need no video asset.

AUTO should actively explore advanced UI effects that make the content engaging
and useful. Choose their type, combination and placement for this business:
scroll-controlled video, image reveals, interactive galleries or another
content-led interaction are possibilities, not a required pair or closed menu.
Set the default effect budget to two as a maximum, not a quota. Plan selected
effects' communication roles and source suitable assets. Basic fades, image zoom
and ambient autoplay alone do not fulfill the ambition for advanced interaction.
Read the presentation reference for example patterns and selection criteria.

Preserve an explicit static/reduced-effect request or smaller effect budget.
Choose effects based on storytelling, media suitability, factual integrity,
accessibility and measured performance. Record the chosen effects and placement
rationale in DESIGN.md; a fully static site is valid when the brief or these
constraints call for it. The header/hero can be a composed static image even
when later sections use advanced interactions. A scroll-video background can
support a middle or later section, or the opening when that serves the content.
Do not reuse a fixed hero treatment, section order or effect sequence across
businesses; changing only assets and colors is insufficient. Use
`$cinematic-interactions` for selected effect implementations and
`$web-video-asset-preparation` when footage needs normalization. If a selected
effect's dependency is unavailable, report it rather than silently dropping the
effect and declaring the intended design complete.

Keep essential copy and actions in ordinary semantic HTML. Handle missing or
failed media, no JavaScript, Save-Data and reduced motion without hidden content
or overlapping panels. Reduced motion and Save-Data show a visible reason and
named motion opt-in; explicit opt-in restores usable geometry and motion.
Avoid custom cursors and scroll hijacking. Provide keyboard and touch
equivalents for pointer controls. Use visible focus,
clear labels, intentional heading order, readable contrast and meaningful alt
text. Menus, galleries and sticky actions must not trap input.

## Visual and interaction QA

Inspect actual desktop, tablet, narrow and wide mobile renders. Check long names,
large text, 200% zoom, optional missing sections, crops, contrast, hierarchy and
reachable actions. Verify keyboard order and all selected interactions. Check
header contrast before and after scrolling, mobile navigation access, font-load
and fallback layouts, button states, section transitions and footer usability.
Check that the hero has no eyebrow, the headline and fonts suit the actual name
and copy, the palette follows the recorded brand/business basis, and actions
remain discoverable when hero buttons are absent. Assess the composition as a
whole; changing an accent color alone does not establish a distinct design.
Review the full journey at normal reading speed. Check whether the visual idea
survives beyond the opening, scene changes support the message, and quieter
sections maintain the same care. Refine weak pacing and generic filler before
calling the site finished, even if its geometry and interactions pass.

Exercise slow or missing media, deep-scroll refresh, resize, back/forward
navigation, no JavaScript, reduced motion and Save-Data. Selected scroll effects
must move forward and backward, settle after rapid input and release sticky
positioning cleanly. Check static fallbacks and explicit motion restoration.

Investigate console and network failures. Record observed results, screenshots
and untested device limitations in the caller's validation report. Automated
geometry checks complement visual inspection; they do not prove a finished UI.
When the caller publishes, repeat the relevant checks against the served site.
