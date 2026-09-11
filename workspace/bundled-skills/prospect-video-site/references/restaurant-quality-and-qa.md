# Restaurant Quality and QA

Apply this matrix before every release-ready build and after a material
client-preparation revision. The base workflow's required QA wrapper is the
minimum automated check, not the entire review.

## Engineering

- Validate JSON and structured artifacts.
- Run syntax, lint, type, and build checks appropriate to the implementation.
- Inspect the actual diff or changed file set; unrelated work remains untouched.
- Require zero unexpected browser console errors, runtime exceptions, failed
  local requests, broken internal anchors, or missing accessible control names.
- Confirm every local asset path and expected MIME type; record local video
  paths for the release skill's later range-delivery verification.
- Keep research files, source photos, credentials, and private client material
  outside `site/`.
- Record the accepted local digest for release verification.

## Restaurant facts and actions

| Check | Required result |
| --- | --- |
| Identity | Name and location match the resolved restaurant |
| Phone | Visible display value and `tel:` target match the source |
| Directions | Destination resolves to the verified listing/address |
| Hours | Current source recorded; grouped display preserves real differences; change caveat visible |
| Menu | Source/date/provenance recorded; all transcribed facts legible; ambiguity omitted |
| Reservation | Link appears only when verified and reaches the intended restaurant/provider |
| Ordering | Link appears only when verified and reaches the intended restaurant/provider |
| Social | Every shown profile is the official matched restaurant profile |
| Missing data | Section/action is omitted or redesigned; no filler facts |

Do not click through an action in a way that places an order, makes a call,
submits a form, starts a reservation, or contacts the restaurant. Verify targets
read-only.

## Visual and restaurant UX

- The design still belongs to this restaurant after considering more than its
  name and colors.
- Each chosen scroll-video effect has a purpose and integrates intentionally
  with the freely chosen layout; the page contains no more than two.
- Typography, crop, spacing, contrast, and effect timing remain composed at the
  target desktop and mobile sizes.
- Menu categories, item names, descriptions, prices, ranges, modifiers, and
  caveats remain readable without zooming.
- Long menus do not become repetitive generic cards; grouping and hierarchy
  support scanning.
- Menu, Call, Directions, and any verified Reserve/Order action remain easy to
  reach without completing the cinematic sequence.
- Portrait and landscape layouts do not clip primary actions or menu prices.

Capture targeted screenshots of each changed functional region. For a menu,
capture at least its heading/navigation, one dense category, daily specials
when present, bulk/family sections when present, and the source/caveat area on
desktop and mobile.

## Motion and fallback

- Apply the base `smooth-scroll-rendering.md` acceptance gate and preserve its
  captured controller/media diagnostics with the run.
- Test slow forward, stopped, reverse, and rapid travel for each scroll-video effect.
- Confirm each effect settles on the newest target rather than completing stale
  intermediate seeks; verify the stopped and rapid-travel error bounds on the
  tested device.
- Confirm later media loads near the viewport rather than on the first critical
  path.
- Confirm sticky regions, when the design uses them, release cleanly without
  blocking menu or restaurant information.
- Verify `prefers-reduced-motion`, Save-Data, JavaScript-disabled, metadata
  failure, and source failure states remain complete and readable.
- Essential restaurant content and actions must not exist only in a video
  frame, canvas sequence, animation callback, or hidden enhanced state.

## Mobile and physical devices

Automated Chrome viewports must include at least the base 390×844 mobile and
1440×1000 desktop checks. Also inspect:

- mobile video crop and text safe areas;
- dynamic viewport height and orientation changes;
- category navigation and horizontally dense menu rows;
- tap targets of at least 44px where the base design requires controls;
- long labels such as “Order Online” and “Family meals”;
- phone/address wrapping; and
- absence of horizontal page overflow.

Physical iPhone Safari is mandatory before a Gate 8 or production-readiness
approval. Representative Android Chrome remains required when the production
scope calls for it. Automated emulation may support an independent demo but
must be reported honestly as not physical-device evidence.

## Accessibility

- One useful `h1` and a logical semantic heading sequence.
- Keyboard navigation, skip link, visible focus, and no trapped scrolling.
- Sufficient text/control contrast in both moving and still frames.
- Decorative video marked appropriately; meaningful images have useful alt
  text and source/rights strategy.
- Reduced-motion presentation is deliberate, not merely animation disabled.
- Menu data is semantic text rather than an inaccessible source image.
- Status, source, and freshness caveats are readable and not encoded only by
  color.

## Performance

- Each video and combined video stay within the base skill budgets.
- Initial transfer excludes later-act media until needed.
- Posters, responsive crops, and image derivatives have measured value.
- No raw camera/client masters appear in production markup.
- No unexpected external runtime dependencies, trackers, service workers, or
  hidden network calls.
- Layout shift from media, fonts, navigation, and menu expansion remains
  controlled.

## Legal, media, and disclosure

- Every downloaded external asset is recorded with page/file URLs, creator when
  known, retrieval time, local path, rights status, intended use, modifications,
  and distribution status.
- Client-owned and client-approved are distinct statuses.
- Stock and AI media are not presented as authentic restaurant premises,
  people, dishes, or processes.
- Required creator/provider credits remain visible.
- The independent Alshival.Ai preview disclosure is prominent and truthful.
- HTML and HTTP carry `noindex,nofollow,noarchive` for the demo.

## Release handoff requirements

The separate release skill must verify after the bounded wrapper publishes:

- fetch the final HTTPS URL and require `200`;
- verify expected identity, menu date/source caveat, disclosure, and Alshival.Ai
  link in the body;
- verify `X-Robots-Tag: noindex, nofollow, noarchive`;
- fetch primary CSS and JavaScript with expected content types;
- fetch important posters/media and test a video byte range;
- compare final HTML to the accepted local file; and
- record domain, immutable release, file count, byte count, verification time,
  known limitations, and pending approval gates.

The build overlay must record these requirements but must not perform
deployment itself. If any local prerequisite fails, do not describe the site as
release-ready. If an external check fails later, the release skill must not
describe the site as verified or live.
