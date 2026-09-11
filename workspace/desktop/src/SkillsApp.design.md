# Skills desktop app design handoff

The Skills app uses three plain-language libraries instead of exposing the
OpenClaw proposal lifecycle:

1. **My Skills** — personal, direct-save skills in the current user's Neura
   picker.
2. **Team Skills** — shared workspace skills available to everyone.
3. **OpenClaw** — installed platform skills plus ClawHub search.

The primary action is **New skill**. The editor asks only for a name, a short
description, instructions, and who should get the skill. It defaults to “Just
me,” saves immediately, and explains that secrets do not belong in skills.

The detail view prioritizes four questions: what does this do, who can use it,
is it ready, and what instructions will Neura follow. Owners can edit or move a
skill between personal and team scope. Enablement controls, source precedence,
revision hashes, proposal scans, quarantine, evaluation, and rollback are not
part of this everyday surface.

ClawHub results keep publisher and scan warnings visible. Installation stays
administrator-only and always targets Team Skills because the pinned OpenClaw
Gateway has no user-scoped install target.

Responsive behavior keeps the three-section navigation at every width. On
mobile, custom skill lists transition to the detail pane; OpenClaw search uses
the existing compact card layout.

The **+ Skill** and **+ Automation** draft builders share the desktop paper,
ink, surface, and accent tokens, spectrum edge and icon treatment, and dark
primary actions. Form, preview, and test panels fill the available canvas with
consistent gutters. Only skill drafts reserve a package sidebar; automation
drafts use a single full-width column at every window size. Narrow skill
windows collapse the package sidebar and stack form fields.
