# Horizontal Scroll Gallery

Recipe ID: `scroll-horizontal`. Inspiration: [horizontal resource](https://framer.university/resources/horizontal-scrolling-effect): downward scrolling moves panels sideways through a held viewport. This differs from a normal swipe-only carousel.

## Construct

- Use a stable stage containing a clipping viewport, flex track, and semantic panels. After layout, compute `distance = max(0, track.scrollWidth - viewport.clientWidth)`. Measure the actual clipping viewport; an outer stage's padding or a narrower inner frame must not enter that width. In a simple unpadded layout, the stage can also be the viewport. Do not assume equal panel widths or multiply panel count by viewport width.
- If distance is zero, leave an ordinary row/grid without a pin. Otherwise tween the track from `x: 0` to `x: -distance` with direct scrub. Use section-local pinning and an end distance derived from the measured horizontal travel and chosen pacing.
- Use function-based values and rebuild the branch when content or width changes between overflowing and fitting. Fonts, decoded media, panel gaps, and responsive sizes must be included in measurement.
- Keep the document's vertical scroll native. For interactive panels, bring a focused offscreen panel into view through the corresponding vertical progress, or choose a native horizontally scrollable layout. Never clip essential focus targets with no way to reach them visually.

## Adapt and verify

Mobile may use a labeled native swipe row or vertical cards. Reduced motion removes pinning and transforms and exposes every item. Verify the first and last panels, zero-overflow behavior, reverse traversal, keyboard focus, resize/content updates, and no accidental horizontal overflow of the document.
