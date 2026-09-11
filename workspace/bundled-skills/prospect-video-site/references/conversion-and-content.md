# Conversion, content and visual decisions

Use the completed research to plan and build this prospect concept. Record the
result in `WEBSITE-BRIEF.json`, `DESIGN.md` and `STORYBOARD.md` using the existing
[website brief contract](website-brief-contract.md). Research and asset provenance
remain canonical in `research.json`, `SOURCES.md` and `MEDIA.json`.

## Choose the customer journey

Choose one primary customer action from the verified offering and visitor needs:
call, plan a visit, view a menu, explore services, or follow a verified booking or
ordering link. Secondary actions should support it. Record the destination and
its evidence status; an unresolved destination must not become a fabricated link.
Omit unsupported actions or show an honest concept-only state and record the gap.

The first viewport should establish the business, offering, relevant location,
reason to continue and primary action. Repeat that action at natural decision
points with consistent language. A mobile sticky action is useful only when it
remains reachable without covering content, trapping scroll or competing with
navigation.

Choose sections by the questions a visitor needs answered. Offerings, process,
authentic work, business story, location, practical visit information and an FAQ
are options, not a mandatory sequence. Include a section only when evidence can
support its content and it advances the visitor's decision.

- Restaurants: menu, atmosphere, hours, location and verified reservation or
  ordering destinations; use the existing restaurant references for detail.
- Salons and studios: services, verified pricing, authentic portfolio, team,
  preparation and booking information.
- Trades: problems solved, service area, process, authentic work, verified
  credentials and a call or quote destination.
- Shops: product categories, reasons to visit, hours and directions without
  implying unverified stock availability.
- Clinics: services, verified practitioner information and appointment paths
  without unsupported treatment, insurance or outcome claims.

## Turn evidence into copy

Separate verified facts, supplied information, creative inferences and missing
or conflicting details. Write specific, scannable copy; an art-direction choice
is not evidence for a business claim. Preserve source status for phone numbers,
hours, prices, policies and other practical information.

Never invent reviews, testimonials, ratings, awards, credentials, guarantees,
availability, service areas or business history. Do not convert a rating into a
customer quote or copy competitor text, branding or designs. Read menus and
service sheets only from usable source material; ambiguous text does not justify
inventing items or prices. Keep unresolved details in the private brief, omit
unsupported public claims, and disclose material concept limitations clearly.

Use `tel:`, `mailto:`, directions, social, booking and ordering links only when
the destination belongs to the verified business. This concept does not submit
forms, accept payments or create reservations. A rendered interface does not
prove an integration works. Retain the prospect disclosure and noindex policy
specified by the parent skill.

## Manual QA

Apply `$website-template-1`'s visual, interaction and accessibility QA alongside
the parent's automated browser report. Also verify the business content:

- Identity, offerings, practical details and claims match their recorded evidence;
  no accidental placeholder, fabricated proof or misleading image remains.
- Navigation and every visible action reach the intended verified destination or
  clearly disclose their concept-only state. Do not submit external forms to test.
- Console and network failures are investigated. Preview URLs match the actual
  running server; use an available port without stopping unrelated processes.

Record observed results and unresolved limitations in `VALIDATION.md`. Passing
automated geometry checks does not establish content truth or complete manual QA.
