# Files app design handoff

`FilesApp.tsx` is the responsive shared workspace file browser. It is opened
from the desktop dock and uses the authenticated workspace file API.

## Integration seam

The frontend API client is `filesApi.ts`. The server implementation is split
between `workspace/http-server.mjs` and the root-confined
`workspace/file-manager.mjs`.

The component owns its scoped stylesheet via `import "./files-app.css"`.
Preview rendering is delegated through `onPreviewFile` to the lazy-loaded
`PreviewApp` desktop window.

## Intended behavior

- Single click selects; double click opens.
- HTML, common images, PDF, CSV/XLSX, audio, and video open in a dedicated read-only Preview window.
- UTF-8 text and code continue to open in Editor.
- Search, list/grid switching, responsive navigation, and placeholder filters work locally.
- The details pane is visible on wide windows, hidden at medium widths, and navigation becomes a drawer on mobile.
- Right click or Shift+F10 opens download/delete actions.
- Drag and drop plus the file picker support multi-file uploads.
- New-folder and empty text-file creation are functional; new text files open in Editor.
