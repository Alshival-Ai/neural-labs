# Scroll Frame Sequence

Use this when a section's scroll progress should select numbered still images instead of seeking a compressed video. Prefer it when exact endpoints, deterministic stepping, or unreliable video seeking justify the additional requests and decoded-image memory. Do not convert an ordinary video to frames by default; compare payload, quality, mobile cost, and native seek behavior first.

## Prepare and map the assets

- Define one manifest or path function with the frame count, filename pattern, dimensions, focal point, and first and final frames. Record the total compressed payload and whether the media is authentic, representative, or generated.
- Inspect at least the first, middle, and final files with the media inspection script. Confirm consistent dimensions, format, orientation, and readable final-state content. Verify that every numbered file exists before browser QA.
- Create a narrower or lower-density mobile sequence when the desktop sequence would impose an unreasonable mobile payload or decoded-memory cost. Choose the variant before preloading begins.
- Load and decode the first and final frames first. Request remaining files during idle time or in directional lookahead order. Decode the requested frame and a small neighbor window; do not eagerly decode every high-resolution frame without measuring memory.

## Render without flashes

- Keep a static loading poster visibly underneath the animated renderer. Leave it available as the error fallback; hide it only after the first successful frame is painted.
- Prefer one persistent canvas. A two-image decoded double buffer is acceptable, but changing the `src` of one visible `<img>` can expose its background between compositor paints even after `decode()` resolves.
- Draw only a successfully loaded image with a nonzero natural size. While another frame loads or decodes, retain the previously painted canvas pixels. Dropped intermediate frames are acceptable during a fast gesture; an exposed background is not.
- Track the latest requested frame so a late decode cannot overwrite a newer target. Redraw the last successful image after resize.
- Cache stage width, height, device-pixel ratio, and focal point through initialization and `ResizeObserver`. Do not read layout for every frame. Cap backing-store pixel ratio when needed, and implement `cover` cropping explicitly so desktop and mobile focal points remain intentional.
- Do not clear the canvas between frames. Resizing resets its bitmap, so resize and redraw the retained image within the same observer callback.

## Control the sequence

- Map the interaction section's local progress to `0..frameCount - 1`; never use whole-document progress. Preserve native forward and reverse scrolling.
- Use a linear playhead. Avoid smoothing that leaves the displayed frame chasing the scroll position or prevents the final frame from appearing.
- When the completed state is important, reach the final frame before the pin releases and reserve a short final hold, commonly the final 10–15% of the section. Force the first and final frames when leaving in either direction.
- If the project already uses GSAP, use a scoped `gsap.context()` and a paused linear timeline controlled by `ScrollTrigger` with the section as `trigger`, a pinned stage, explicit `start` and responsive `end`, `scrub: true`, and `invalidateOnRefresh: true`. Use direct scrub rather than a catch-up duration when exact scroll-to-frame parity matters. Revert the context on unmount.
- Without GSAP, store a target from a passive scroll listener and perform canvas writes in one `requestAnimationFrame` loop. Either implementation must keep progress local to the section.

## Mobile, reduced motion, and failure paths

- Use a shorter intentional scroll range on touch devices and keep essential calls to action reachable. Verify that sticky or pinned behavior releases normally.
- If phase labels share coordinates, make them mutually exclusive on narrow screens. Fade the primary hero copy out before a large phase label appears; do not crossfade two oversized words through each other.
- Under reduced motion, do not create the pin or scrub controller. Show an informative static final poster and keep the section at ordinary page height.
- If canvas creation, a required frame, or decoding fails, keep the poster or last successful frame visible, release any input ownership, and expose a diagnosable error without leaving a blank surface.
- Disconnect resize observers, cancel idle and animation-frame work, revert animation contexts, and release image references on unmount.

## Acceptance checks

- Test slow initial loading: the poster remains visible until frame one is painted, with no blank or brand-color flash.
- Test rapid forward scrolling, rapid reverse scrolling, and small alternating gestures. The canvas never clears and late decodes never move the sequence in the wrong direction.
- Confirm frame one at progress zero, the expected intermediate frame at sampled progress values, and the exact final frame while it is still pinned.
- Test narrow mobile, wide mobile, tablet, and desktop widths. Check focal crops, phase-label collisions, scroll release, horizontal overflow, and responsive payload selection.
- Test reduced motion, one intentionally missing frame, resize or orientation change, refresh at deep scroll, back/forward navigation, console errors, and failed network requests.
- Measure shipped sequence bytes, request count, and memory behavior in proportion to the project. Run lint, tests, and a production build before reporting completion.

## Neural Labs continuous-motion quality

For local-business builds read
[motion-quality.md](../../local-business-website-builder/references/motion-quality.md)
and [quality-contract.md](../../local-business-website-builder/references/quality-contract.md)
before selecting source windows or extracting frames. Preserve native temporal
detail; a 3-fps sequence is not a smooth substitute for a 24-fps source. Shorten
the source window to fit the existing publication budget. Verify every frame,
continuous scrolling and static failure geometry, not just start/middle/end.
