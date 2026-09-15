# Media-first presentation

Apply this presentation as part of Website Template 1. Adapt the identity,
content and visual language to the supplied brief.

## Outcome contract

Aim for these outcomes:

1. a near-viewport opening with a full-bleed image or poster behind the exact
   business identity and a dominant headline, which may be the business name;
   useful next steps remain discoverable through navigation, inline links or
   relevant page sections, with hero buttons optional;
2. advanced UI effects chosen for a distinct communication job, with creative
   freedom in their type, combination and page position; and
3. a composition and section rhythm shaped by this business's story.

For AUTO, explore purposeful interactions and seek suitable assets within the
template's effect budget. Scroll-video backgrounds and image overlays/reveals
are examples, not mandatory ingredients. A static header/hero is a complete
design choice; advanced effects may live entirely in middle or later sections.
Choose those sections from the content rather than repeating a page formula.

The preferred examples succeed through scale, layering, pacing, and media
coverage. Do not copy their palettes, typefaces, chapter names, progress rails,
headlines, or exact section structures.

## Compose scenes, then connect them

Use the storyboard to coordinate media, words and page progress. A scene needs
an initial composition, a useful development and an intentional exit. Decide
what the visitor should notice at each beat; let copy length, focal subjects and
meaningful media changes determine the pacing. Avoid cycling interchangeable
headlines over an unrelated clip.

Several narrative beats may share one video background and controller. Give each
beat a defined local progress range, media range, copy placement and mobile
treatment. Keep one narrative panel visible at a time in enhanced mode. In the
static version, place the useful content in readable document order. A scene
with one strong message can keep its copy still while the media develops.

Design the handoff into the next section as carefully as the immersive field:
release sticky positioning, restore normal reading pace and connect the next
message through spacing, alignment, color or a deliberate image edge. Carry
the business's visual language across the change without repeating its layout.

## Build the opening as a media field

Choose the strongest truthful landscape asset for the first screen. Prefer a
suitable `business-authentic` image. When none has sufficient resolution,
composition, or preview rights, use a licensed `conceptual-ui` image or poster
with a visible representative/concept label and copy that cannot imply it is
the business.

- Make the opening approximately `80–100svh` after any compact notice/header.
- Let media cover the complete opening field with a deliberate focal point and
  responsive crop; layer contrast treatment rather than placing the image in a
  side card, oval, or bounded panel.
- Let the H1 establish visual dominance with a responsive display scale. It
  must overlap the media field, remain readable at 200% zoom, and avoid hiding
  the focal subject.
- Do not place an eyebrow or small introductory label above the H1. Compose the
  business-name or editorial heading with supporting copy as needed, rather
  than requiring a category/location label, value statement and CTA stack.
  Useful context can live in supporting copy or practical details. A hero with
  no buttons is valid; keep next steps discoverable elsewhere in the page.
  Motion is never required to identify the business or reach an action.
- Use a local responsive image/poster. A selected short-GOP scroll-controlled
  video may own the opening media field when its communication value and
  transfer budget are stronger than the still; do not add decorative autoplay
  video merely for atmosphere.

An opening fails this profile when most of the viewport is a flat text field
and the primary image is confined to one column, even if that split layout is
otherwise polished.

## When selected, use scroll video as a background scene

A recorded `scrollVideoEffect` is one available advanced effect. When selected
for this profile, it must be a viewport-scale background scene rather than a
video card beside copy. Its section does not have to be the header/hero.

- Use a sticky stage close to `100svh` with native scroll travel sufficient for
  the planned beats. Roughly `220–400svh` is a starting range for a multi-beat
  scene, not a required length; shorten simple scenes and adapt compact screens
  to avoid empty travel or rushed copy.
- Position the local poster and video to cover the stage. Use `object-fit:
  cover` and art-directed `object-position`; create a mobile derivative only
  when crop or decode measurements justify it.
- Layer a restrained shade/grade, cinematic copy, progress state, or original
  business-specific graphic system over the moving background. Essential facts
  and actions remain ordinary HTML.
- Map section progress monotonically to a bounded media range through the
  latest-target seek coordinator. Preload only critical metadata/media and
  release the sticky stage cleanly into normal document flow.
- Label conceptual footage in the scene and include creator/Pexels credit in
  ordinary flow. Never describe conceptual footage as the business's location,
  team, work, products, food, customers, or process.

A scene fails this profile when the video remains a landscape rectangle inside
a two-column section, a rounded content card, or a narrow media well while most
of the viewport is an unrelated solid field.

### Choose its page position, do not inherit one

