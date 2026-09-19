# Learn the place before designing it

Use the exact name/address to match the Google Maps listing and official links.
Inspect actual images, not only metadata or descriptions. View the accessible
gallery broadly: exterior/signage, interiors, materials, atmosphere, products or
work, menus/service boards, distinctive facilities and contrasting recent views.
Inspect every accessible unique relevant photo when the gallery is manageable.
For a large gallery, cover all available categories and date ranges, continuing
until additional photos add no new design-relevant evidence; record that sampling
and its stopping reason. Never claim that a Places API response is the entire
Maps gallery. Place Details supplies at most ten photo resources; use available
browser gallery navigation for broader coverage. Do not bulk scrape, bypass an
access barrier or invent unseen photos. Record blocked access and continue with
official sources. Remove the old arbitrary five-photo ceiling.

Write BUSINESS-VISUAL-BRIEF.json (schema in quality-contract.md). Keep source URLs,
photo/category identifiers, inspection dates, what is directly visible, confidence,
and limitations. Mark a library corner visible in photos as observed; 'regular
book club' remains unverified until a source supports it. Old service-board prices
do not establish current prices. Do not infer customer demographics from faces.

Translate the strongest observations into a design decision ledger:
`observation -> customer relevance -> original design feature -> implementation
target -> screenshot/review evidence`. Include layout, content grouping or a
useful interaction, rather than only an accent color. Consider two genuinely
different art directions and choose the one best supported by the place and its
customer action. Record the rejected direction briefly in DESIGN.md.

Examples (conditional, not templates): a coffee shop with a verified reading area
could use a readable book-like menu and chapter navigation, with a normal mobile
list; a salon with visible color swatches could organize a style collection like
a swatch folio; a bakery's patterned packaging could inspire section borders and
product framing. Every metaphor must make actual information easier to browse.
Do not invent offerings to support an attractive design idea.

Before release, compare page/screenshots with the ledger. Is the distinctive
feature implemented and useful? Does the real visual character survive beyond
the palette? Fix generic sections, weak crops, disconnected imagery and decorative
effects that cannot explain a business-specific decision. Record changes.

Inspecting photos for inspiration does not grant republication rights. For actual
image use follow business-research-and-media's source/attribution checks. Seek
usable originals for authentic imagery. Do not embed expiring photo URLs, keys,
or scraped review photos into the static site. Reference observations in original
art direction without pretending generated scenes show the actual interior.

Source: https://developers.google.com/maps/documentation/places/web-service/place-photos
