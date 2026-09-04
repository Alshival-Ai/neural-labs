# Files desktop app

Files is the shared filesystem browser for the persistent workspace at
`/home/node/workspace`. It runs inside the workspace container and is available
to every approved Neural Labs user from the desktop dock.

## V1 capabilities

- browse nested folders in list or grid view;
- search and sort the current folder;
- upload one or many files with the picker or drag and drop;
- create folders;
- create empty text files and open them directly in VS Code;
- open existing text and code files in VS Code by double-clicking, from the
  details pane, or from the context menu;
- open any file or folder in VS Code from its context menu;
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
files remain downloadable and may also be inspected with an appropriate VS
Code extension.

## File previews

Double-click a supported passive-media file or choose **Open Preview** in its
context menu. Text and code formats, including HTML and CSV, prefer VS Code;
their explicit Preview action remains available when supported. Image, PDF,
audio, and video previews use an authenticated inline-content
route. Media responses support byte ranges so playback and seeking do not
require downloading an entire large file first. CSV and XLSX files render as a
scrollable, read-only grid with worksheet tabs. Browser workbook previews are
limited to 25 MB and display at most the first 500 rows and 100 columns per
sheet; the original file is always available through **Download**.

Spreadsheet parsing is lazy-loaded with the Preview window, keeping the normal
desktop and Files bundles small. Preview windows can be minimized, resized,
maximized, closed, and restored with the rest of the per-device desktop state.

## Website previews

Choosing **Open Preview** for an `.html` file asks the workspace for a
short-lived launch capability
associated with the requesting user and loads its opaque `/workspace/preview/` URL inside the desktop
Preview window. The containing folder becomes the preview
root, so relative CSS, JavaScript, image, font, and media paths stay inside that
folder. Root-level HTML is also supported, using the shared workspace as its
preview root. Put a site's entry point and assets in their own folder when it
should not resolve neighboring workspace files.

The Preview toolbar can reload a website manually, and an open website preview
reloads automatically after files inside its site root change. The HTML remains
in an opaque-origin iframe; its asset policy permits only the exact short-lived
preview capability path, so local project styles and media load without giving
the page access to the parent desktop.

This route previews static project output without requiring a developer to
start or manage a separate process. Developers may also run Vite, Next.js, or
another development server on workspace loopback and use code-server's
authenticated `/workspace/vscode/proxy/<port>/` forwarding. Configure the
project's base path when its framework emits root-relative asset URLs. The Files
Preview intentionally serves a selected static project folder instead of
automatically attaching to an arbitrary process or port.

Neura should finish website work with the relative entry point, such as
`site/index.html`, or identify it as `Page: folder/index.html`. A matching link
in personal or Team Chat becomes an **Open in Preview** action that creates the
same desktop Preview window used by Files. Older loopback and legacy preview
links are translated into that desktop action; chat never navigates directly
to a reusable preview URL. External links remain unchanged.

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
read-only. A same-origin POST mints a random website-preview capability
associated with the requesting immutable user ID and containing workspace
directory. Because the sandboxed page has an opaque origin and cannot reliably
send the login cookie for subresources, the unguessable path itself authorizes
read-only preview requests. It expires after 15 minutes without preview traffic;
old folder-encoded routes are rejected. Nginx clears cookies and identity
headers and does not log capability paths. Every requested asset is resolved beneath its launch directory with the same traversal
and symbolic-link checks as Files. Preview HTML receives a CSP sandbox that
permits local page scripts and ordinary UI interaction but blocks remote asset
loading, network connections, form submission, popups, top-level navigation,
plugins, and access to the Neural Labs application origin. The inline route allowlists only supported passive media,
PDF, CSV, and XLSX types; uploaded SVG receives an additional no-script CSP.
Responses are not cached or indexed.

Nginx runs the same control-plane authentication subrequest used by the desktop
before proxying `/workspace/api/files*`, including the event stream. It replaces
the forwarded user header; the workspace server also requires that identity
header. Event payloads contain only paths relative to the already shared
workspace, never host paths or file contents. Every mutation must have the exact
configured same-origin `Origin` header. The API does not grant access to the
host filesystem or another container.

The `/workspace/api/vscode/open` handoff has the same authenticated,
same-origin mutation boundary. It resolves the requested existing item through
the Files path validator and rejects traversal and symbolic links. The validated
target is then opened by the requesting browser's embedded workbench, avoiding
cross-user dispatch through code-server's process-wide CLI session registry.

This is a mutually trusted shared workspace: all approved users can see,
upload, download, and delete the same files. Use separate workspace containers
or virtual machines when users require isolation.
