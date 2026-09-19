# GSAP Scroll Foundations

Read for the selected scroll recipe when implementing with GSAP. Respect an explicit GSAP request; otherwise reuse the project's capable animation system. Do not add smooth-scroll libraries just to implement these patterns.

## Progress and layout

Give each effect a semantic section, a stable stage, and animated children. Use one scroll-controlled timeline for objects sharing a stage. Prefer `ease: "none"` and `scrub: true` for direct, reversible progress; use a numeric scrub only when deliberate smoothing suits the brief. Define a section-local `trigger`, `start`, and `end`.

Choose either CSS sticky inside a section with intentional travel height, or ScrollTrigger pinning with its spacer. Do not apply both to the same stage or nest pins. Animate children, not the measured/pinned element. Use function-based geometry and `invalidateOnRefresh: true` for responsive dimensions. Refresh after geometry-changing fonts/media settle, not on every scroll update. [ScrollTrigger documentation](https://gsap.com/docs/v3/Plugins/ScrollTrigger/).

Treat progress as an absolute value, never accumulated wheel deltas. Reloading mid-section, reversing, and jumping past a section must produce the correct state. For a CSS-sticky stage, a typical local progress model is `clamp((scrollY - sectionTop) / travel, 0, 1)`, where `travel` is the section height minus stage height; skip the effect if travel is zero. Account for a nonzero sticky top offset or a custom scroller in the geometry.

## Lifecycle and fallback

Build timelines after mount. Use scoped `gsap.context()` or the project's GSAP React integration, and revert only this component's animations on teardown. Never kill every ScrollTrigger on the page. Keep DOM node references or scoped selectors. Clean up separate event listeners and observers too. [Context documentation](https://gsap.com/docs/v3/GSAP/gsap.context%28%29/).

Use `gsap.matchMedia()` for responsive and reduced-motion branches, with `revert()` on unmount. Its callbacks collect GSAP animations for reversion as conditions change. The reduced-motion branch should create the complete static layout without scroll pinning, hidden content, or leftover travel height. [MatchMedia documentation](https://gsap.com/docs/v3/GSAP/gsap.matchMedia%28%29/).

Keep the default markup readable before JavaScript initializes. Do not put essential links inside invisible or offscreen animated layers. When a scene cannot expose every item accessibly, supply an ordinary content layout. Use separate wrappers for scroll transforms and hover transforms so they cannot overwrite each other.

## Acceptance checks

- Traverse start, midpoint, end, and reverse; then reload in the middle and jump beyond the section.
- Resize through the responsive breakpoint; check for duplicate triggers, stale transforms, and spacer gaps.
- Test touch, keyboard/focus visibility, reduced motion including a live preference change, and normal access to following content.
- Check slow or failed media, clipping, horizontal document overflow, and route unmount/remount. Verify the selected recipe's additional checks in the real site.
