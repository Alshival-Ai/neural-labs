# Restaurant Preview Pipeline and Approval Gates

Use this pipeline for a new restaurant concept, a material revision, or client
preparation. A direct owner request can authorize continuous work on an
independent demo, but it cannot manufacture client approval or authorize an
official production release.

## Phase contract

| Phase | Input | Executor | Durable output | Approval gate | Failure conditions | Next phase |
| --- | --- | --- | --- | --- | --- | --- |
| 0. Scope and change safety | Owner request, repository/run inventory | OpenClaw | Operating mode, exact run/hostname, active-work check, explicit exclusions | Owner intent is clear | Ambiguous target; active overlapping edit; requested action exceeds demo authority | Identity |
| 1. Exact identity | Name plus city/address/URL | OpenClaw research | Resolved listing, Place ID, source record, ambiguity/omissions | Gate 1 candidate facts ready | Two plausible matches; business cannot be resolved | Restaurant data |
| 2. Restaurant data | Places, first-party sources, approved client files | OpenClaw research | `research.json`, `restaurant.json`, `SOURCES.md`; verified actions and missing fields | Gate 1 business facts approved for client use | Conflicting identity, hours, phone, address, menu, reservation, or order data | Direction |
| 3. Brand and direction | Approved facts, client brief, references | OpenClaw recommendation; Director/Human decision | `DESIGN.md`, conceptual-vs-official brand labels, primary visitor journey | Gate 2 brand/creative direction approved | Direction is generic, unsupported, or presented as approved without decision | Assets |
| 4. Media and rights | Client media, official assets, bounded stock research | OpenClaw research | `MEDIA.json`, research copies, roles, rights/distribution status | Gate 3 assets and rights approved | Unknown rights, deceptive stock use, missing attribution, unusable media | Storyboard |
| 5. Interaction plan | Approved direction and assets | OpenClaw recommendation; Director/Human decision | `STORYBOARD.md` with zero, one, or two purposeful scroll effects, placement, media relationships, and fallbacks | Gate 4 interaction/storyboard approved | Design hides conversion, copies another restaurant, exceeds two effects, or lacks mobile/fallback intent | Conditional motion proof |
| 6. Motion proof | Approved interaction plan and critical media | OpenClaw implementation | Smallest coherent proof of the highest-risk effect wherever the design places it | Gate 5 primary entry experience approved when applicable; preview may remain pending | Motion/fallback/accessibility/media budget gate fails | Complete design |
| 7. Complete design | Passing motion proof and approved direction | OpenClaw implementation | Research-led layout, features, content, and remaining approved interactions | Gate 6 complete experience approved for client track | Jitter, scroll trap, generic composition, excessive transfer, mobile crop failure | Functional UX |
| 8. Restaurant UX | Verified menu, phone, hours, location, reserve/order URLs | OpenClaw implementation | Semantic menu and normal-flow conversion sections | Gate 7 conversion/business UX approved | Broken/unverified action; hidden facts; stale or synthetic menu; missing caveat | Client readiness |
| 9. Client readiness | Complete preview and all source records | OpenClaw QA | QA JSON, targeted screenshots, `VALIDATION.md`, change report | Review candidate ready; not client acceptance | Console/build/media/link failure; mobile overflow; source mismatch; disclosure absent | Preview release |
| 10. Build handoff | Passing QA and complete artifacts | OpenClaw build skill | `BUILD-RESULT.json` and release-ready run | Human/Director may review before preview release | Artifact/digest/QA gate fails | Separate release skill |
| 11. Device and client review | Verified preview URL from separate release | Human Producer/Director | Device notes, requested revisions, Gate 8 result | Gate 8 physical-device QA and client review approved | Real-device motion/crop/action issue; factual correction; client rejection | Revision or production handoff |
| 12. Production handoff | Approved preview and client-owned credentials/assets | Director/Human with separately scoped engineering | Production scope, deployment ownership, SEO/schema plan | Gate 9 production release approved separately | Missing ownership, legal, accessibility, performance, or deployment approval | Outside this overlay |

## Approval records

Each gate record in `VALIDATION.md` should contain:

- gate number and subject;
- `pending`, `approved`, `rejected`, or `not-required-for-independent-demo`;
- decision owner;
- timestamp when approved/rejected;
- artifact or evidence reviewed;
- limitations or required revisions; and
- the next authorized phase.

Do not use an AI-generated timestamp or statement as proof of human approval.
For an independent demo, record which client gates remain pending even when the
owner authorized uninterrupted preview construction.

## New concept path

Use the base isolated-run contract. Complete research, design, and interaction
planning before implementation. Prove the highest-risk scroll effect first,
then complete the freely chosen layout and functional experience. This order is
an engineering gate, not a visible act structure or hero requirement.

The exact design is restaurant-specific. Regardless of layout, visitors need:

1. immediate identity and primary actions;
2. a coherent sense of the restaurant's verified identity;
3. usable menu and conversion information; and
4. relevant trust, location, hours, contact, disclosure, and credits.

These are functional roles, not locked section names or compositions.

## Existing preview revision path

Before editing:

1. locate the exact run and live domain;
2. inspect `research.json`, `SOURCES.md`, `DESIGN.md`, `STORYBOARD.md`,
   `MEDIA.json`, `VALIDATION.md`, `REPORT.md`, and `site/`;
3. inspect file timestamps and running processes for overlapping work;
4. identify the current immutable release and factual limitations; and
5. state which files and user-visible areas the revision will affect.

Preserve the current concept, media behavior, disclosures, and verified facts
unless the request changes them. Extend the existing design language rather
than inserting a generic component system. Re-run the full base QA wrapper
after any HTML/CSS/JavaScript change, then capture changed sections directly.

## Client-preparation path

Client preparation is an audit plus a revision, not a claim that the preview is
official. Check:

- exact public identity and contact details;
- current hours and their displayed caveat;
- current menu evidence, source date, legibility, and conflicts;
- verified Call, Directions, Menu, Reserve, and Order destinations;
- visibility of conversion actions during and after cinematic scenes;
- placeholder, synthetic, unsupported, or accidental concept copy;
- media attribution, rights status, and non-deceptive labeling;
- independent-preview disclosure and no-index behavior;
- mobile menu/category navigation and long-content layout;
- reduced-motion and media-failure states;
- site file/transfer budgets; and
- `REPORT.md` limitations and approvals still outstanding.

Return a new release-ready build only after the changed site passes. Publishing
that build belongs to the separately authorized release skill.

## Agent and human boundary

OpenClaw may research, normalize evidence, recommend direction, implement the
independent preview, and run QA. The separate release skill may publish only
when the owner request authorizes that workflow. Neither may approve its own factual,
creative, rights, client-acceptance, device, or production gates.

When working inside a larger Human Producer → Director → OpenClaw/Codex
workflow, OpenClaw returns structured evidence and a review handoff to the
Producer/Director. It does not directly instruct Codex, reinterpret Director
approval, or broaden a handed-off implementation scope.

## Handoff format

The completion response and `REPORT.md` should state:

- exact restaurant and location;
- operating mode;
- exact run directory and intended preview hostname;
- build digest and release-readiness state;
- material changes;
- factual and menu sources with dates;
- media rights/attribution status;
- automated and targeted QA evidence;
- physical-device status;
- simulated or unavailable functionality;
- omitted/conflicting facts;
- gates approved and still pending; and
- safest next review action.

Never describe a successful build or intended URL as proof that the site is
live or that the client or production release is approved.
