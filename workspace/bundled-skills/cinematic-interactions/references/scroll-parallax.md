# Layered Parallax

Recipe ID: `scroll-parallax`. Inspiration: [mountain resource](https://framer.university/resources/mountain-parallax-effect), which separates a scene into layers moving at different rates. The subject need not be mountains.

## Construct

- Map aligned background, middle, and foreground assets to one shared coordinate system. Preserve their registration and responsive crop. A single flat image does not become a layered scene merely by duplicating it.
- Verify that backgrounds cover the areas exposed by moving foregrounds. Source or generate additional coverage only within the user's authorization. If required layers are unavailable, report that asset gap and provide an intentional static composite while independent work continues.
- Place layers in a stable clipped scene and move their children by different vertical distances on one local timeline. For example, use a small background travel, a larger middle travel, and the largest foreground travel; signs and magnitudes depend on the desired visual direction.
- Size the bleed beyond the crop for maximum travel plus responsive differences. Keep text and actions in a separate readable layer. Native unpinned section progress is usually sufficient.

## Adapt and verify

Reduce displacement on small screens; reduced motion displays a static aligned composite with no travel spacer. Verify at both extremes for holes, repeated edges, cutout halos, mismatched horizons, text occlusion, and excessive decoded image memory. Confirm all layers remain aligned after crop and viewport changes.
