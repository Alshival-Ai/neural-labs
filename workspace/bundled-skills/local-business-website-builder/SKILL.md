---
name: local-business-website-builder
description: Research, plan, build, redesign, audit, and locally preview high-quality websites for local service and storefront businesses using verified information, licensed assets, conversion-focused structure, distinctive visual direction, selective cinematic effects, local SEO, accessibility, performance, and browser QA. Use for human-selected business prospects and authorized client work involving restaurants, barbers, salons, trades, shops, studios, clinics, and similar location-based businesses; do not use for automated lead scraping, unsolicited outreach, generic SaaS products, complex ecommerce platforms, or one isolated visual effect.
---

# Local Business Website Builder

Create a credible, distinctive website that helps a local business earn a specific customer action. Orchestrate the full prospect-to-preview workflow with one invocation while keeping research, asset licensing, implementation, and external-action boundaries explicit. Move quickly by standardizing decisions and verification, not by making every business look the same.

## Neural Labs integration

This is the active design/build skill transferred from the personal Codex skill.
For a name-and-address request, read [neural-labs-workflow.md](references/neural-labs-workflow.md)
first. It adapts orchestration, tool discovery, default creative choices, quality
gates and preview links to this runtime. It replaces the desktop-only preview
and effect-questionnaire defaults below. Do not require a style questionnaire
when only a name/address was supplied; omitted creative decisions are AUTO.
Explicit user choices always take precedence. Keep one presentation director.

## Run the end-to-end workflow

Use the stages that match the request; one invocation may run the entire sequence:

1. `Scout`: Start from a user-selected candidate or a permitted lead source. For Google Maps or another restricted listing service, read [references/lead-discovery.md](references/lead-discovery.md). Do not scrape, bulk-export, or build a prospect database from restricted content.
2. `Verify`: Create an evidence ledger and independently confirm launch-critical facts. Read [references/intake-and-evidence.md](references/intake-and-evidence.md).
3. `Source`: Read [business-photo-direction.md](references/business-photo-direction.md) and [asset-policy.md](references/asset-policy.md). Inspect the actual business first and build the asset manifest. When stock photos or videos are requested, read [references/licensed-asset-sourcing.md](references/licensed-asset-sourcing.md). Treat Pexels media as licensed representative content, not public-domain evidence of the actual business.
4. `Translate`: Convert verified business characteristics, permission-cleared visual cues, and the asset set into an original design system. Read [references/style-translation.md](references/style-translation.md) and [references/visual-system-and-assets.md](references/visual-system-and-assets.md).
5. `Specify`: Choose the conversion architecture and record the content, pages, assets, effects, and blockers in [references/site-spec.md](references/site-spec.md).
6. `Build`: Implement the site in the existing framework or initialize the user-requested stack when the destination is empty. Keep claims and integrations honest.
7. `Enhance`: Honor explicit or recorded effects. For name/address-only requests, use AUTO to choose a purposeful effect or a strong static composition; do not require the desktop questionnaire. Record the chosen recipe, content primitive, purpose and fallback. Use `$cinematic-interactions` and the exact recipe. GSAP/DOM choreography, paused video, numbered frames and layered images require different implementation and QA. Usually use one signature scene; add a second only for a different communication job. Follow explicit user effect budgets.
8. `Preview`: Use the Neural Labs workspace preview route from AGENTS.md, open the real page, and complete browser QA using [references/quality-gates.md](references/quality-gates.md) and the runtime adapter. Use the existing deploy workflow only within the requested output scope.

## Establish the job

1. Read applicable `AGENTS.md` files and inspect the repository, framework, styling system, reusable components, content, assets, and existing integrations before changing code.
2. Classify the request as `prospect concept`, `new client build`, `redesign`, or `audit`. Determine the primary conversion: call, booking, reservation, directions, quote, visit, order, or another user-specified action.
3. Separate `verified`, `client-provided`, `inferred`, and `missing` information. Never invent reviews, ratings, awards, certifications, prices, availability, service areas, or business history. Do not publish, contact a business, or submit external forms without explicit authorization.
4. If the input is a public listing, screenshots, or scattered notes, use them only within their source permissions and read [references/intake-and-evidence.md](references/intake-and-evidence.md). Ask only for missing information that would materially change the build; otherwise mark it clearly and continue with reversible assumptions.

## Plan before implementation

1. Read [references/conversion-architecture.md](references/conversion-architecture.md) when choosing pages, section order, calls to action, and trust signals.
2. Read [references/visual-system-and-assets.md](references/visual-system-and-assets.md) when establishing art direction, design tokens, image/video roles, or an asset acquisition plan. Use [references/licensed-asset-sourcing.md](references/licensed-asset-sourcing.md) before downloading third-party media.
3. Produce or update a concise build brief before substantial implementation. When a reusable handoff or dashboard-compatible input is useful, use [references/site-spec.md](references/site-spec.md).
4. Map every required asset to a page role and record whether it is authentic, representative, ready, optional, missing, or needs replacement. Preserve source and license records. Do not silently substitute unrelated stock media or external URLs. Generate or source new assets only when the user authorizes it and an appropriate tool is available.
5. Choose one recognizable visual idea and one primary conversion path. Prefer a clear hierarchy and business-specific composition over a collection of interchangeable cards.

## Build the site

- Preserve the repository's established framework and conventions. Reuse compatible primitives and repair only what the requested work puts in scope.
- Make the first viewport establish the business, location or service area when relevant, customer value, and primary action without relying on animation to explain them.
- Write specific, scannable copy grounded in verified information. Keep unknown content visibly marked in prospect concepts and out of production claims.
- Use responsive image sizing, intentional crops, stable aspect ratios, efficient font loading, semantic HTML, visible focus states, keyboard access, and reduced-motion behavior.
- Treat mobile as a primary conversion surface. Keep essential actions reachable without obscuring content or trapping scroll.
- Add only interactions that strengthen the story or clarify the offering. Implement the selected signature effect recorded in the site specification; do not substitute a different effect merely because it is easier or familiar. Pair it with restrained ordinary transitions. For cinematic media interactions and the shared catalog's text, zoom, perspective, sticky-scene, ticker, rotation, spiral, horizontal-gallery, and parallax effects, use `$cinematic-interactions`, read the matching recipe, and follow its asset, accessibility, performance, and verification requirements.
- Implement local-search metadata only from verified facts. Read [references/local-seo-and-trust.md](references/local-seo-and-trust.md) for production SEO, structured data, maps, contact information, reviews, or trust claims.
- Do not make forms, reservations, payments, ordering, analytics, or third-party widgets appear operational unless the corresponding integration is actually configured. Use an honest non-submitting demo state for prospect concepts.

## Verify the result

For builds, redesigns, and audits, read [references/quality-gates.md](references/quality-gates.md) and apply the relevant gates. Test the real page in a browser at desktop and mobile widths, exercise navigation and conversions, inspect the console and network failures, and run the repository's lint, typecheck, tests, and production build in proportion to the change. Do not kill an unrelated process to claim port `3000`; reuse the current project server when appropriate or report the actual fallback URL.

Report the build mode, primary conversion, lead-source boundary, verified-versus-missing content, page and section decisions, authentic-versus-representative assets with attribution obligations, cinematic features if any, files changed, local preview URL, observable QA results, and unresolved launch blockers.
