# Scroll-Driven Ticker

Recipe ID: `scroll-ticker`. Inspiration: [ticker resource](https://framer.university/resources/ticker-scroll-component-for-framer): repeated content moves with scrolling rather than autoplay.

## Construct

- Create one meaningful row of text, logos, or images and visual copies sufficient to cover the clipped viewport throughout movement. Measure one complete repeat width `W`, including the seam gap, after fonts and media settle. Skip wrapping if `W` is zero.
- Drive horizontal offset from section progress, not elapsed time. For signed travel `t = p * distance`, a repeating offset is `x = -(((t % W) + W) % W)`. The direction comes from the sign of distance. Build enough identical repeats so the wrap never exposes an empty edge.
- With GSAP, tween a numeric travel proxy linearly and set the wrapped track position on animation update, or use the project's equivalent transform utility. Direct scrub gives immediate stillness when scrolling stops. Do not add an independent infinite autoplay tween.
- Mark decorative clones `aria-hidden` and remove duplicate focus targets/IDs. Keep a single readable semantic list. Essential interactive content belongs outside the wrapping strip.

## Adapt and verify

Use smaller travel on mobile. Reduced motion shows a static wrapping row or grid. Verify seam continuity in both directions, resize remeasurement, no movement while idle, no duplicate announcements or hidden tab stops, and no page-wide horizontal scrollbar.
