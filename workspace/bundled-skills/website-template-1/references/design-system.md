# Design system and component guidance

Use with the template's media-first presentation. Resolve visual choices from
the supplied brand, content, audience, assets and primary action. The examples
below illustrate two possible directions; they are not compulsory palettes,
font dependencies, section orders or business-category rules.

## Header, navigation and first screen

Compose the header and opening together. Prefer a compact overlay or visually
continuous header when the image supports readable navigation. Use a solid or
translucent contrast surface when identity, a complex logo or the crop needs it.
Avoid a bulky detached band that makes the opening feel like a secondary banner.
Keep required notices compact and distinct from the site's navigation.

Align the identity, navigation, hero copy and following sections to shared inner
rails while letting the media run full width. Use the supplied logo with its
clear space and proportions. If none exists, use a readable text identity rather
than fabricating an official-looking mark. Pick left-aligned or centered identity
from the composition and available width; do not squeeze navigation around it.

Keep a short set of useful links and one clear primary action. Design default,
hover, focus, active and scrolled-header contrast intentionally. If the header
sticks, reserve its space and offset anchor targets so it does not hide headings.
Test navigation over the lightest and darkest media frames, not just the poster.

At narrow widths, keep essential links reachable through a compact layout or an
accessible menu; hiding desktop navigation without a replacement is insufficient.
A menu button needs an accessible name, expanded state and clear open/close
behavior. Support Escape, sensible focus return and scroll behavior appropriate
to whether the menu is an inline disclosure or modal drawer.

## Typography choices and hierarchy

Choose display, body and utility roles before selecting fonts. Usually one or
two families suffice. A display face carries personality; body text, navigation,
practical details and controls need durable readability. Use supplied fonts when
usable, otherwise choose a compatible family with the required characters,
weights and licensing. Do not assume a CSS family name means its font loaded.

Two example directions drawn from archived local-business sites:

| Direction | Display role | Body/UI role | Useful visual relationship |
| --- | --- | --- | --- |
| Bold, sign-inspired | Bebas Neue or a suitable condensed display sans | Manrope or a legible sans fallback | Tall compact headlines against clear, relaxed supporting copy |
| Warm editorial | Georgia or a suitable editorial serif, with selective italic emphasis | A neutral sans; Inter only when actually provided, otherwise system sans | Soft expressive headings against precise navigation and practical details |

These pairs are options, not assignments to every restaurant or salon. Avoid
using a condensed or decorative display face for long paragraphs. Use uppercase
and tracking sparingly for short navigation, eyebrow labels or section numbers;
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

Optional starting palettes observed in the reference archives:

- Sign-inspired: ink `#12110f`, warm paper `#eee2cd`, signal orange `#eb5a34`,
  with brass `#c7a263` as a limited supporting accent.
- Warm editorial: paper `#f3ece4`, ivory `#fff9f3`, ink `#201816`, rose `#a85268`
  and wine `#522835`, with sage `#68705d` as an optional quiet supporting tone.

Derive replacements from the actual brand and images. Reserve the strongest
accent for useful emphasis; do not give every label, border and button equal
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

A small eyebrow, fine rule or section number can introduce a large heading and
supporting paragraph. Use it only if it helps orientation. A desktop heading/body
split can collapse into a clear single-column reading order. Plan light/dark
surface transitions, whitespace and image edges as part of the rhythm; do not
insert decorative separators or empty scroll distance to manufacture drama.

## Buttons, links, icons and component states

Give the primary action a filled, high-contrast treatment. Secondary actions can
use a quiet filled surface or a clearly legible text link according to their
importance. Define padding, minimum usable target size, radius, label weight,
icon size and gaps consistently. Match crisp or softened corners to the visual
language instead of making every control a pill.

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
content, and reasons for important departures. A good screenshot at one width
is not sufficient evidence of a usable design system.
