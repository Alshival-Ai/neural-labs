# Image Reveal

Use two decoded images with compatible composition: `front` is the covered image and `reveal` is underneath.

## Behavior

- Stack the images in an isolated, overflow-clipped section. Use `object-fit: cover` by default and preserve a configurable focal point.
- Reveal the lower image by applying a soft radial CSS mask to the front layer.
- Use Pointer Events. Convert `clientX` and `clientY` through the section's `getBoundingClientRect()` so the mask remains correct in embedded and responsive layouts.
- The raw pointer handler stores a target. One `requestAnimationFrame` callback writes CSS custom properties for position and radius.
- Close the mask on pointer leave, pointer cancel, loss of capture, and blur.
- For coarse pointers, offer an intentional tap/drag reveal or show a stable partial composition; do not ship a mouse-only blank interaction.
- Under reduced motion, show a static front image unless the product design explicitly chooses a static split view.

## Acceptance checks

- Both real files decode and map to the intended roles.
- The reveal follows the pointer within the section at different viewport sizes.
- Leaving the section restores the front image.
- Touch fallback and reduced-motion behavior are understandable without instructions.
