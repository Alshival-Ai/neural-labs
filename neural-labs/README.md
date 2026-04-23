# Neural Labs

Standalone browser-based desktop environment for Neural Labs.

## What Is Included

- Desktop workspace UI with draggable windows
- File explorer backed by a local workspace directory
- Text editor backed by local file APIs
- Terminal sessions backed by local shell processes
- `Neura` chat with local conversation history
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
VITE_PUBLIC_APP_NAME=Neural Labs
NEURAL_LABS_THEME=dark
NEURAL_LABS_BACKGROUND_ID=aurora
OPENAI_DEFAULT_API_KEY=your_openai_api_key_here
OPENAI_DEFAULT_MODEL=gpt-5-mini
OPENAI_DEFAULT_NAME=OpenAI
OPENAI_DEFAULT_BASE_URL=https://api.openai.com/v1
ANTHROPIC_DEFAULT_API_KEY=your_anthropic_api_key_here
ANTHROPIC_DEFAULT_MODEL=claude-sonnet-4-20250514
ANTHROPIC_DEFAULT_NAME=Anthropic
ANTHROPIC_DEFAULT_BASE_URL=https://api.anthropic.com/v1
NEURAL_LABS_DEFAULT_PROVIDER=openai
```

Notes:

- `VITE_*` and `NEXT_PUBLIC_*` variables are exposed to client-side code.
- Server-only values such as provider API keys remain available through `process.env`.
- OpenAI and Anthropic env values are reconciled into Neural Labs providers on startup.
- `NEURAL_LABS_DEFAULT_PROVIDER` accepts `openai` or `anthropic`; if unset and both exist, OpenAI wins.
- The legacy `NEURAL_LABS_PROVIDER_*` variables still work as a fallback single-provider seed when the new provider-specific vars are not set.

## Docker Compose From Repo Root

Start the app from the repository root:

```bash
docker compose up --build
```

Open `http://localhost:3000`.

Compose uses the repository-root `./.env` file and bind-mounts runtime data to:

```text
./.neural-labs-data/
```

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
docker run --rm -p 3000:3000 neural-labs
```

For `docker run`, pass the root env file explicitly:

```bash
docker run --rm --env-file .env -p 3000:3000 neural-labs
```

## Local Data

Runtime data is stored in:

```text
.neural-labs-data/
```

That directory contains:

- `workspace/` for files created in the desktop
- `state.json` for desktop settings, providers, and Neura conversations

## Verification

```bash
npm run typecheck
npm run build
```
