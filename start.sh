#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_COMPOSE_FILE="compose.yml"

compose_file="$DEFAULT_COMPOSE_FILE"
compose_restart=false
detach=false
build=true
logs=false
service_name="neural-labs"
extra_args=()

usage() {
  cat <<'EOF'
Usage: ./start.sh [options] [-- <extra docker compose up args>]

Options:
  --compose-restart       Run "docker compose down --remove-orphans" before starting
  --compose-file, -f      Compose file path (default: compose.yml)
  --detach, -d            Run in detached mode
  --no-build              Skip --build
  --logs                  Follow service logs after startup
  --service               Service name for logs (default: neural-labs)
  --help, -h              Show this help

Examples:
  ./start.sh
  ./start.sh --compose-restart
  ./start.sh --compose-restart --detach --logs
  ./start.sh -f docker-compose.yml --compose-restart
  ./start.sh -- --pull always
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --compose-restart)
      compose_restart=true
      shift
      ;;
    --compose-file|-f)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for $1" >&2
        exit 1
      fi
      compose_file="$2"
      shift 2
      ;;
    --detach|-d)
      detach=true
      shift
      ;;
    --no-build)
      build=false
      shift
      ;;
    --logs)
      logs=true
      shift
      ;;
    --service)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for $1" >&2
        exit 1
      fi
      service_name="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --)
      shift
      extra_args+=("$@")
      break
      ;;
    *)
      extra_args+=("$1")
      shift
      ;;
  esac
done

if [[ ! -f "$ROOT_DIR/$compose_file" ]]; then
  echo "Compose file not found: $ROOT_DIR/$compose_file" >&2
  exit 1
fi

get_env_value() {
  local key="$1"
  local env_file="$ROOT_DIR/.env"
  if [[ -f "$env_file" ]]; then
    local line
    line="$(grep -E "^${key}=" "$env_file" | tail -n 1 || true)"
    if [[ -n "$line" ]]; then
      printf '%s\n' "${line#*=}"
      return
    fi
  fi
  printf '%s\n' ""
}

workspace_image="${NEURAL_LABS_WORKSPACE_IMAGE:-$(get_env_value NEURAL_LABS_WORKSPACE_IMAGE)}"
if [[ -z "$workspace_image" || "$workspace_image" == "ubuntu:24.04" ]]; then
  workspace_image="neural-labs-workspace:latest"
fi
export NEURAL_LABS_WORKSPACE_IMAGE="$workspace_image"

compose_cmd=(docker compose -f "$ROOT_DIR/$compose_file")

if [[ "$compose_restart" == true ]]; then
  echo "Restart requested: tearing down existing compose services..."
  "${compose_cmd[@]}" down --remove-orphans
fi

up_args=(up --remove-orphans)
if [[ "$build" == true ]]; then
  up_args+=(--build)
fi
if [[ "$detach" == true ]]; then
  up_args+=(-d)
fi
up_args+=("${extra_args[@]}")

if [[ "$build" == true ]]; then
  if [[ "$workspace_image" == neural-labs-workspace* ]]; then
    echo "Building workspace image: $workspace_image"
    docker build -f "$ROOT_DIR/workspace.Dockerfile" -t "$workspace_image" "$ROOT_DIR"
  else
    echo "Using configured workspace image without local build: $workspace_image"
  fi
fi

echo "Starting services with $compose_file..."
"${compose_cmd[@]}" "${up_args[@]}"

if [[ "$logs" == true ]]; then
  echo "Following logs for service: $service_name"
  "${compose_cmd[@]}" logs -f "$service_name"
fi
