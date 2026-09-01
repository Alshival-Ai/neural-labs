#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
cd "$repo_root"

required_files=(
  README.md
  SECURITY.md
  docs/architecture.md
  docs/threat-model.md
  platform/compose/compose.yaml
  platform/compose/tenant.env.example
  platform/config/openclaw.json
  images/openclaw-gateway/Containerfile
)

for required_file in "${required_files[@]}"; do
  if [[ ! -s "$required_file" ]]; then
    echo "missing required file: $required_file" >&2
    exit 1
  fi
done

while IFS= read -r -d '' shell_file; do
  bash -n "$shell_file"
done < <(find scripts images -type f -name '*.sh' -print0)

python3 -m json.tool platform/config/openclaw.json >/dev/null

if python3 -c 'import yaml' >/dev/null 2>&1; then
  python3 - <<'PY'
from pathlib import Path
import yaml

for path in (Path("platform/compose/compose.yaml"), Path("tenants/example.yaml")):
    with path.open("r", encoding="utf-8") as stream:
        yaml.safe_load(stream)
PY
fi

if rg -n \
  "privileged:[[:space:]]*true|network_mode:[[:space:]]*['\"]?host|pid:[[:space:]]*['\"]?host|ipc:[[:space:]]*['\"]?host|docker\.sock|podman\.sock|source:[[:space:]]*/home/data-team|source:[[:space:]]*/root" \
  platform/compose; then
  echo "unsafe container boundary detected" >&2
  exit 1
fi

if rg -n 'ghcr\.io/openclaw/openclaw:latest|openclaw/openclaw:latest' . \
  --glob '!docs/**' --glob '!README.md' --glob '!scripts/validate.sh'; then
  echo "mutable OpenClaw :latest tag detected" >&2
  exit 1
fi

if rg -n \
  --glob '!scripts/validate.sh' \
  --glob '!.git/**' \
  -- '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|ghp_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9_-]{24,}'; then
  echo "possible committed credential detected" >&2
  exit 1
fi

if rg -n '[[:blank:]]+$' . --glob '!.git/**'; then
  echo "trailing whitespace detected" >&2
  exit 1
fi

echo "Repository validation passed."
