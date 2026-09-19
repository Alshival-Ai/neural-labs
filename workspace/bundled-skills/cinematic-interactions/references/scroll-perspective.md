# 3D Perspective Scroll

Recipe ID: `scroll-perspective`. Inspiration: [Fey resource](https://framer.university/resources/fey-website-in-framer), which describes scroll-triggered transforms of an image in 3D. Use the project's own visual rather than copying the reference interface.

## Construct

- Put the visual in a scene wrapper with CSS `perspective`; animate a child plane. Set an intentional `transform-origin` so the object appears anchored while tilting. Keep readable copy outside the tilted plane.
- Define a legible initial angle, a face-on presentation, and an exit state. A starting experiment is a modest X-axis tilt and slight scale reduction easing into a frontal view; angles and distances must follow the actual composition.
- Connect `rotationX`, `rotationY`, translation, and scale to one section-local timeline. Add depth-separated planes only when assets support them. Pin only when the presentation needs a sustained reading beat.
- Keep the stage's measured geometry stable. Provide safe visual bounds around rotated corners and do not animate both CSS and GSAP transforms on the same node.

## Adapt and verify

On narrow screens reduce tilt and depth or use the frontal static visual. Reduced motion uses a frontal composition in ordinary document flow. Verify first and final readability, corner clipping, reverse traversal, resize, and readable supporting text. A text-heavy screenshot must not become the only source of essential content.
