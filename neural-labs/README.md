# Neural Labs

Standalone browser-based desktop environment for Neural Labs.

## What Is Included

- Desktop workspace UI with draggable windows
- File explorer backed by per-user Docker workspaces
- Text editor backed by per-user Docker workspaces
- Terminal sessions executed inside per-user Docker containers
- `Neura` chat with per-user conversation history
- Invite-only authentication with persistent account-backed workspaces
- Desktop Settings with local LLM/provider management
- No upstream product naming inside the `neural-labs/` codebase

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Root `.env`

The app treats the repository-root `./.env` as the canonical environment file.

Examples:

```bash
PORT=3000
VITE_PUBLIC_APP_NAME=Neural Labs
NEURAL_LABS_THEME=dark
NEURAL_LABS_BACKGROUND_ID=sunrise-grid
OPENAI_DEFAULT_API_KEY=your_openai_api_key_here
OPENAI_DEFAULT_MODEL=gpt-5-mini
OPENAI_DEFAULT_NAME=OpenAI
OPENAI_DEFAULT_BASE_URL=https://api.openai.com/v1
AUTH_SECRET=change-me-before-production
AUTH_BASE_URL=http://localhost:3000
AUTH_DB_PATH=/app/data/auth/auth.db
AUTH_COOKIE_SECURE=false
NEURAL_LABS_INITIAL_ADMIN_EMAIL=admin@example.com
NEURAL_LABS_INITIAL_ADMIN_PASSWORD=change-me-admin-password
ANTHROPIC_DEFAULT_API_KEY=your_anthropic_api_key_here
ANTHROPIC_DEFAULT_MODEL=claude-sonnet-4-20250514
ANTHROPIC_DEFAULT_NAME=Anthropic
ANTHROPIC_DEFAULT_BASE_URL=https://api.anthropic.com/v1
NEURAL_LABS_DEFAULT_PROVIDER=openai
```

Notes:

- `VITE_*` and `NEXT_PUBLIC_*` variables are exposed to client-side code.
- Server-only values such as provider API keys remain available through `process.env`.
- `PORT` controls the app port for both local `npm run dev/start` and Docker Compose.
- `AUTH_SECRET` should be set to a stable random string before exposing the app.
- `AUTH_BASE_URL` is optional; set it when you want admin-generated invite links to use an absolute external URL.
- `AUTH_DB_PATH` points at the SQLite auth database file.
- `AUTH_COOKIE_SECURE` must stay `false` for plain HTTP local/Wsl access; set it to `true` only behind HTTPS.
- `NEURAL_LABS_INITIAL_ADMIN_EMAIL` and `NEURAL_LABS_INITIAL_ADMIN_PASSWORD` are used once to seed the first admin account when the auth database is empty.
- OpenAI and Anthropic env values are reconciled into Neural Labs providers on startup.
- `NEURAL_LABS_DEFAULT_PROVIDER` accepts `openai` or `anthropic`; if unset and both exist, OpenAI wins.
- The legacy `NEURAL_LABS_PROVIDER_*` variables still work as a fallback single-provider seed when the new provider-specific vars are not set.
- Workspace/runtime tuning:
  - `NEURAL_LABS_WORKSPACE_BACKEND=docker|local` (default: `docker`)
  - `NEURAL_LABS_WORKSPACE_IMAGE` (default: `ubuntu:24.04`)
  - `NEURAL_LABS_WORKSPACE_SHELL` (default: `bash`)
  - `NEURAL_LABS_CONTAINER_PREFIX` (default: `neural-labs-user`)
  - `NEURAL_LABS_VOLUME_PREFIX` (default: `neural-labs-user`)
  - `NEURAL_LABS_WORKSPACE_PATH` (default: `/workspace`)
  - `NEURAL_LABS_DATA_DIR` only applies when backend is `local`

## Docker Compose From Repo Root

Start the app from the repository root:

```bash
docker compose up --build
```

Open `http://localhost:3000`.
If you set `PORT` in `.env`, Compose binds and serves on that port instead.

Compose uses the repository-root `./.env` file and mounts `/var/run/docker.sock` so the app can preprovision per-user Docker containers and persistent Docker volumes.
It also mounts a dedicated `auth-data` Docker volume for the SQLite auth database, so users, sessions, and invites survive container restarts.

Stop the stack with:

```bash
docker compose down
```

## Docker Build From Repo Root

Build from the repository root:

```bash
docker build -t neural-labs .
```

Run:

```bash
docker run --rm -p ${PORT:-3000}:${PORT:-3000} --env-file .env -v /var/run/docker.sock:/var/run/docker.sock neural-labs
```

## Runtime Data

With `NEURAL_LABS_WORKSPACE_BACKEND=docker` (default), each user gets:
- a dedicated Docker container
- a dedicated persistent Docker volume mounted at `/workspace`

All workspace files plus Neural Labs state (`.neural-labs/state.json`) are stored in that user volume.
Authentication state is stored separately in the SQLite database at `AUTH_DB_PATH`, which should live on the mounted `auth-data` volume in Docker.

## Auth Flow

1. Set `NEURAL_LABS_INITIAL_ADMIN_EMAIL` and `NEURAL_LABS_INITIAL_ADMIN_PASSWORD` in the root `.env`.
2. Start the app. On first boot with an empty auth DB, Neural Labs creates that admin account automatically.
3. Sign in at `/login` with those credentials.
4. Open `/admin` to create invite links for other users.
5. Invited users accept their link, set a password, and are then mapped to the same persistent workspace on future logins.

## Verification

```bash
npm run typecheck
npm run build
```
