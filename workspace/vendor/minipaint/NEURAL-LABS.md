# Vendored miniPaint

Upstream: https://github.com/viliusle/miniPaint
Revision: a79733eb803fc97084ef0ee4faa96b031e69e1c0 (4.14.3)
License: MIT-LICENSE.txt. Preserve bundled dependency notices.

Neural Labs changes: workspace-bridge.js, its import in main.js, and requiring
Ctrl/Meta for Open and Save. Runtime uuid is pinned to 11.1.1 and the lockfile
includes compatible security updates. Build with npm ci --include=dev --ignore-scripts && npm run build.
Hermite-resize uses the same locked commit via the bundled
`hermite-resize-fae53290.tgz`, with SHA-512 integrity recorded in the lockfile.
Source: https://codeload.github.com/viliusle/Hermite-resize/tar.gz/fae53290d2b03520a6fc81d734c3028902a599c0
This supports clean builds with npm's Git and remote-URL restrictions enabled,
without requiring SSH or relaxing those policies. The archive retains its MIT
license and upstream source.
The editor is served in an opaque-origin sandbox; only its parent can access
the authenticated workspace. No external URL/media/font loading is enabled.
Popup controls use registered event listeners instead of inline handlers to
work under CSP. SVG path number separators were expanded to avoid a false
positive in the repository's public-IP publication scanner (no geometry change).
