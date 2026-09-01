#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: provision-tenant.sh TENANT_ID GATEWAY_PORT

Creates a new tenant directory. It never starts containers or changes firewall
rules. Override STATE_ROOT, GLOBAL_SKILLS_DIR, or GATEWAY_IMAGE in the operator
environment.
EOF
}

if [[ $# -ne 2 ]]; then
  usage >&2
  exit 2
fi

tenant_id="$1"
gateway_port="$2"

if [[ ! "$tenant_id" =~ ^[a-z][a-z0-9-]{1,30}$ ]]; then
  echo "TENANT_ID must be 2-31 lowercase letters, numbers, or hyphens" >&2
  exit 2
fi

if [[ ! "$gateway_port" =~ ^[0-9]+$ ]] || ((gateway_port < 1024 || gateway_port > 65535)); then
  echo "GATEWAY_PORT must be numeric and between 1024 and 65535" >&2
  exit 2
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
state_root="${STATE_ROOT:-/srv/neural-labs/tenants}"
tenant_dir="$state_root/$tenant_id"
global_skills_dir="${GLOBAL_SKILLS_DIR:-/opt/neural-labs/current/skills}"
gateway_image="${GATEWAY_IMAGE:-neural-labs/openclaw-gateway:dev}"

if [[ -e "$tenant_dir" ]]; then
  echo "refusing to overwrite existing tenant directory: $tenant_dir" >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required to generate tenant credentials" >&2
  exit 1
fi

umask 077
install -d -m 0700 "$tenant_dir/home/.openclaw/workspace"
install -d -m 0700 "$tenant_dir/home/.ssh"
install -d -m 0700 "$tenant_dir/secrets"
install -m 0600 "$repo_root/platform/config/openclaw.json" \
  "$tenant_dir/home/.openclaw/openclaw.json"

gateway_token="$(openssl rand -hex 32)"

printf '%s\n' \
  "OPENCLAW_GATEWAY_TOKEN=$gateway_token" \
  'TEAM_MCP_URL=https://mcp.example.invalid/mcp' \
  'TEAM_MCP_TOKEN=REPLACE_WITH_TENANT_SCOPED_TOKEN' \
  >"$tenant_dir/secrets/gateway.env"
unset gateway_token

printf '%s\n' \
  "TENANT_ID=$tenant_id" \
  'TZ=America/Chicago' \
  "TENANT_HOME_DIR=$tenant_dir/home" \
  "TENANT_SECRETS_ENV=$tenant_dir/secrets/gateway.env" \
  "GLOBAL_SKILLS_DIR=$global_skills_dir" \
  "GATEWAY_IMAGE=$gateway_image" \
  "GATEWAY_PORT=$gateway_port" \
  'GATEWAY_CPUS=2.0' \
  'GATEWAY_MEMORY=3g' \
  'GATEWAY_PIDS_LIMIT=512' \
  >"$tenant_dir/tenant.env"

chmod 0700 "$tenant_dir" "$tenant_dir/home" "$tenant_dir/home/.openclaw" \
  "$tenant_dir/home/.openclaw/workspace" "$tenant_dir/home/.ssh" \
  "$tenant_dir/secrets"
chmod 0600 "$tenant_dir/tenant.env" "$tenant_dir/secrets/gateway.env" \
  "$tenant_dir/home/.openclaw/openclaw.json"

echo "Created tenant skeleton at $tenant_dir"
echo "No containers were started and no credentials were printed."
echo "Issue the tenant MCP credential, review tenant.env, then follow the provisioning runbook."
