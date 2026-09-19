---
name: website-template-1
description: Compatibility entry point for existing Neural Labs website automations; uses the active local-business-website-builder for business-specific design, imagery and motion.
---
# Website Template 1 compatibility

Read `$local-business-website-builder` and its Neural Labs workflow adapter.
That skill now owns presentation, photo-led direction, asset choices, effects and
visual QA. Keep `experience.templateSkill: website-template-1` when the caller
explicitly selected this name; otherwise site-generator defaults to the active
builder. Do not load two presentation directors or repeat orchestration.

Preserve existing project identity, recorded explicit choices and output scope.
For a new build use evidence-led/AUTO plus qualityVersion 2. Omitted effects are
chosen for the content, with at most two major interactions unless the user
explicitly requests more. Static content is valid; a video/hover pair is not required.

Read the builder's business-photo-direction, asset-policy and quality-contract
references before design. For selected frame motion read motion-quality and the
cinematic-interactions recipe. Existing automation references to design-system,
asset-direction, visual-review and richboys-method remain process supplements;
the active builder's sourcing policy and quality gates govern new builds.
