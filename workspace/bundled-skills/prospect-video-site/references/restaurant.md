---
name: "cinematic-restaurant-builder"
description: "Apply factual restaurant data, menus, conversion UX, approval gates, and restaurant-specific QA inside a video-scroll website build."
metadata:
  openclaw:
    always: true
---

# Cinematic Restaurant Builder

Apply this domain overlay when a prepared selection is factually classified as
`businessKind: restaurant`. The calling `prospect-video-site` skill owns run
creation, cinematic composition, media preparation, build QA, and lifecycle.
This overlay owns restaurant truth, structured menu data, conversion UX,
approval reporting, and targeted restaurant QA.

Do not create another run, reselect the restaurant, deploy, notify anyone,
contact the restaurant, or claim affiliation. Do not copy another restaurant's
chapter names, layout, palette, motion language, or story.

This overlay does not prescribe restaurant sections, chapter names, a hero,
menu presentation, navigation, layout, typography, palette, or feature set. The
design agent retains the base skill's creative freedom while satisfying factual
restaurant and conversion outcomes.

## Work only from restaurant evidence

Read and follow:

- [`references/restaurant-data-and-truth.md`](restaurant-data-and-truth.md);
- [`references/restaurant-pipeline.md`](restaurant-pipeline.md); and
- [`references/restaurant-quality-and-qa.md`](restaurant-quality-and-qa.md).

Resolve the exact listing before using any fact. Prefer current first-party
sources, preserve provenance and retrieval time, document conflicts, and omit
missing information. Never infer a menu item, price, recipe, cuisine claim,
reservation policy, ordering option, service mode, award, review, history,
owner, chef, dietary claim, or availability from stock footage, reviews,
category conventions, or what would make the page feel complete.

Create schema-version-1 `restaurant.json` with verified identity, address,
contact, hours, actions, menu evidence, menu categories/items, social links,
source references, conflicts, omissions, and per-field verification status.
Research-only menu images and private evidence stay outside `site/`.

## Join visual attraction to practical restaurant UX

Research determines the narrative and visual language. The ordinary page flow
must expose each verified action that actually exists:

- Menu;
- Call;
- Directions;
- current listed hours;
- Reserve only with a verified reservation destination; and
- Order Online only with a verified ordering destination.

Keep essential actions reachable during the visual/interactive experience; visitors must
not finish the story before finding them. A front-end-only ordering or booking
demonstration must say it is a concept and must not send or retain data.

## Transcribe menus conservatively

Prefer current first-party HTML, PDF, client files, or official social posts.
For a third-party menu image, verify restaurant identity against strong
identifiers; record host page, exact image URL, source label, printed date, and
retrieval time; transcribe only legible facts; disclose source/date limits; and
tell visitors to call to confirm. Do not distribute the source image unless its
publication rights are independently approved.

If sources conflict, omit disputed items or stop menu publication. A newer
first-party source outranks a directory. Never merge incompatible menu versions
into a synthetic menu.

## Record approval state honestly

In `VALIDATION.md`, report these gates as approved, pending, rejected, or not
applicable only from actual evidence:

1. business facts;
2. brand and creative direction;
3. media and usage rights;
4. storyboard;
5. primary entry experience, including a hero only when the design uses one;
6. complete designed experience;
7. conversion and restaurant UX;
8. physical-device QA; and
9. production release.

An owner-authorized private demo build does not make client facts, creative
direction, media, copy, device QA, or production release client-approved.
Never promote a demo to production or mark a human gate approved autonomously.

## Extend QA beyond the initial viewport

Apply the base browser QA and inspect targeted mobile/desktop captures of the
menu, hours, actions, and location—not only the initial viewport. Verify menu
source/date caveats, exact Call and Directions targets, verified Reserve/Order
links, structured-data consistency, long-item wrapping, touch targets,
landscape and portrait layout, reduced motion, and continued video/media
fallback behavior.

Return restaurant artifacts and QA evidence to the calling build skill. A
passing overlay means the site is ready for the base skill's final build gate;
it never means live, client-approved, or production-approved.
