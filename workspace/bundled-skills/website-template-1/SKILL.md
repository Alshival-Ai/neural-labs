---
name: website-template-1
description: Apply Website Template 1 to a website build or redesign when requested by the user or calling workflow. Provides media-first composition with preferred scroll-controlled video backgrounds and image hover overlays, evidence-led visual decisions, responsive UI/UX, accessibility and visual QA guardrails while adapting the design to the supplied identity and content.
---
# Website Template 1

Use this as a reusable set of design guidelines and guardrails. Keep composition,
typography, palette and section rhythm specific to the supplied identity and
content; the template defines presentation quality rather than fixed copy,
colors or a repeated page layout. Apply it when selected, not to unrelated sites.

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

## Media-first composition

Read [media-first-presentation.md](references/media-first-presentation.md) for
the opening geometry, optional scenes, interaction behavior and QA hooks.
Use a near-viewport full-bleed media field with readable identity, a dominant
headline. Hero buttons are optional; keep useful next steps discoverable through
navigation, inline links or relevant page sections without waiting for motion.
Do not substitute a split hero, framed video or bounded image card for the
opening media field.

Map each asset to a communication role with an intentional desktop/mobile crop,
focal point, aspect ratio, alt-text purpose and replacement notes. Keep source
and usage records in the caller's asset manifest. Use efficient image and font
loading and reserve media space. Essential identity, copy and actions must work
before media or animation loads.

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

AUTO should actively design for a scroll-controlled video background and one
image hover overlay or reveal. Set the default effect budget to two. Plan their
communication roles and source suitable media before deciding to omit them;
zero effects is an exception, not an equally preferred starting point. A fade-in,
image zoom, or ambient autoplay loop does not substitute for either interaction.
Read the presentation reference for the patterns and selection criteria.

Preserve an explicit static/reduced-effect request or smaller effect budget.
Omit or replace a preferred effect when media suitability, factual integrity,
accessibility or measured performance requires it. Record the concrete reason,
assets considered and alternative in DESIGN.md and the final report; generic
claims that motion is decorative do not explain a decision. A scroll scene can
own the opening or appear elsewhere; neither placement is the default. Use
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

Exercise slow or missing media, deep-scroll refresh, resize, back/forward
navigation, no JavaScript, reduced motion and Save-Data. Selected scroll effects
must move forward and backward, settle after rapid input and release sticky
positioning cleanly. Check static fallbacks and explicit motion restoration.

Investigate console and network failures. Record observed results, screenshots
and untested device limitations in the caller's validation report. Automated
geometry checks complement visual inspection; they do not prove a finished UI.
When the caller publishes, repeat the relevant checks against the served site.
