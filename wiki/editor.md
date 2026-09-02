# Editor desktop app

Editor is the shared UTF-8 text editor inside the Neural Labs desktop. Open it
from the dock, double-click a file in Files, choose **Open** in file details, or
use **Open in Editor** from a file's context menu. **New file** in Files creates
an empty file in the current folder and opens it immediately.

The current V1 editor keeps the design handoff's responsive explorer, tabs,
syntax coloring, outline, Markdown preview, resizeable desktop window, and
Neura context placeholder. It supports common development-file language labels
and falls back to plain text for unknown extensions. Save with the toolbar or
`Ctrl+S`/`Cmd+S`.

## Persistence and conflicts

Editor reads and writes through `/workspace/api/files/text`, behind the same
control-plane authentication and root-confined workspace boundary as Files.
Creates are exclusive and saves replace the destination atomically. Each open
response includes a content-derived revision. A save must present that revision;
if another developer or automation changed the file first, the server returns a
conflict instead of silently overwriting newer work. The document remains dirty
so the developer can preserve their changes.

The V1 editor accepts valid UTF-8 text without null bytes up to 16 MiB. It does
not execute code. The Run, source-control, command-palette, and Neura actions are
visible integration placeholders. Uploaded binary files remain available for
download through Files.

All approved users share this filesystem and can edit the same files. Separate
workspace containers or virtual machines are required when users are not
mutually trusted.
