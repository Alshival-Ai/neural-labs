#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  tenant-compose.sh TENANT_ID {config|up|down|pull|ps|logs} [extra arguments]
  tenant-compose.sh --env-file /absolute/path/tenant.env ACTION [extra arguments]

Environment:
  STATE_ROOT=/srv/neural-labs/tenants
  CONTAINER_CLI=/snap/bin/docker   # or docker/podman
EOF
}

if [[ $# -lt 2 ]]; then
  usage >&2
  exit 2
fi

state_root="${STATE_ROOT:-/srv/neural-labs/tenants}"

if [[ "$1" == "--env-file" ]]; then
  if [[ $# -lt 3 ]]; then
    usage >&2
    exit 2
  fi
  env_file="$2"
  action="$3"
  shift 3
else
  tenant_id="$1"
  action="$2"
  shift 2
  if [[ ! "$tenant_id" =~ ^[a-z][a-z0-9-]{1,30}$ ]]; then
    echo "invalid tenant id: $tenant_id" >&2
    exit 2
  fi
  env_file="$state_root/$tenant_id/tenant.env"
fi

case "$action" in
  config | up | down | pull | ps | logs) ;;
  *)
    echo "unsupported action: $action" >&2
    usage >&2
    exit 2
    ;;
esac

if [[ ! -f "$env_file" ]]; then
  echo "tenant environment file not found: $env_file" >&2
  exit 1
fi

env_file="$(realpath -- "$env_file")"
tenant_dir="$(dirname -- "$env_file")"
tenant_home="$(sed -n 's/^TENANT_HOME_DIR=//p' "$env_file" | tail -n 1)"
tenant_secrets="$(sed -n 's/^TENANT_SECRETS_ENV=//p' "$env_file" | tail -n 1)"

if [[ -z "$tenant_home" || -z "$tenant_secrets" ]]; then
  echo "tenant environment is missing required paths" >&2
  exit 1
fi

tenant_home="$(realpath -- "$tenant_home")"
tenant_secrets="$(realpath -- "$tenant_secrets")"

if [[ "$tenant_home" != "$tenant_dir/home" ]]; then
  echo "TENANT_HOME_DIR must be the home directory beside tenant.env" >&2
  exit 1
fi

if [[ "$tenant_secrets" != "$tenant_dir/secrets/gateway.env" ]]; then
  echo "TENANT_SECRETS_ENV must be the tenant's gateway.env" >&2
  exit 1
fi

case "$tenant_dir" in
  / | /root | /root/* | /home/data-team | /home/data-team/*)
    echo "refusing tenant state inside a host administrator directory" >&2
    exit 1
    ;;
esac

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
compose_file="$repo_root/platform/compose/compose.yaml"
container_cli="${CONTAINER_CLI:-}"

if [[ -z "$container_cli" ]]; then
  if command -v docker >/dev/null 2>&1; then
    container_cli="$(command -v docker)"
  elif command -v podman >/dev/null 2>&1; then
    container_cli="$(command -v podman)"
  else
    echo "docker or podman with a Compose provider is required" >&2
    exit 1
  fi
fi

if [[ ! -x "$container_cli" ]]; then
  echo "container CLI is not executable: $container_cli" >&2
  exit 1
fi

compose_args=(
  compose
  --project-directory "$(dirname -- "$env_file")"
  --env-file "$env_file"
  --file "$compose_file"
)

case "$action" in
  up)
    exec "$container_cli" "${compose_args[@]}" up -d --remove-orphans "$@"
    ;;
  *)
    exec "$container_cli" "${compose_args[@]}" "$action" "$@"
    ;;
esac
