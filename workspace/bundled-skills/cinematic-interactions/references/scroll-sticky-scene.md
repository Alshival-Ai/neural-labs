# Sticky Scene Choreography

Recipe ID: `scroll-sticky-scene`. Inspiration: [Tedy resource](https://framer.university/resources/tedy-website-scroll-animation-in-framer), which holds a scene while scrolling controls its objects.

## Construct

- Write a few concrete beats such as introduce, assemble, explain, and resolve. Map every copy block and visual to its start, visible, and end states. Use a semantic section containing a stage and independent child layers.
- Give the stage one timeline and one progress owner. Put labeled beats and explicit overlapping tweens on that timeline rather than a separate pinned ScrollTrigger on each object. Use holds where the viewer needs time to read.
- Use transforms and opacity on children; do not move the stage that provides measured bounds. Translate Framer trigger-section concepts into timeline ranges rather than creating hidden DOM trigger frames unnecessarily.
- Avoid making disappearing copy the only semantic version of the story. Keep a readable ordered narrative, and keep controls outside transient layers or explicitly manage their visibility and focusability.

## Adapt and verify

For mobile or reduced motion, lay the beats out as ordinary stacked content with all information available. A desktop multi-beat scene does not imply several viewport heights of empty mobile scrolling. Check that beats remain coherent during fast scroll, reverse, and mid-section reload, that only intended layers overlap, and that the final stage releases cleanly into subsequent content.
