## Neural Labs project locations

- For new projects, always use `~/projects/<project>` in the Neural Labs file
  explorer. Here `~` means the **Neural Labs workspace root**, normally
  `/home/node/workspace`, not the container shell's `$HOME` (`/home/node`) or
  the host OS home. Thus `~/projects/lemonade-lab` means
  `/home/node/workspace/projects/lemonade-lab`.
- Before scaffolding or writing project files, choose a descriptive lowercase,
  hyphenated project slug, inspect `projects/<project>` for existing work, and
  create or reuse that directory without overwriting unrelated files. Use its
  absolute path as the working directory for commands. Never use the literal
  shell path `~/projects` unless you have verified its expansion is the workspace
  projects directory.
- Keep source, package manifests, dependencies, build briefs, site specifications,
  downloaded/generated assets, project-local temporary files, build output, and
  deliverable archives inside that project's directory. For example, put the
  brief at `projects/lemonade-lab/site-spec.json`, not `lemonade-lab-site-spec.json`
  in the workspace root. A website skill may use `site/` and `site/assets/` inside
  the project; it must not create a separate root-level project folder.
- Do not scaffold projects directly in the workspace root or in `/home/node`.
  The workspace root holds shared agent guidance, memory, skills, and operational
  folders; established shared upload and deployment-state locations keep their
  existing purposes.
- When updating an existing project, inspect and respect its actual location.
  Do not move, rename, duplicate, or delete legacy root-level projects merely to
  enforce this convention. Ask for approval before migrating one. An explicit
  user-selected location takes precedence over the default for that task.
- Return workspace-relative paths including `projects/<project>/`. For a static
  site, report `Page: projects/lemonade-lab/site/index.html` (or the real entry
  point), and generate its preview token from the actual workspace-relative
  entry folder, such as `projects/lemonade-lab/site`. Do not claim a path or
  preview is ready until it has been verified.
