#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cli="${repository_root}/bin/neural-labs"

help_output="$(${cli} help)"
grep -q 'init.*single root .env' <<<"${help_output}"
grep -q 'doctor.*Validate configuration' <<<"${help_output}"
grep -q 'workspace.*Manage the shared workspace' <<<"${help_output}"
grep -q 'workspace is newer than the running control plane' "${cli}"
grep -q 'restore DIR --confirm' <<<"${help_output}"
grep -q 'never deletes volumes' <<<"${help_output}"

onboarding_output="$(${cli} onboarding)"
grep -q 'root .env' <<<"${onboarding_output}"
grep -q 'Only the configured email' <<<"${onboarding_output}"

if "${cli}" unknown-command >/dev/null 2>&1; then
  echo "unknown commands must fail" >&2
  exit 1
fi

# shellcheck source=../bin/neural-labs
source "${cli}"
parser_fixture="$(mktemp)"
trap 'rm -f -- "${parser_fixture}"' EXIT
printf '%s\n' \
  'BASE64_VALUE=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' \
  'MULTI_EQUALS=first=second==' >"${parser_fixture}"

[[ "$(env_value_from "${parser_fixture}" BASE64_VALUE)" == 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' ]]
[[ "$(env_value_from "${parser_fixture}" MULTI_EQUALS)" == 'first=second==' ]]

compose_file="${repository_root}/deploy/compose/compose.yaml"
nginx_file="${repository_root}/deploy/nginx/neural-labs.ai.conf"
grep -q '^  workspace:$' "${compose_file}"
grep -q 'NEURAL_LABS_BIND_ADDRESS.*WORKSPACE_PORT' "${compose_file}"
grep -q 'NEURAL_LABS_BIND_ADDRESS.*WORKSPACE_DESKTOP_PORT' "${compose_file}"
grep -q 'workspace-home:/home/node' "${compose_file}"
grep -q 'NEURAL_LABS_WORKSPACE_CONTROL_TOKEN' "${compose_file}"
grep -q 'NEURAL_LABS_WORKSPACE_MAX_UPLOAD_BYTES' "${compose_file}"
grep -q 'CONTROL_PLANE_WORKSPACE_TEAM_AGENT_URL' "${compose_file}"
grep -q 'NEURAL_LABS_MCP_GOOGLE_ENV_FILE' "${compose_file}"
grep -q 'NEURAL_LABS_MCP_PEXELS_ENV_FILE' "${compose_file}"
grep -q 'NEURAL_LABS_WORKSPACE_MCP_PORT' "${compose_file}"
if grep -q '^  mcp:$' "${compose_file}"; then
  echo "public MCP must not be a Compose service in V1" >&2
  exit 1
fi
grep -q 'auth_request /_workspace_auth' "${nginx_file}"
grep -q 'neural_labs_workspace_desktop' "${nginx_file}"
grep -q 'proxy_set_header Upgrade \$http_upgrade' "${nginx_file}"
grep -A2 'location = /mcp' "${nginx_file}" | grep -q 'return 404'
[[ "$(grep -c 'client_max_body_size 2g' "${nginx_file}")" -ge 3 ]]
if grep -Eq 'privileged:[[:space:]]*true|/var/run/docker.sock|/home/data-team|/root:' "${compose_file}"; then
  echo "workspace Compose configuration contains a prohibited privilege or mount" >&2
  exit 1
fi
