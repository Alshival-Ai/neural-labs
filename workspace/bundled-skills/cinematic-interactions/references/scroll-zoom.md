# Scroll Zoom Transition

Recipe ID: `scroll-zoom`. Inspiration: [zoom resource](https://framer.university/resources/zoom-scroll-effect). This recipe is an original focal-image expansion; inspect the source demo if a more specific composition is requested.

## Construct

- Identify the focal visual and the scene it should reveal. Use a stable clipped stage, an inner visual to scale, and independent copy layers. Establish meaningful first and last compositions before adding movement.
- Measure the visual's layout width/height and target stage dimensions before transforms. A cover scale is `max(targetWidth / visualWidth, targetHeight / visualHeight)`. Recompute on resize and preserve the subject with a deliberate transform origin and crop.
- Use one local timeline with an establishing beat, expansion, and a brief settled endpoint. Animate scale/translation on the inner visual; crossfade supporting copy only if the narrative changes.
- Ensure the final scene belongs to normal page flow after the pin releases. Do not jump the document or leave an invisible overlay intercepting clicks. Budget source resolution for the largest rendered size.

## Adapt and verify

On mobile shorten the range and reframe the focal subject. Reduced motion uses a static image with adjacent content and no zoom or pin. Verify both endpoints, maximum crop, pixelation, reverse handoff, following-section visibility, and no horizontal overflow. The primary action must remain reachable throughout.