The scroll scene may be the opening/header media field, a middle transition, or
a later explanatory chapter. No position is preferred. Use the opening when
the initial poster/frame is the strongest truthful identity surface and the
progression introduces the business's core idea. Use another region when an
authentic still establishes identity better or the progression answers a later
customer question. Do not repeatedly default to either a static opening plus a
second-section scene or an animated opening. One section may carry both
`data-opening-media-background` and the scroll-scene hooks; it must then satisfy
both initial-screen and scroll behavior contracts.

## Image overlay and pointer interaction patterns

These are optional patterns within the overall effect budget. They can stand
alone or accompany another effect when each serves a distinct purpose; they do
not require a scroll-video background or a fixed position in the page.

### Image hover overlay

Use a service or gallery image with an intentional overlay that reveals a useful
caption, detail or action on hover and `:focus-within`. Animate the overlay's
opacity or translation with restrained timing; image zoom alone is insufficient.
This pattern needs only one image; choose it when revealing detail helps the
visitor understand or act on the content.

- Use a semantic link for navigation or button for disclosure; avoid nested
  interactive elements. Keep an accessible name and visible focus indicator.
- On touch/coarse-pointer devices, show the useful overlay persistently or
  provide an explicit tap control. Do not make the first tap on a link merely
  simulate hover.
- Keep essential information available without hover or JavaScript. Reduced
  motion removes animation while preserving the overlay's content and action.
- Add `data-image-hover-overlay` to the region. Capture its resting and active
  states; verify pointer hover, keyboard focus, touch behavior and contrast.

### Two-image spotlight reveal

Use two related full-frame stills—for example atmosphere/context, exterior/
detail, or day/night conceptual moods. Stack both cover images. Reveal the
alternate layer with a radial or linear CSS mask whose center follows pointer
position through one `requestAnimationFrame` update.

- Support pointer enter, move, drag, capture, leave, and cancel.
- Make the region focusable. `Enter` or `Space` toggles a useful centered reveal
  for keyboard users.
- On touch, support drag; do not rely on hover availability.
- Under reduced motion or failure, present one intentional still or a static
  side-by-side relationship with complete labels.

### Pointer/range video scrub

Map horizontal pointer position to the same bounded media range used by a
visible `<input type="range">`. The range is the keyboard and touch contract,
not an optional debug control. Attach the source near the viewport, preserve a
poster, ignore touch pointer-move when it conflicts with page scroll, and use
the same latest-target seek rules as scroll control.

Do not add pointer effects as decorative cursor tricks. They must reveal a
relationship or useful image detail; keep the behavior specific to that content.

## Machine-checkable hooks

Set the document and opening hooks on every profile build. Add the scroll-video
hooks only when that optional effect is selected so browser QA can distinguish
an intentional still design from a broken or missing controller:

```html
<html data-presentation-profile="cinematic-media-first">
  <section data-opening-media-background>...</section> <!-- or combine this hook with the scene below -->
  <section data-scroll-video-effect data-scroll-video-background>
    <div data-scroll-video-stage>
      <video data-scroll-video muted playsinline ...></video>
      <div data-scroll-video-copy>...</div>
    </div>
  </section>
  <script src="app.js"></script>
</html>
```

The opening media may be a CSS background or a full-cover descendant `<img>` or
`<video>`. The H1 must geometrically overlap that media. The scroll stage, video,
and overlay copy must occupy the same viewport-scale field. Use
`data-image-hover-overlay`, `data-image-reveal` or `data-pointer-scrub` on the
selected pattern. Check its actual input behavior and save before/after
captures separately; the common QA helper does not test these pointer patterns.

These attributes document intent; they do not replace screenshot inspection.
When the scroll hooks are present, QA must load the local video, sample forward
and reverse scene positions, observe monotonic `currentTime` movement and a
visible frame difference, verify rapid latest-target settling, and save a
mid-scene capture in every viewport. When the scene contains multiple narrative
panels, exactly one is visible in enhanced mode and its state changes through
the sampled range. An
empty video, ambient autoplay, CSS-only transition, or geometry without a
working controller fails the selected effect.
The controller must be a shipped local external file so it executes under the
preview host's `script-src 'self'` policy. Before it initializes, CSS must show
no more than one positioned narrative panel; the deliberate static fallback
may expose all panels only after placing them in non-overlapping normal flow.
Inspect desktop, tablet, and mobile captures for crop, contrast, hierarchy,
sticky release, awkward dead space, and accidental resemblance to a prior
site. Verify slow, stopped, reverse, and rapid motion plus reduced-motion,
Save-Data, no-JavaScript, and media-failure fallbacks.
Record enhanced/static state and any fallback reason in data attributes so a
silent desktop fallback cannot masquerade as a successful still design. After
deployment, repeat these checks against the final HTTPS URL under its real CSP
and byte-range delivery.
