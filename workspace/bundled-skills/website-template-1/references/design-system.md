> Current workflow: use local-business-website-builder as the presentation owner.
> Read its business-photo-direction, asset-policy and quality-contract references.
> The active policy supersedes older stock defaults in this process supplement.

# Design system and component guidance

Use with the template's selected presentation and art direction. Resolve visual choices from
the supplied brand, content, audience, assets and primary action. Examples
illustrate possibilities, not a shortlist of fonts, section orders or
business-category rules.

## Header, navigation and first screen

Compose the header and opening together: a compact overlay, a typographic
masthead or a separate navigation rail can each work. Choose from the identity,
headline and available image composition. A bounded photograph and text outside
the image are valid. Keep required notices distinct from navigation and preserve
readability through every scrolled-header state.

Align the identity, navigation, hero copy and following sections to shared inner
rails; let media width follow the selected composition. Use the supplied logo with its
clear space and proportions. If none exists, use a readable text identity rather
than fabricating an official-looking mark. Pick left-aligned or centered identity
from the composition and available width; do not squeeze navigation around it.

Keep a short set of useful links. A header action is optional; the primary
customer action can live in navigation, inline copy or a relevant later section.
Design default, hover, focus, active and scrolled-header contrast intentionally. If the header
sticks, reserve its space and offset anchor targets so it does not hide headings.
Test navigation over the lightest and darkest media frames, not just the poster.

At narrow widths, keep essential links reachable through a compact layout or an
accessible menu; hiding desktop navigation without a replacement is insufficient.
A menu button needs an accessible name, expanded state and clear open/close
behavior. Support Escape, sensible focus return and scroll behavior appropriate
to whether the menu is an inline disclosure or modal drawer.

## Hero heading and supporting copy

Use a small location/category label when it adds useful context and suits the
composition. It is optional, as are section numbers. Avoid generic filler labels
and keep the H1 dominant. Preserve navigation, identity and concept disclosure.

Choose the heading's job from the identity and content: a business name as the
dominant H1, a meaningful editorial headline, or a concise offer-led statement
supported by verified facts. For example, “The Shave Cave” can carry the hero
with a short catchphrase below. Do not automatically replace every business name
with a generic slogan. Supporting slogans are creative copy, not evidence of an
official tagline, service promise or other business claim.

Choose alignment, measure, case, scale and line breaks around the actual words
and media focal point. Put category/location context where it reads most clearly:
a concise label, supporting copy or practical details.
Do not force a two-line slogan, paragraph and paired-button stack on every site.
These are composition options, not a rotation schedule; explicit user choices
take precedence.

## Typography choices and hierarchy

Choose display, body and utility roles before selecting fonts. Usually one or
two families suffice. A display face carries personality; body text, navigation,
practical details and controls need durable readability. Use supplied fonts when
usable, otherwise choose a compatible family with the required characters,
weights and licensing. Do not assume a CSS family name means its font loaded.

Select the display face for this business's personality and the actual heading's
letterforms and length. Consider serif, humanist, geometric, condensed or other
appropriate display treatments; do not repeatedly reach for the same condensed
uppercase face. Vary weight, case, scale and selective italic emphasis when they
strengthen the identity, while keeping body and UI roles readable.

Two example directions drawn from archived local-business sites:

| Direction | Display role | Body/UI role | Useful visual relationship |
| --- | --- | --- | --- |
| Bold, sign-inspired | Bebas Neue or a suitable condensed display sans | Manrope or a legible sans fallback | Tall compact headlines against clear, relaxed supporting copy |
| Warm editorial | Georgia or a suitable editorial serif, with selective italic emphasis | A neutral sans; Inter only when actually provided, otherwise system sans | Soft expressive headings against precise navigation and practical details |

These pairs illustrate relationships, not a shortlist or assignments to every
restaurant or salon. Avoid using a condensed or decorative display face for
long paragraphs. Use uppercase
and tracking sparingly for short navigation, utility labels or section numbers;
never sacrifice readable size to preserve a desktop row.

Define fluid H1, H2, body, label and control scales with `clamp()` and a real small
screen floor. Compose headline line breaks around the image and meaning. Control
measure (roughly 45–70 characters for prose is a starting range), line height and
spacing separately for display and body roles. Very tight display leading from
an example is not a safe default: check ascenders, descenders, accented text,
wrapping and 200% zoom. Let line breaks adapt on mobile rather than overflowing.

Load only needed font files and weights, use a deliberate fallback stack and
`font-display` strategy, and test with the font unavailable. Preload only a
critical font that will actually be used. Keep icon fonts out of essential labels.

## Palette, surfaces and contrast

