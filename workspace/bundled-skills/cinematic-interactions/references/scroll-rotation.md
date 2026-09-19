# Scroll Rotation

Recipe ID: `scroll-rotation`. Inspiration: [rotation resource](https://framer.university/resources/scroll-rotation-animation-in-framer), which rotates groups of logos during scrolling.

## Construct

- Select a graphic or intentional group whose rotation helps the composition. Put supporting text and essential controls outside it. Give the rotating child a stable origin and enough surrounding space for its largest bounds.
- Define start and end angles; use local progress to interpolate them. A small arc is often enough. Keep scale and visibility stable unless another change is explicitly part of the design.
- Use a direct scrubbed tween for one object or a single shared timeline for coordinated groups. Set opposite directions only when they communicate the intended relationship; avoid a collection of unrelated spins.
- If labels must stay upright, animate a separate inner wrapper by the inverse angle. Do not let hover transforms overwrite the scroll rotation.

## Adapt and verify

Reduce the angle on small screens and show a composed static angle for reduced motion, without a remaining pin spacer. Verify that rotated corners and shadows are not clipped unexpectedly, labels remain legible, reverse scroll reaches the original angle, and the graphic does not obscure the site's primary action. This is scroll rotation, not a time-based loading spinner.
