> Current workflow: use local-business-website-builder as the presentation owner.
> Read its business-photo-direction, asset-policy and quality-contract references.
> The active policy supersedes older stock defaults in this process supplement.

# Visual and interaction review

Use the Neural Labs browser/image tools available in the current session and the
pipeline's `qa-site.mjs`. Never mark screenshots inspected merely because files
were produced. The common helper checks mechanics, factual presence, responsive
overflow and publisher CSP; manual visual and selected-effect checks are separate.

## Composition pass

Inspect desktop, tablet, narrow and wide mobile, plus a full-page capture.
Evaluate the first screen at natural size: recognizable identity, clear reading
order, useful local context, a reachable primary action and a deliberate image
crop. Review the entire page for repeated card sections, empty scroll stretches,
inconsistent rails, weak contrast, awkward line breaks, undersized imagery or
decorative labels competing with content. Inspect at 200% zoom/reflow.

Compare against DESIGN.md and the actual business: does the image teach something
specific, does the type treatment suit the customer, and does each section answer
a different question? Record observed shortcomings and correct them, then recapture
the affected widths/states. More sections and animations do not compensate for a
weak opening or generic content. Stop iterating when the checks pass and no
specific defect remains; do not spend the run endlessly polishing arbitrary details.

## Interaction pass

- Test all navigation and conversion links against their verified destinations;
  check menu/dialog opening, close button, Escape, focus return and keyboard order.
  Do not place real bookings or submit inquiries to test a concept.
- For each scroll effect, capture entry, intermediate and final states. Scroll
  slowly, stop, reverse and move rapidly. Confirm the intended progression,
  settled final state, sticky release and complete adjacent sections.
- Refresh at a mid-scene position and resize across its breakpoint. Text and
  image transforms must remain centered and readable, without duplicated or
  overlapping layers. Inspect the crops in the animated states too.
- Exercise reduced motion, touch/coarse pointer, no JavaScript and missing media.
  A deliberately static mobile gallery is valid if labeled as such in the report
  and all content/actions remain available with normal document height.
- For pointer/reveal controls test hover, keyboard and touch separately. For a
  selected scroll video use `--require-scroll-video` in local and public QA and
  satisfy the helper's frame/seek tests. A still-image GSAP scene should not be
  mislabeled as a scroll video to satisfy a quota.
- Inspect console errors and failed requests, local font loading, image dimensions,
  payload size and horizontal overflow. Run the project's production build/lint
  when relevant. Recheck the deployed page under its real CSP.

## Evidence in VALIDATION.md

Record viewport/mode, action, observed result, screenshot or report path and any
fix made. Separate automated checks, human/model image inspection and checks not
performed. Missing evidence is an incomplete check. Keep business facts, media
rights, concept disclosure and integrations honest even when the visual result
is strong. Do not hand-author BUILD-RESULT.json; use complete-build after QA.
