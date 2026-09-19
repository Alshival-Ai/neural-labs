# Visual System and Assets

Create a specific visual identity from the business's category, positioning, audience, permission-cleared physical and visual cues, and available media. Do not derive a design from restricted listing imagery or default every project to the same dark theme, gradient, glass panel, card grid, or oversized animated headline.

## Direction before decoration

Define a short art-direction statement covering:

- Brand attributes and customer feeling
- Dominant composition idea
- Color roles, contrast, and restraint
- Display and body typography roles
- Shape, border, spacing, and image-treatment language
- Motion character and maximum interaction intensity

Translate the direction into tokens for color, typography, spacing, radius, borders, shadows, content widths, and motion. Reuse tokens consistently; do not scatter arbitrary values across sections.

## Asset manifest

Map each file to a role before implementation:

| Role | Typical requirement |
| --- | --- |
| Logo or wordmark | SVG preferred; transparent raster acceptable |
| Hero media | Strong subject, intentional crop, desktop and mobile-safe composition |
| Services or menu | Consistent aspect ratio and visual treatment |
| Gallery or portfolio | Authentic work, captions or alt context when useful |
| Team or location | Current, credible, and permission-cleared |
| Social preview | Purpose-built wide crop with readable focal area |
| Video poster | Matches the video's initial or representative state |
| Cinematic source | Resolution, duration, framing, and encode appropriate to the selected interaction |

Record path, role, source URL or provider ID, creator when applicable, license, attribution obligation, authentic-versus-representative status, dimensions, crop or focal point, alt purpose, and replacement notes. Treat missing launch-critical identity or hero media as a visible blocker rather than silently filling it with unrelated stock imagery.

## Selecting effects

Use motion as hierarchy:

- Prefer one signature interaction plus restrained supporting transitions. Approve a second cinematic module only when it communicates a separate idea and the complete sequence remains calm and usable.
- Choose an image reveal when two related images communicate a meaningful before/after, exterior/interior, or surface/detail relationship.
- Choose triggered video when a short transition or transformation should play once.
- Choose pointer scrubbing when direct exploration of an object or sequence is useful.
- Choose scroll scrubbing when progression through a story is more important than ordinary playback.
- Do not use cinematic behavior when the assets are weak, the mobile fallback is unclear, or the effect delays the primary conversion.

When a cinematic interaction is selected, use `$cinematic-interactions` rather than re-deriving its implementation rules.
