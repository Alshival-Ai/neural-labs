# Files desktop app

Files is the shared filesystem browser for the persistent workspace at
`/home/node/workspace`. It runs inside the workspace container and is available
to every approved Neural Labs user from the desktop dock.

## V1 capabilities

- browse nested folders in list or grid view;
- search and sort the current folder;
- upload one or many files with the picker or drag and drop;
- create folders;
- create empty text files and open them directly in Editor;
- open existing UTF-8 text files in Editor by double-clicking, from the details
  pane, or from the context menu;
- open HTML, common image formats, PDF, CSV, XLSX, audio, and video in a
  dedicated, resizable desktop Preview window;
- copy a file or folder's shell-ready `~/workspace/...` path from its context
  menu;
- download files from the item context menu or details pane; and
- permanently delete files or folders after confirmation.

The app keeps an authenticated Server-Sent Events connection open at
`/workspace/api/files/events`. A recursive watcher in the workspace service
coalesces filesystem changes and broadcasts a small invalidation event to every
connected browser. This covers changes made by another developer as well as
files written by Neura, OpenClaw, Codex, or a future Terminal app. Each client
then re-reads only its current directory over the normal file API. The existing
list remains visible during that background reconciliation, so live updates do
not replace the app with a loading screen or disturb a still-valid selection.

SSE is intentionally one-way here. Upload, folder creation, and deletion remain
ordinary same-origin HTTP operations; the event stream only tells all clients
that shared state changed. EventSource reconnects automatically after a brief
network interruption, and the next successful directory read is authoritative.

Folder download/archive, favorites, and recoverable trash are deferred. V1
deletion is recursive for a folder and cannot be undone. Unsupported binary
files remain downloadable, and the Editor deliberately rejects them.

## File previews

Double-click a supported file or choose **Preview** in the details or context
menu. Image, PDF, audio, and video previews use an authenticated inline-content
route. Media responses support byte ranges so playback and seeking do not
require downloading an entire large file first. CSV and XLSX files render as a
scrollable, read-only grid with worksheet tabs. Browser workbook previews are
limited to 25 MB and display at most the first 500 rows and 100 columns per
sheet; the original file is always available through **Download**.

Spreadsheet parsing is lazy-loaded with the Preview window, keeping the normal
desktop and Files bundles small. Preview windows can be minimized, resized,
maximized, closed, and restored with the rest of the per-device desktop state.

## Website previews

Opening an `.html` file loads an authenticated URL below `/workspace/preview/`
inside the desktop Preview window. The containing folder becomes the preview
root, so relative CSS, JavaScript, image, font, and media paths stay inside that
folder. Root-level HTML is also supported, using the shared workspace as its
preview root. Put a site's entry point and assets in their own folder when it
should not resolve neighboring workspace files.

This route previews static project output. It does not proxy a Vite, Next.js,
or other development server, and it does not make a container loopback URL such
as `http://127.0.0.1:4173` public. Build framework projects to static output or
open their generated HTML entry point until an isolated development-server
proxy is added.

Neura should finish website work with a Markdown link to the authenticated
preview route and identify the entry point as `Page: folder/index.html`. For
older replies that contain a loopback link plus that entry-point line, the chat
renderer replaces the unusable loopback destination with the matching static
preview URL. This lets a user click Neura's original link and open the preview
directly while preserving external links unchanged.

Uploads stream directly into the workspace and are committed atomically so a
partial upload does not appear as the requested filename. The default limit is
2 GiB per file and can be reduced with
`NEURAL_LABS_WORKSPACE_MAX_UPLOAD_BYTES` in the single root `.env`. Nginx uses a
matching 2 GiB request limit and disables request buffering for workspace API
traffic.

## Security boundary

The API accepts only paths relative to `/home/node/workspace`. It rejects
absolute paths, `..` traversal, invalid names, the workspace root as a deletion
target, symbolic links, and non-file filesystem objects. Downloads use
`Content-Disposition: attachment` and `nosniff` rather than serving uploaded
HTML or scripts as application assets.

The separate website preview and inline-content routes are authenticated and
read-only. A website preview token identifies the containing workspace
directory; every requested asset is resolved beneath it with the same traversal
and symbolic-link checks as Files. Preview HTML receives a CSP sandbox that
permits page scripts and ordinary UI interaction but blocks network connections,
form submission, top-level navigation, plugins, and access to the Neural Labs
application origin. The inline route allowlists only supported passive media,
PDF, CSV, and XLSX types; uploaded SVG receives an additional no-script CSP.
Responses are not cached or indexed.

Nginx runs the same control-plane authentication subrequest used by the desktop
before proxying `/workspace/api/files*`, including the event stream. It replaces
the forwarded user header; the workspace server also requires that identity
header. Event payloads contain only paths relative to the already shared
workspace, never host paths or file contents. Every mutation must have the exact
configured same-origin `Origin` header. The API does not grant access to the
host filesystem or another container.

This is a mutually trusted shared workspace: all approved users can see,
upload, download, and delete the same files. Use separate workspace containers
or virtual machines when users require isolation.
