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
- Common images, PDF, XLSX, audio, and video open in a dedicated read-only Preview window.
- Text and code, including HTML and CSV, open in VS Code by default; supported formats retain an explicit Preview action.
- Search, list/grid switching, responsive navigation, and placeholder filters work locally.
- The details pane is visible on wide windows, hidden at medium widths, and navigation becomes a drawer on mobile.
- Right click or Shift+F10 includes **Open in VS Code** for every file and folder alongside download/delete actions.
- Drag and drop plus the file picker support multi-file uploads.
- New-folder and empty text-file creation are functional; new text files open in VS Code.
