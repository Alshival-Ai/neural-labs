---
name: site-generator
description: Build, redesign, or continue a polished website from a brief, selected business, or existing project. Coordinate visual direction, implementation, media, browser review, and deployment when requested.
---
# Site generator

Create a coherent website that fits the user's audience, content and intended
visitor action. Preserve an existing project's framework, conventions and working
features. A business name, website URL or ordinary website brief is enough to
start; no business listing, paid integration or public domain is required.

## Resolve the project

Read the project's instructions and inspect its files. Reuse the supplied project
or choose an unused directory under the current workspace's `projects/`. Resolve
only ambiguities that affect identity or the requested result. Do not scout
business prospects, reserve domains, contact businesses or create automations.

Read [workflow-contract.md](references/workflow-contract.md) for project artifacts,
validation and deployment. Building defaults to local preview. Publish only when
the user requests it, using `$deploy`; a skill invocation alone does not request
publication. Preserve existing deployment identity when updating a requested app.

## Give the site a direction

For a selected local business, use `$business-research-and-media` and
`$local-business-website-builder`. For other sites, derive direction from the
brief, audience and available content. Honor a user-selected design skill when
available; report a missing selected skill instead of silently substituting it.
Keep one visual direction; do not force business-specific schemas onto a portfolio,
product page or simple Hello World site.

Before substantial implementation, record the site's purpose, primary action,
typography, color roles, composition, asset roles and responsive behavior in
`DESIGN.md`. For a multi-scene or cinematic site, read
[act-production.md](references/act-production.md) and write `STORYBOARD.md`.
Scale these notes to the task: a simple page needs only a short brief.

Use supplied assets and usable authentic material where relevant. External media
and generated imagery are optional; discover actual tool availability and honor
usage rights. A strong typographic or original graphic design can stand alone.
Never require a new API key, paid generation attempt or a fabricated testimonial.

## Build and inspect

Prove the strongest composition and hardest interaction first, then develop the
remaining content with the same care. Static design is valid. Use
`$cinematic-interactions` only for selected effects and
`$web-video-asset-preparation` only for selected video. Read only the recipes that
apply. Preserve keyboard, touch, reduced-motion and failed-media behavior.

Use the existing framework and build scripts. Keep private research, source media
and credentials outside the public output directory. Check the actual page using
the available browser tools at desktop and mobile widths. Inspect screenshots,
navigation, controls, content, console errors and selected motion in both
directions. Record observed results and fixes in `VALIDATION.md`; unavailable
checks remain incomplete. A file check or screenshot capture is not visual review.

## Deliver

Return the source location, local preview route, design decisions and actual QA
results. Distinguish a concept's missing integrations from working features.
When deployment is requested, use `$deploy` and report its returned URL/status;
verify the served page and assets with browser tools. Hosting configuration and
TLS belong to the deployment service. Never use host SSH, private infrastructure,
or another workspace's content to complete the task.
