# Cinematic Effect Questionnaire

Use this selection gate after mapping the available assets and before substantial implementation. Its purpose is to help a user who may not remember effect names choose deliberately. The names and recipe links now live in the shared `$cinematic-interactions` [effect catalog](../../cinematic-interactions/references/effect-catalog.md); read it before presenting the question. Do not maintain a separate shortened menu here.

## Decide whether to ask

- If the user already named or clearly described an effect, the project records a choice, or the user delegated selection, follow that direction without asking again. Examples include “use this video as a scroll-controlled header,” “GSAP ScrollTrigger frame sequence,” “before/after slider,” and “choose a suitable effect.”
- If no effect was chosen, pause and ask one compact question: **Which signature effect should this site use?**
- Recommend one option based on the business story, available assets, mobile behavior, and performance. State the reason in one sentence.
- Present the complete canonical list from the shared catalog in its numbered order. Reproduce every bold display name exactly, including capitalization and punctuation. Do not shorten, merge, rename, paraphrase, or decorate a display name. A user's explicit custom effect remains valid even when it is outside the menu.
- Put a recommendation in a separate sentence before the list, such as `Recommended: option 2 because the supplied MP4 is seek-friendly.` Do not append “recommended” or business-specific wording to a canonical name.
- Do not silently choose a cursor reveal.

## Canonical effect names

Use all entries in [the shared catalog](../../cinematic-interactions/references/effect-catalog.md), including the original choices, the Framer-inspired scroll effects, and the static/delegated choices. Descriptions may be shortened; names and order remain unchanged. Continue independent work while awaiting the answer, but do not implement an unchosen effect.

## Handle the answer

Record these fields in the build brief or site specification:

- selected canonical display name, recipe ID, and mode when applicable;
- selection source: `explicit`, `questionnaire`, or `agent-select`;
- mapped media assets and any missing asset;
- mobile/touch behavior and reduced-motion fallback;
- why the effect supports the business story.

For `agent-select`, record the actual selected effect as well. An empty media list is valid for an effect implemented entirely with text or DOM elements. Use [the source map](../../cinematic-interactions/references/framer-scroll-effects.md) when the user references a Framer example; its scroll-media entry routes to the existing video or numbered-frame recipe according to the input.

If the selected effect needs an unavailable asset, ask one short follow-up offering only compatible paths: use attached media, source licensed representative media, generate suitable media when authorized, or choose another effect. Do not begin a different cinematic effect without approval.

Treat GSAP and ScrollTrigger as possible implementation tools, not as the effect itself. Choose the media primitive first. Most browser-compatible MP4 files can be attempted with direct video scroll scrubbing, but smooth, accurate results still depend on codec support, duration, resolution, keyframe spacing, metadata, file size, and mobile decoding limits. A frame-sequence effect does not consume an MP4 directly; export and validate numbered frames only when its exact endpoints justify the added payload. A paused video, a numbered image sequence, and a before/after pair have different loading, rendering, and quality requirements.
