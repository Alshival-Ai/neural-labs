# Editor app design handoff

`EditorApp.tsx` is the responsive desktop surface for editing shared workspace
text files. `App.tsx` now owns its open documents and connects file reads and
saves to the confined workspace API. Source-control, runtime, commands, and
Neura actions remain visual placeholders.

## Integration seam

1. Files sends a relative workspace path to the desktop shell.
2. The shell reads it through `filesApi.ts`, maps it to `EditorDocument`, and
   selects it in the Editor window.
3. `onSave` persists content with the document revision and marks the local
   buffer saved only after the request succeeds.
4. Replace `CodeCanvas` with Monaco or CodeMirror if production language
   services, diagnostics, large-file virtualization, or extensions are required.
   Its surrounding toolbar, tabs, context panels, and status bar are deliberately
   editor-engine agnostic.

The component owns its scoped stylesheet through `import "./editor-app.css"`. It does not require a new package.

## Intended behavior

- File tree and tabs switch documents; closing a tab preserves the placeholder document in the tree.
- The source surface is editable, tracks dirty state, supports local save/reload, and exposes save/run callbacks.
- Markdown documents can switch between source and rendered preview.
- Outline entries focus their source position; Neura actions are visual placeholders.
- The context pane drops away on medium windows, the explorer collapses to an activity rail, and the full sidebar becomes a drawer on mobile.
