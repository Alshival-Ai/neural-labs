# ADR 0017: Launch static-site previews inside the authenticated desktop

- Status: Accepted
- Date: 2026-09-03

## Context

The Files Preview app and Neura-generated site replies previously used a stable
`/workspace/preview/<encoded-folder>/<entry>` URL. Nginx and the workspace
server required an active Neural Labs identity, but the reusable URL looked like
a deployed site, could be copied out of the desktop, and disclosed its preview
folder token. Chat also opened that URL as a standalone browser tab instead of
using the desktop Preview window.

Static output in the shared workspace is an internal inspection artifact. A
public demo must be deployed explicitly to the configured demo host through its
reviewed skill; the workspace preview path must not become an implicit publish
mechanism.

## Decision

Open Neura-generated HTML entry points through the same desktop Preview window
used by Files. Translate relative HTML paths, legacy folder-encoded preview
links, and loopback links accompanied by a `Page: folder/index.html` marker into
desktop actions rather than external navigation.

Before loading an HTML iframe, require an authenticated, exact-origin POST to
mint a random 192-bit launch capability. Associate the capability with the
requesting user and one workspace directory, keep it only in workspace-process
memory, and expire it after 15 minutes without preview traffic. Treat the
unguessable path as a bearer capability on subsequent HTML, script, stylesheet,
image, font, and media reads. Reject the previous folder-encoded URL format.

Route only `/workspace/preview/<capability>/` around Nginx session
authentication, clear cookies, authorization, and identity assertion headers
before proxying, and suppress access logging for the capability path. This is
necessary because an iframe without `allow-same-origin` has an opaque origin;
SameSite session cookies are not reliable on its subresource requests. Keep the
launch endpoint and every other workspace route behind normal authentication.

Keep traversal, symbolic-link, and root-confinement checks on every asset.
Retain the iframe and response CSP sandbox, but remove popup and remote-asset
permissions. Continue to block connections, forms, top-level navigation,
plugins, and same-origin access to the parent desktop.

Because omitting `allow-same-origin` gives the preview document an opaque
origin, its CSP must not depend on `'self'` for project assets. Allow scripts,
styles, images, fonts, media, and workers only from the exact public-origin URL
prefix containing that preview's random launch capability. This keeps relative
project assets functional without granting access to unrelated workspace or
desktop resources. Preview windows may reload that same capability when files
inside the selected site root change.

## Consequences

- A workspace HTML file is previewed only after an intentional action inside an
  authenticated Neural Labs desktop session.
- A copied capability is short-lived but grants read-only access to its selected
  preview folder until it expires. CSP, no-referrer responses, cleared request
  credentials, and disabled access logging reduce accidental disclosure. It is
  not a public deployment URL.
- Preview capabilities disappear on workspace restart and are not backed up.
- Static demos that need public access must use the separate demo deployment
  skill and host.
- Remote CDNs, analytics, API calls, and popup-based flows do not work in the
  internal preview. Projects must include local static assets for faithful
  inspection.
