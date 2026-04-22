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
NEURAL_LABS_PROVIDER_KIND=openai
NEURAL_LABS_PROVIDER_NAME=OpenAI
NEURAL_LABS_PROVIDER_MODEL=gpt-5-mini
NEURAL_LABS_PROVIDER_BASE_URL=https://api.openai.com/v1
NEURAL_LABS_PROVIDER_API_KEY=your_api_key_here
```

Notes:

- `VITE_*` and `NEXT_PUBLIC_*` variables are exposed to client-side code.
- Server-only values such as provider API keys remain available through `process.env`.
- Provider env values seed the initial default provider for Desktop Settings and Neura.

## Docker From Repo Root

Build from the repository root:

```bash
docker build -t neural-labs .
```

Run:

```bash
docker run --rm -p 3000:3000 neural-labs
```

The root `./.env` file is copied into the image so the standalone app can boot
with the same configuration inside Docker.

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
