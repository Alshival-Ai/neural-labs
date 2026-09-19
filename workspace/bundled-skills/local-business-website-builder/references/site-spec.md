# Site Spec Contract

Use this contract when the work benefits from a repeatable handoff, a dashboard-generated input, or a record that can be reused across builds. YAML or JSON are both acceptable; preserve the same concepts rather than requiring every optional field.

```yaml
project:
  name: ""
  mode: "prospect-concept | new-client-build | redesign | audit"
  production_url: ""

lead:
  source_type: "user-selected | permitted-directory | referral | existing-client"
  source_note: ""
  website_status: "not-checked | no-official-site-found | site-found | client-confirmed-none"
  checked_at: ""

business:
  official_name: ""
  category: ""
  location_or_service_area: ""
  facts:
    phone: { value: "", status: "verified | client-provided | inferred | missing" }
    address: { value: "", status: "verified | client-provided | inferred | missing" }
    hours: { value: "", status: "verified | client-provided | inferred | missing" }

conversion:
  primary_action: "call | booking | reservation | directions | quote | visit | order"
  primary_destination: ""
  secondary_actions: []

brand:
  positioning: ""
  attributes: []
  art_direction: ""
  colors: {}
  typography: {}

content:
  tone: ""
  verified_claims: []
  missing_items: []
  prohibited_assumptions: []

pages:
  - path: "/"
    purpose: ""
    sections:
      - type: "hero"
        goal: ""
        content_status: "ready | draft | missing"

assets:
  - id: "hero-primary"
    path: ""
    role: "hero"
    source_url: ""
    provider_asset_id: ""
    creator: ""
    license: ""
    attribution: ""
    representation: "authentic | representative | generated"
    status: "ready | optional | missing | replace"
    focal_point: ""
    notes: ""

effects:
  - display_name: "" # Exact selected catalog name, or the user's explicit custom effect
    recipe_id: "" # Actual implementation recipe ID from the shared effect catalog
    mode: "" # For example: comparison, pointer, or drag for image-reveal
    selection_source: "explicit | questionnaire | agent-select"
    section: ""
    purpose: ""
    asset_ids: []
    mobile_fallback: ""
    reduced_motion_fallback: ""

integrations:
  booking: { provider: "", status: "not-requested | planned | configured | verified" }
  forms: { provider: "", status: "not-requested | planned | configured | verified" }
  analytics: { provider: "", status: "not-requested | planned | configured | verified" }

quality:
  required_checks: ["mobile", "accessibility", "performance", "local-seo", "production-build"]
  launch_blockers: []

preview:
  preferred_port: 3000
  actual_url: ""
  status: "not-started | running | verified | blocked"
```

Omit irrelevant fields rather than filling them with invented values. A dashboard may collect friendly form inputs and generate this contract; Codex remains responsible for inspecting the repository, resolving the specification against actual assets and constraints, implementing the result, and reporting conflicts.

For effects, use the [shared catalog](../../cinematic-interactions/references/effect-catalog.md). When selection is delegated, store the actual chosen display name and recipe ID with `selection_source: agent-select`; `agent-select` itself is not an animation recipe. `none` is valid, and text/DOM effects may have an empty asset list.

Preserve compatible existing specifications. When reading legacy `type` values, resolve `triggered-video` to `scroll-triggered-video` and `pointer-scrub` to `pointer-video-scrub`. Resolve `scroll-scrub` from actual assets and prior intent: video seeking and numbered frames require different recipes. Record the resolved recipe without silently changing behavior.
