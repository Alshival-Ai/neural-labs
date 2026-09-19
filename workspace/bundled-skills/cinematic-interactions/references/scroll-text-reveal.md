# Scroll Text Reveal

Recipe ID: `scroll-text-reveal`. Inspiration: [text reveal resource](https://framer.university/resources/text-reveal-effect): a held passage changes emphasis as scrolling advances.

## Construct

- Use a short real passage. Preserve its semantic reading order and spaces. Split into word or phrase spans only as needed; do not replace the paragraph with a screenshot or announce each scroll update with `aria-live`.
- Keep the full passage readable in a muted but sufficiently contrasting style. Progressively emphasize tokens using color or a decorative overlay. Do not hide information until a reader completes the animation.
- For `n` phrases and local progress `p`, compute `a = min(n - 1, floor(p * n))` for a discrete active phrase. For gradual cumulative emphasis, use per-phrase progress `clamp(p * n - i, 0, 1)`. Choose one behavior to match the brief; set it from absolute progress so reverse scroll and reload work.
- Pin a short passage only if it benefits reading. When line-based measurement is required, wait for fonts and rebuild line grouping on width changes. Avoid an extra text-splitting dependency for simple word spans.

## Adapt and verify

Mobile may use an unpinned paragraph with a shorter range. Reduced motion shows the whole passage with normal contrast and no travel spacer. Verify screen-reader output is one coherent passage, text zoom and wrapping work, and the last phrase reaches its intended state at the endpoint.
