---
name: cinematic-interactions
description: Build, add, replace, or compose section-scoped cinematic effects in web projects, including media reveals and scrubbing, GSAP ScrollTrigger text reveals, zoom, sticky scenes, tickers, rotation, 3D galleries, horizontal galleries, and layered parallax. Use for selected website-builder effects or isolated cinematic interactions; do not use for ordinary video players, basic entrance fades, or unrelated animation work.
---

# Cinematic Interactions

Turn text, images, videos, and page elements into maintainable interactions that fit the project's existing framework and page flow.

## Start with the project

1. Read the applicable `AGENTS.md` files and inspect the framework, existing sections, media primitives, animation utilities, styling conventions, and input handlers.
2. Determine whether the request is `standalone`, `add`, `replace`, or `compose`. Infer obvious intent; ask only when placement, order, or replacement scope would materially change the result.
3. Preserve working structure and reuse compatible primitives. Do not force plain HTML/CSS/JS into a React, Next.js, Vue, or other established stack.
4. Map every required asset before editing. Text and DOM-only effects do not require video or generated imagery. When local source files need validation, resolve and run the bundled [media inspection script](scripts/inspect-media.mjs) with `node <skill-directory>/scripts/inspect-media.mjs <paths...>`. Report a missing or unreadable required asset and continue independent work; never invent a placeholder or external URL or silently substitute another effect.

## Website-builder handoff

In Neura, `$site-generator` and `$local-business-website-builder` are the active website callers; `$website-template-1` is a compatibility adapter. Resolve the selected effect through the shared [effect catalog](references/effect-catalog.md). Preserve the caller's existing AUTO policy as delegated selection; do not introduce a questionnaire unless the user asks to choose or the caller requires a choice. Honor explicit or recorded effects without asking again. An isolated effect request goes directly to its recipe.

For the Framer University article or its named examples, read [the source-to-recipe map](references/framer-scroll-effects.md). These are original code implementation recipes inspired by the documented behaviors, not imported Framer components or exact replicas.

## Select the relevant recipe

- Scroll text reveal, zoom, 3D perspective, sticky scene, ticker, rotation, spiral, horizontal gallery, or layered parallax: select the linked recipe from [the effect catalog](references/effect-catalog.md), then read [GSAP scroll foundations](references/gsap-scroll-foundations.md) when using GSAP. Load only the selected recipes.
- Cursor or pointer image reveal: read [references/image-reveal.md](references/image-reveal.md).
- One gesture plays a complete video: read [references/scroll-triggered-video.md](references/scroll-triggered-video.md).
- Pointer position seeks a paused video: read [references/pointer-video-scrub.md](references/pointer-video-scrub.md).
- Section scroll progress seeks a paused video: read [references/scroll-video-scrub.md](references/scroll-video-scrub.md).
- Section scroll progress renders numbered image frames: read [references/scroll-frame-sequence.md](references/scroll-frame-sequence.md).
- Multiple modules or transitions: read [references/combined-experience.md](references/combined-experience.md), then only the recipes for included modules.

## Shared invariants

- Scope coordinates, progress, observers, listeners, and locks to the interaction section. Never calculate an embedded effect from the whole document or viewport when the section has its own bounds.
- Render uploaded or repository media directly. Keep video muted and `playsInline` when it is decorative or interaction-controlled. Preserve captions and controls when media conveys content.
- Gate duration-dependent logic on loaded metadata. If a valid source still reports no duration or dimensions in the target browser, transcode a local browser-friendly WebM derivative, retain the original as a fallback source, record the derivative in the asset manifest, then rerun metadata and full-playthrough checks. Keep seek-controlled videos paused and write `currentTime` no more than once per animation frame.
- Prefer native scroll. If a triggered transition must consume input, do so only while its active section owns the gesture, and always release on completion, error, unmount, reduced motion, or an explicit skip.
- Provide a complete static reduced-motion path: readable text, an ordinary gallery or scene, or a poster for media. Remove unused pinning and spacer height. Add a touch/mobile alternative when the desktop interaction depends on hover or mouse position.
- Clean up animation frames, observers, media listeners, pointer listeners, and animation-library contexts on unmount.
- Avoid layout reads inside raw high-frequency handlers. Read bounds when needed, store targets, and perform visual writes inside a single `requestAnimationFrame` loop.

## Verify before reporting completion

Exercise the interaction in a real browser at desktop and mobile widths. Check forward and reverse input where supported, pointer leave, reload state, reduced motion, media errors, console errors, and document stability. Run the repository's lint, typecheck, tests, and production build in proportion to the change.

Report the selected intent, asset-to-role mapping, reused primitives, files changed, reduced-motion/mobile behavior, and the observable checks that passed.

When validating or revising this skill package itself, read [the validation guide](references/validation.md). Separate package checks, browser mechanics, and independent skill-following results; a passing fixture does not establish all three.