Name semantic roles: canvas, raised surface, primary ink, secondary ink, accent,
accent ink, rule/border, media scrim and focus. Verify each intended text/surface
pair and all interactive states; a palette swatch does not prove readable UI.

Derive the palette from supplied brand guidance, usable logos and official
materials first. When those are absent, use the business's character, audience
and positioning and record the result as a creative assumption. Avoid assigning
one palette to an entire business category. Conceptual stock media is not proof
of the business's brand colors. Record the palette's basis in DESIGN.md.

There is no default orange accent or house palette. Orange is appropriate when
the brand/business direction supports it, just as other hues or a restrained
monochrome palette may be. Carry the chosen palette through controls, surfaces,
type and media treatment; do not retain an unrelated orange call button.
Reserve the strongest accent for useful emphasis; do not give every label,
border and button equal
weight. Choose scrim direction and opacity around focal subjects and copy,
rather than uniformly darkening every image. Color must not be the only signal
for links, active navigation, errors or selected controls.

## Spacing, section rhythm and content layout

Choose a shared content width, fluid gutters, spacing scale and a few deliberate
section densities. Start from readable copy and usable controls, then allow
headline and media scale to create drama. Align repeated edges across the page;
full-bleed media may break the content rail without breaking the reading order.

Alternate purposeful forms: a media field, an editorial introduction, structured
offerings, an authentic gallery, practical information and a final action are
available roles. Choose their order from the customer journey. Avoid repeating
the same three-card grid or making every section a full-screen scene.

Within later content sections, a small label, fine rule or section number can
help orientation; do not turn it into a repeated heading ornament or a hero
eyebrow. A desktop heading/body split can collapse into a clear single-column
reading order. Plan light/dark
surface transitions, whitespace and image edges as part of the rhythm; do not
insert decorative separators or empty scroll distance to manufacture drama.

## Buttons, links, icons and component states

Choose actions and labels from visitor needs and verified destinations; “Call
the shop” plus “Get directions” is not a required pair. A hero can have one
action, a supporting link or no buttons. In the latter case, make the next step
discoverable through useful navigation, inline links or a clear contact/visit
section; do not add a first-screen button merely to satisfy a template habit.

Use filled, outlined or text-link treatments according to the composition and
action hierarchy. Primary emphasis can come from placement, spacing, type or
contrast rather than a mandatory filled rectangle. Choose crisp, softly rounded
or pill corners to fit the brand; none is the default. Define padding, minimum
usable target size, radius, label weight, icon size and gaps consistently across
the site. Use icons only when useful rather than attaching the same arrow to
every action.

Design hover, focus, pressed, disabled, loading and error states where relevant.
Short color or underline transitions are enough; movement must not shift nearby
layout or be required to understand the control. Keep touch targets generous
(around 44 CSS pixels is a useful design starting point), and keep labels readable.

Use links for navigation and buttons for actions. Give icon-only controls an
accessible name; use visible text for unfamiliar actions. Choose one icon family
with consistent stroke, size and optical alignment. Decorative icons should not
repeat the same label to assistive technology. A control that looks usable must
have a real destination, honest demo state or clear disabled explanation supplied
by the calling workflow.

## Images, galleries and supporting content

Choose aspect ratios, focal points and mobile crops by role. Pair captions with
the media they describe, and make representative-media labels and credits readable
in normal flow. A gallery should help inspect actual offerings or context; it is
not filler. If a lightbox is useful, provide close/previous/next controls, keyboard
and touch access, focus return and a non-JavaScript route to the content.

Design menu-like lists, service rows, hours and contact information for scanning:
align labels and details, preserve units and allow long text to wrap. Do not force
practical information into a carousel, cinematic overlay or tiny caption. Keep
structured facts readable when optional images or whole sections are absent.

## Closing action and footer

End with an intentional decision point using the established primary action.
The footer should resolve identity, useful navigation and caller-supplied contact,
credits, disclosures or legal links. Group these by purpose and collapse columns
in a sensible mobile order. Avoid a duplicate giant hero, fabricated badges or
an empty social-icon row. Reserve bottom space for any fixed mobile action and
safe-area inset so the final links remain reachable.

## Component review

Review header/hero as one composition; font-loaded and fallback states; headline
wraps at narrow widths and zoom; control states; anchor offsets; mobile menu;
section density; image captions; gallery controls; footer and fixed actions.
Record chosen fonts, role tokens, component treatments, breakpoints driven by
content, headline approach, palette basis and action placement in DESIGN.md.
Check a business-name heading with supporting slogan, editorial copy and any
no-button hero according to the selected design, including long names and
discoverability of next steps. A good screenshot at one width
is not sufficient evidence of a usable design system.
