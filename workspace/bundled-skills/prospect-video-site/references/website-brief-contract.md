# Website Brief Contract

Use this reference to turn either a short owner prompt or a future dashboard
submission into the same durable input. `AUTO` means the agent should decide
from verified evidence. Missing facts stay missing.

## Fast owner prompt

An owner can invoke the complete workflow with a compact request:

```text
$prospect-video-site

Build a private concept for <exact business and city>.
Website job: <AUTO or purpose>.
Primary action: <AUTO or one action>.
Style: <AUTO or short direction>.
Presentation profile: <AUTO, evidence-led, or cinematic-media-first>.
Authentic assets: <paths, URLs, or none>.
Pexels conceptual assets: <allowed or not allowed>.
Cinematic effect: <AUTO, none, or preference>.
Output: <private-build, local-review, or hosted-preview>.
```

For city discovery, replace the exact business line with `Find one prospect in
<CITY>` and let the discovery skill own selection. The owner may also provide a
structured brief with any fields below. Do not require every optional field.

## `WEBSITE-BRIEF.json`

Write schema version 1 outside `site/` after exact identity is established and
before substantial implementation:

```json
{
  "schemaVersion": 1,
  "project": {
    "mode": "prospect-concept",
    "inputMode": "city-discovery",
    "intendedOutput": "private-build",
    "productionAuthorized": false
  },
  "business": {
    "selectionSource": "selection.json",
    "name": null,
    "location": null,
    "category": null,
    "businessKind": null,
    "factStatus": "verified",
    "missing": [],
    "conflicts": []
  },
  "experience": {
    "presentationProfile": "evidence-led",
    "websiteJob": null,
    "audience": null,
    "customerFeeling": [],
    "tone": null,
    "languages": ["English"]
  },
  "conversion": {
    "primaryAction": null,
    "primaryCtaLabel": null,
    "primaryDestinationStatus": "missing",
    "secondaryActions": []
  },
  "content": {
    "verifiedClaims": [],
    "ownerProvided": [],
    "conceptCopy": [],
    "prohibitedAssumptions": [],
    "missing": []
  },
  "brand": {
    "artDirection": null,
    "decisionLedger": [],
    "typography": {},
    "colorRoles": {},
    "spacingAndShape": {},
    "imageTreatment": null,
    "layoutRhythm": null,
    "status": "conceptual"
  },
  "pages": [],
  "assets": {
    "authenticAvailable": [],
    "roles": [],
    "pexelsAllowed": false,
    "replacementNeeds": []
  },
  "effects": {
    "budget": 1,
    "selected": [],
    "placementDecision": null,
    "reducedMotionPlan": null
  },
  "integrations": {},
  "approvals": {},
  "sources": [],
  "createdAt": null,
  "updatedAt": null
}
```

Use values from `selection.json` by stable reference rather than maintaining a
contradictory second identity record. Each `decisionLedger` item should include
`observation`, `evidenceStatus`, `designConsequence`, and
`replacementTrigger`. Each page or section should state its purpose, customer
question, content status, primary action relationship, and asset roles.

`experience.presentationProfile` must be `evidence-led` or
`cinematic-media-first`. `AUTO` is an input instruction, not a stored value.
Use the current caller-selected template and profile, not a remembered automation
default. Website Template 1 normally selects `evidence-led` for original
composition, including image/DOM cinematic effects. An explicitly selected
`cinematic-media-first` design must satisfy its full-bleed geometry and QA contract.
Both profiles retain factual, accessibility, performance and release gates.

`effects.budget` is a maximum, not a quota. `effects.selected` may be empty when
the director decides motion would be decorative or suitable media is missing.
Every selected effect must carry a communication purpose and conditional QA;
do not add an effect merely because the budget permits one. Record why its
chosen region serves that purpose. For a scroll-video background, opening/header,
mid-page, and later-page placement are all available; do not default
`placementDecision` to `later` or treat the opening as mandatory. When no
effect is selected, record that no placement applies.

Asset roles should include `id`, `role`, `identityClass`, `status`, intended
placement, orientation/crop needs, and replacement notes. Final downloaded file
provenance remains canonical in `MEDIA.json`, not this brief.

Integration status must be one of:

- `not-requested`;
- `concept-only`;
- `verified-link`; or
- `configured-and-tested`.

Do not mark a form, order, reservation, booking, payment, analytics, map,
social, chat, or external widget operational merely because the interface can
be drawn.

## Established restaurant or bar preset

When evidence shows an established restaurant or bar that already attracts
customers but depends on social media, a suitable default is:

```text
websiteJob: Create an authoritative online home and make visit-planning
information easier to find without depending on Facebook.

primaryAction: Help visitors plan a visit.
primaryCtaLabel: View Menu & Hours.

secondaryActions: Get Directions, Call, Events, verified social profile.
```

If verified events or live music are the dominant reason to visit, prefer
`View upcoming events` with a CTA such as `See What's Happening`. These are
creative defaults, not business facts; change them when research supports a
better primary action.
