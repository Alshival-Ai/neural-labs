# Cinematic Effect Catalog

This is the shared source of display names and recipe IDs for the personal website builders. The original nine choices retain their names and order; new choices follow them.

## Selection workflow

Neura caller policy: an established AUTO directive from the selected website workflow counts as delegated selection. Preserve its effect budget and preferences, and use this menu to resolve the chosen recipe. Only present a questionnaire when the user asks to choose or the caller requires one.

When building or redesigning a site without an effect choice, ask: **Which signature effect should this site use?** Present every bold name below in numbered order. Names must remain exact; descriptions can be shortened. Put the recommendation and its reason separately, without renaming an option. Use the available question UI, or one readable numbered list when it cannot show all choices.

Wait for the selection before implementing an unchosen effect; continue research, content, asset mapping, and other independent work meanwhile. A prior recorded choice or a clear user description counts as a selection. If the user delegates the choice (including “surprise me”), choose and record a compatible effect without another question. Explicit requests for a custom effect outside this menu remain valid; record the user's wording and implementation plan rather than forcing an approximate menu option.

Save the display name, recipe ID, selection source (`explicit`, `questionnaire`, or `agent-select`), section, purpose, asset IDs, mobile behavior, and reduced-motion fallback. For `agent-select`, also save the actual chosen effect. Offer combinations when requested; listing effects does not authorize using all of them.

## Canonical effect names

1. **Scroll-controlled frame sequence** (`scroll-frame-sequence`) — numbered images follow scrolling, including exact endpoints. [Recipe](scroll-frame-sequence.md).
2. **MP4 video controlled by scroll** (`scroll-video-scrub`) — scrolling seeks through a paused MP4; requires suitable encoding. [Recipe](scroll-video-scrub.md).
3. **Video that plays on entry** (`scroll-triggered-video`) — an eligible section plays its clip after the qualifying gesture. [Recipe](scroll-triggered-video.md).
4. **Before-and-after comparison** (`image-reveal`, comparison mode) — compare a matched pair of images. [Recipe](image-reveal.md).
5. **Interactive pointer reveal** (`image-reveal`, pointer mode) — a localized mask follows the pointer to expose another image. [Recipe](image-reveal.md).
6. **Interactive drag reveal** (`image-reveal`, drag mode) — drag a boundary to explore a matched image pair. [Recipe](image-reveal.md).
7. **Pointer-controlled video scrubbing** (`pointer-video-scrub`) — pointer position seeks a paused video; needs a touch alternative. [Recipe](pointer-video-scrub.md).
8. **No cinematic effect** (`none`) — use static content and restrained ordinary transitions; no cinematic recipe needed.
9. **Surprise me—keep it varied** (`agent-select`) — choose for the story and assets. Check available nearby prospect specifications and avoid repeating the latest signature effect when another suits the brief. This is deliberate variety, not claimed randomness.
10. **3D perspective scroll** (`scroll-perspective`) — tilt and reposition a visual in depth as the section progresses. [Recipe](scroll-perspective.md).
11. **Scroll text reveal** (`scroll-text-reveal`) — progressively emphasize words or phrases while the passage remains visible. [Recipe](scroll-text-reveal.md).
12. **Scroll zoom transition** (`scroll-zoom`) — enlarge a focal visual into the next scene. [Recipe](scroll-zoom.md).
13. **Sticky scene choreography** (`scroll-sticky-scene`) — hold a stage while objects and copy move through story beats. [Recipe](scroll-sticky-scene.md).
14. **Scroll-driven ticker** (`scroll-ticker`) — repeated text or visuals move as the visitor scrolls. [Recipe](scroll-ticker.md).
15. **Scroll rotation** (`scroll-rotation`) — rotate a graphic or group in response to scrolling. [Recipe](scroll-rotation.md).
16. **3D spiral gallery** (`scroll-spiral-3d`) — arrange cards in depth around a rotating spiral. [Recipe](scroll-spiral-3d.md).
17. **Horizontal scroll gallery** (`scroll-horizontal`) — vertical scrolling carries a row of panels sideways. [Recipe](scroll-horizontal.md).
18. **Layered parallax** (`scroll-parallax`) — foreground and background layers move by different amounts. [Recipe](scroll-parallax.md).

## Match the content

Text reveal can work with copy alone. Perspective, zoom, and rotation can use a suitable existing graphic. A ticker needs enough meaningful content to repeat. Sticky scenes need a sequence of content states. Galleries need coherent collections; a spiral requires more space and stronger mobile simplification. Layered parallax needs aligned layers with enough hidden background coverage.

GSAP is an implementation tool, not an effect choice. A video file, a numbered image sequence, a comparison pair, and ordinary DOM elements require different loading and rendering strategies. Never convert between them silently.
