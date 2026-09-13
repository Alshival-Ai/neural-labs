# Your first workspace session

Use this guide when your Neural Labs instance is already running. To host your
own instance, start with [Quick setup](README.md).

## Sign in and connect Neura

1. Open your instance's `/signup` page and create an account, or use `/login`
   for Microsoft sign-in if your administrator enabled it.
2. Wait for administrator approval. A pending account cannot enter the desktop.
3. Open `/workspace`. The dock launches Neura, Files, Terminal, VS Code, Skills,
   and Settings. A new browser profile starts with an empty desktop.
4. Open **Settings → Model Provider → OpenAI** and connect your own ChatGPT
   account using the displayed sign-in URL and one-time code.
5. Open **Neura**, create a private conversation, and send your first request.

The account connection and usable model must be confirmed before private
Neura can answer. See [AI accounts and models](ai-accounts.md) for connection
troubleshooting, pause/resume, background work, and dedicated Team accounts.

## Work on a project

Open **Files**, create a project folder, and upload files or create a new text
file. Text and code open in **VS Code**. **Terminal** starts shells in the same
workspace, and Neura can help with those files.

Files, VS Code, terminals, and agent tools share `/home/node/workspace`. Changes
saved there are immediately part of the shared project tree. Files refreshes
when another user or a tool changes a directory. Use **Open Preview** for a
static website or supported media, and **Edit image** for raster images.

See [Files and previews](files.md), [VS Code](vscode.md), and
[Terminal](terminal.md) for detailed workflows. Files' shared Trash can recover
normal deletions for 90 days; it is not a backup.

## Reuse skills and run automations

Open **Skills** to browse My Skills and Team Skills or build a reusable workflow.
Use `$skill-name` in Neura to invoke an enabled skill. Drafts autosave; publishing
makes a skill available to the live catalog. **Test in Neura** lets you try a
snapshot before publication.

The Automations dock shortcut opens the Automations section of Skills. Members
can inspect operational status and run eligible AI tasks with their own
connected account. Administrators manage schedules and publish automations.
Scheduled work uses the job's configured agent and keeps running while browsers
are closed, as long as the workspace is running.

Read [Skills](skills.md) and [Automations](automations.md) for permissions,
subscriptions, and run behavior.

## Collaborate with teammates

Use **Team chats** inside Neura to create a channel for selected teammates or
Everyone. Mention `@Neura` for an agent request, or select a skill with `$`.
An ordinary user mention does not invoke the agent. The administrator's Team
account configuration determines which account runs Team requests.

Start a Team Terminal for a shared shell. A terminal opened from a restricted
Team Chat follows that channel's membership; a workspace-wide Team Terminal is
available to all approved users. Team terminals accept concurrent input, so
coordinate commands with other participants.

Private conversation lists and personal terminal tabs are separated in the app,
but all approved developers share one operating-system trust domain. Uploaded
Team Chat attachments may be in shared Files regardless of the channel's
membership. Read [Sharing and privacy](sharing-and-privacy.md) and
[Team Chats](team-chats.md) before sharing sensitive work.

## Personalize and return later

**Settings → Personalization** manages appearance, your profile, and notification
preferences. **Security** manages sign-in methods, passkeys, and phone
verification. Microsoft must be linked before you can enroll a
[passkey](passkeys.md).

Window positions and open apps are remembered per user and browser profile.
They do not roam to another device. Minimize keeps a live app mounted. Closing
Neura or a Terminal window does not stop its server-side run or shell; use its
explicit Stop or terminal end action when you want that work to end.
See [Desktop layout](desktop-state.md).

## What survives a restart?

Saved project files, published skills, draft state, editor settings, and AI
credentials live in persistent volumes. Team Chat and account records live in
PostgreSQL. They survive container recreation when the deployment retains its
volumes.

Running terminal processes end when the workspace container is recreated.
Packages installed interactively with `sudo apt` change only the current
container layer and disappear on replacement. Ask the operator to add durable
system tools to the workspace image.

For instance health, updates, and backups, see
[Manage your instance](manage-instance.md).
