# Combined Experience

Compose only modules the user requests. If order is absent and cannot be inferred from an existing design, ask for it; otherwise preserve the requested or existing order.

## Composition

- Reuse verified modules and build only missing pieces.
- Keep each module's progress local. A small coordinator may track the active section, but it must not duplicate each component's media logic.
- Resolve ownership where wheel, touch, keyboard, and pointer handlers overlap. At most one active module may consume a gesture.
- Preserve native forward and reverse document navigation. Reverse navigation means the user can return to prior sections; it does not automatically mean reversing ordinary video playback.
- Make handoffs explicit with ordinary layout flow, opacity/transform transitions, or a pinned stage. Avoid fixed layers that remain above later content after their range ends.
- Do not add an optional finale, global scroll lock, or page replacement unless requested or clearly present in the existing design.

## Acceptance checks

- Verify every module independently before judging the sequence.
- Traverse the whole sequence forward and backward at desktop and mobile widths.
- Confirm there is no handler conflict, document jump, trapped scroll, stale fixed layer, duplicate playback, or console error.
