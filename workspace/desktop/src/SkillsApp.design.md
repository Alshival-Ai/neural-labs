# Skills & Automations design handoff

The app has five destinations: My Skills, Team Skills, Drafts, Automations,
and OpenClaw. My Skills contains personal workflows; Team Skills contains
shared workflows; OpenClaw combines installed skills with ClawHub discovery.

## Browsing

The toolbar names the combined app. Its primary action is **New skill**, or
**New automation** in Automations when the current user can create one. The
embedded automation view retains scheduler status and refresh without repeating
its title or primary creation action.

Skill and automation lists have a draggable right edge. Arrow keys adjust by
10px (40px with Shift), Home/End select the bounds, and double-click resets the
width. Defaults are 288px and 296px, with a 200–520px range that reserves 320px
for details. Width preferences are stored separately per user on this device.
Shrinking the window temporarily clamps the width without replacing the saved
preference. Storage failure does not prevent resizing.

List titles and navigation labels have full-title tooltips on hover and keyboard
focus. Tooltips escape scrolling-pane clipping, can be hovered, and dismiss on
Escape. Narrow windows use a horizontally scrollable destination bar and
list-to-detail navigation; resizing disappears at the existing compact
breakpoints (650px for skills, 720px for automations).

## Sectioned editors

New and Edit use the same collaborative builder. The header keeps navigation,
connection/autosave status, collaboration, validation, and explicit publishing
available while the form scrolls. Existing workflows say **Publish changes**.
The views are Edit, Preview, and Test, with Source available for skills.

Skills use **Basics**, **Instructions**, and **Availability**, followed by
collapsed **Appearance** and **Advanced** sections. Instructions edit the body
of the shared `SKILL.md` without replacing its frontmatter. Appearance contains
picker metadata and icons; Advanced contains MCP dependencies. The file browser
appears only in Source, stacking above the source editor in narrow windows.
Personal scope remains the default; published shortcuts remain immutable.

Automations use **Basics**, **What to run**, **When to run**, and **Delivery**,
followed by collapsed **Advanced** execution and timing controls. Controls follow
the selected action, schedule, and delivery mode. Hidden values remain in the
draft, including when switching views. Validation links open and focus the
relevant field or source file. Publishing checks validation and uses the existing
publish/finalize flow and permissions.

## Spectrum theme

Use Neural Labs' spectrum, not a single accent: cyan for basics, violet for
instructions/action, mint for availability/delivery, amber for timing, and pink
for appearance. Advanced sections use amber (skills) or pink (automations).
Section borders, softly tinted icon tiles, and backgrounds establish hierarchy.
The top edge and primary publishing button carry the full spectrum gradient.
Paper and ink surfaces keep the forms legible; errors and connection states use
text as well as color, and controls retain visible keyboard focus.

ClawHub publisher and scan warnings remain visible. Installation remains
administrator-only and targets Team Skills. Collaboration, test approvals,
shared skill mount permissions, and scheduler trust boundaries are unchanged.

## Verification

`BuilderWorkspace.test.tsx` covers instruction/source synchronization,
conditional-field retention, validation navigation, and publishing permissions.
`LibraryInteractions.test.tsx` covers tooltips, pointer and keyboard resizing,
clamping, persistence, cancellation, and unavailable storage. The synthetic
`tests/skills-builders.html` fixture supports browser checks without connecting
to a tenant or writing to a scheduler.
