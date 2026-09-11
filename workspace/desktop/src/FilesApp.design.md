# Files app design handoff

`FilesApp.tsx` exports `ExplorerApp`, the responsive shared workspace file browser. It is opened
from the desktop dock and uses the authenticated workspace file API.

## Integration seam

The API clients are `filesApi.ts` and `explorerApi.ts`. The server implementation
is split between `workspace/http-server.mjs`, the root-confined
`workspace/file-manager.mjs`, and `workspace/explorer-manager.mjs` for personal
metadata, queued operations, search, recovery, and versioned binary saves.

The implementation lives in `ExplorerApp.tsx`, re-exported by `FilesApp.tsx`,
and owns its scoped stylesheet via `import "./explorer.css"`.
Preview rendering is delegated through `onPreviewFile` to the lazy-loaded
`PreviewApp` desktop window.

## Visual theme

- Match Skills, Automations, and Settings with the shared ink/paper palette,
  dark navigation, a spectrum top rule, violet selections, and ink primary
  buttons with a colored offset shadow.
- Inherit the desktop font family and font-size tokens, including menus and dialogs.
- Keep the paper theme consistent with the other Neural apps regardless of the
  operating system color preference. Native form controls use the light palette.
- Theme `explorer.css`, not the legacy `files-app.css`. Dialogs define their own
  theme tokens because `ExplorerDialog` is also used outside the Files window.
- Preserve the responsive layout and virtualized item heights (46px list / 152px
  grid); styling must not change the measurements used by the virtualizer.

## Intended behavior

- Single click selects; double click opens.
- Common images, PDF, XLSX, audio, and video open in a dedicated read-only Preview window.
- Text and code, including HTML and CSV, open in VS Code by default; supported formats retain an explicit Preview action.
- Search is filename-only, recursive by default, paginated/cancellable, and hidden-aware.
- One virtualized list/grid shows both files and folders. Sorting, filters, details, and column width are functional and persisted.
- The details pane is explicitly toggled; navigation becomes a drawer based on the app window viewport, not screen width.
- Right click or Shift+F10 includes **Open in VS Code** for every file and folder alongside download/delete actions.
- Drag and drop plus the file picker support multi-file uploads.
- New-folder and empty text-file creation are functional; new text files open in VS Code.
- Personal synced pins are shortcuts only; Trash and workspace contents are shared.
- Context menus and scoped shortcuts expose multi-select copy/cut/paste, rename,
  duplicate, move, archive, recoverable delete, and restore. No decorative commands.
- Image editing delegates to `ImageEditorApp` through `onEditImage`; the opaque
  miniPaint frame has no workspace API credentials. See `wiki/files.md` and ADR 0021.
