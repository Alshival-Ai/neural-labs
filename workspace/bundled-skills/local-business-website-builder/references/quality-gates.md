# Quality Gates

Use the gates relevant to the requested deliverable. A private prospect concept can defer production integrations, but it must not pretend that they work. A production build must not pass while launch-critical facts or paths remain unverified.

## Content and conversion

- Business identity and contact details match the approved source.
- The primary action is obvious, consistent, correctly linked, and usable on mobile.
- Claims, services, prices, hours, service areas, reviews, and credentials are supported.
- Missing content is reported; no scaffold text, invented testimonial, dead link, or accidental placeholder remains.
- Keep research uncertainty, asset-selection rationale, and design observations in the handoff/evidence files. Public copy should help customers act: for unknown hours use "Call for current hours"; for an external portfolio use "Explore recent work on Facebook." Retain necessary concept disclosures and asset attribution without narrating the build process.
- Representative stock or generated media is not described as the business's actual location, staff, work, food, products, or customers.
- Asset source, license, creator, and attribution obligations are recorded and satisfied.
- Forms and third-party actions have tested success and failure behavior, or are clearly presented as non-operational demos.

## Responsive and accessible behavior

- Test representative narrow mobile, wide mobile, tablet, laptop, and large desktop widths, including a wide, short viewport for pinned scenes. The complete pinned composition must fit the visible height; resize it or fall back to normal flow when it cannot. Check the final reveal before release using the measured stage height.
- Check keyboard order, visible focus, landmarks, headings, labels, alternative text, contrast, zoom, and reduced motion.
- Confirm navigation, dialogs, menus, galleries, sticky actions, and effects do not trap input or cover essential content.
- Check long business names, long service labels, missing optional sections, and large text settings.
- Compare rendered typography with the design brief. A font-family declaration does not prove the font loaded: verify the font resource and rendered face, or deliberately document and review the chosen system-font alternative.

## Performance and resilience

- Reserve media space and avoid avoidable layout shifts.
- Serve appropriately sized images and intentional responsive crops.
- Keep critical text available without waiting for animation, video, or client-side JavaScript.
- Test the page with scripts disabled, including document height and section transitions. Ordinary CSS must provide readable, normal-height content; add extra scroll distance, sticky pinning, and hidden states only after successful enhancement. A fallback selector for a class that is never set is not a working fallback.
- Avoid unnecessary libraries, duplicate listeners, oversized video, autoplay surprises, and render-blocking assets.
- Exercise missing media, slow loading, integration errors, refresh at deep scroll positions, and navigation back/forward behavior.

For a scroll-controlled image frame sequence:

- Record the frame count, dimensions, filename pattern, first and final states, total compressed bytes, and desktop-versus-mobile variants in the asset manifest.
- Keep a static poster under the renderer until the first successful paint and as the error fallback. A missing or late frame must retain the previous pixels rather than expose the section background.
- Verify rapid forward and reverse gestures, exact first and final frames, a visible final-state hold when required, resize and orientation changes, deep-scroll refresh, and an intentionally missing frame.
- Measure mobile payload and decoded-memory behavior. Do not make every phone download a desktop sequence without an explicit, tested performance decision.
- Check that oversized phase labels are mutually exclusive on narrow screens and do not overlap primary hero copy or essential actions.

## Search and trust

- Inspect titles, descriptions, canonical behavior, social previews, robots behavior, sitemap behavior, and structured data when in scope.
- Confirm visible identity and JSON-LD agree.
- Check phone, email, directions, booking, social, policy, and footer links.
- Ensure prospect concepts cannot be confused with an official published business site.

## Engineering checks

- Inspect the browser console and failed network requests.
- Confirm the local preview uses the reported URL and that any port fallback is explicit.
- Run lint, typecheck, automated tests, and a production build in proportion to the change.
- Confirm the signature cinematic effect matches the user's explicit request or the recorded questionnaire selection. Fail the gate if an unapproved familiar effect was substituted or if no selection was recorded when the questionnaire was required.
- Test every cinematic module independently and within the page sequence using `$cinematic-interactions` acceptance checks.
- Report observable results and remaining launch blockers; do not describe an unchecked item as passed.
