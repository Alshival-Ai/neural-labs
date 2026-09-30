---
name: deploy
description: Publish a workspace website or HTTP app and manage its persistent deployment, URL, logs, updates, and lifecycle. Use when the user asks to deploy, host, publish, or manage a generated app in Neural Labs.
---

# Deploy

Use the `deployments` tool. It owns process supervision and routing; do not run
background servers, edit routing manifests, acquire TLS certificates, or modify
host configuration yourself.

1. Read `hosting` and inspect the project's files. If public hosting is configured
   but unavailable, report its setup instructions. Never invent a public URL or
   silently fall back to local hosting.
2. Select only the intended project directory, relative to the workspace. Never
   publish the whole workspace, account homes, or private documents. Snapshotting
   excludes `.env*`, credential directories, `.git`, `node_modules`, and `.venv`.
3. For static HTML, deploy with `kind: static`; `output` names its public folder
   relative to the project. For a build, provide `build`, such as
   `npm ci && npm run build`, and `output: dist`. Never serve a project's source
   root if it also contains private files; choose its public output folder.
4. For a server app, use `kind: server` and a production `start` command. It must
   listen on `127.0.0.1:$PORT` and return HTTP success at `/`. Node and Python are
   installed. Install dependencies during `build`; a Python virtual environment
   should live inside the project release. App code is read-only while serving;
   store persistent data under `$DATA_DIR`. Provider credentials and workspace
   environment secrets are not inherited. Docker and managed databases are not
   available through this skill.
5. Call `deploy`. A requested name is used as the DNS label; otherwise the service
   allocates `website1`, `website2`, etc. To update, reuse the existing name.
   Publication is authorized by the user's deployment request; don't add a
   redundant confirmation. Merely building or previewing is not authorization.
6. Report the returned URL and status. Distinguish an app running locally from a
   verified public URL. If verification fails, inspect status/logs and report the
   remaining DNS, TLS, or access issue. For visual checks, the browser tool can
   open the returned `previewUrl` inside the workspace.

If a tool call times out, inspect `list`/`status` before retrying; the operation
may still be completing.

Apps outlive this chat and restart with Neural Labs. Use `list`, `status`, `logs`,
`start`, `restart`, `stop`, or `remove` as requested. Removal unpublishes the app
but preserves project files and app data. Local URLs refer to the installation's
machine; remote users need a tunnel or configured public hosting. Hosting
configuration and custom domains are operator settings, discovered by the tool,
not edits to this skill.
