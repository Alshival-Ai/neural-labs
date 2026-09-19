# 3D Spiral Gallery

Recipe ID: `scroll-spiral-3d`. Inspiration: [spiral resource](https://framer.university/resources/spiral-3d-scroll-animation): depth-arranged cards rotate within a held scene. Treat the source's arm layout as inspiration rather than a fixed card count.

## Construct

- Use a perspective wrapper around a `transform-style: preserve-3d` assembly. Choose radius, vertical pitch, angular spacing, and total rotation from card count and legibility.
- One original layout model is `theta = i * angularStep`, `x = radius * sin(theta)`, `z = radius * cos(theta)`, and `y = (i - (count - 1) / 2) * pitch`, with angles in radians for trigonometry. Orient card wrappers deliberately and compose the assembly's scroll rotation separately from each card's hover treatment.
- Keep the assembly inside a stable pinned or sticky stage; animate its rotation and vertical travel using one timeline. Do not put flattening filters or clipping on the depth-preserving assembly. Place necessary viewport clipping outside it.
- Prefer a decorative animated gallery plus a usable ordinary project list. Cards turned away or occluded must not leave invisible links in keyboard navigation.

## Adapt and verify

Use an ordinary grid or accessible native scroller for narrow screens and reduced motion. Verify card overlap, backfaces, focus visibility, image loading, and release of the stage. Check the full collection is available even when the 3D scene is disabled. Use this heavier effect selectively, with fewer visible layers when performance requires it.
