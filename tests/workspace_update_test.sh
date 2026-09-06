#!/usr/bin/env bash
set -euo pipefail
repository_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
scratch="$(mktemp -d)"
trap 'rm -rf -- "${scratch}"' EXIT
cat >"${scratch}/driver.sh" <<'DRIVER'
#!/usr/bin/env bash
set -euo pipefail
source "${CLI_TEST_REPOSITORY}/bin/neural-labs"
backup_root="${CLI_TEST_SCRATCH}/backups"
compose_environment="${CLI_TEST_SCRATCH}/example.env"
trace="${CLI_TEST_SCRATCH}/trace"
require_command() { :; }
validate_deployment_config() { :; }
node() { :; }
command_backup() {
  echo backup >>"${trace}"
  last_backup_directory="${CLI_TEST_SCRATCH}/synthetic-backup"
  [[ "${CLI_TEST_FAILURE}" != backup ]]
}
compose() {
  case "$1" in
    ps) printf 'test-container\n' ;;
    build)
      echo build >>"${trace}"
      [[ "${CLI_TEST_FAILURE}" != build ]]
      ;;
    up)
      [[ "$*" == *'--no-build --pull never'* ]]
      echo up >>"${trace}"
      ;;
    *) return 1 ;;
  esac
}
docker() {
  case "$1" in
    inspect)
      if [[ "$3" == '{{.Image}}' ]]; then
        echo inspect-image >>"${trace}"
        printf 'sha256:%064d\n' 1
      else
        echo inspect-env >>"${trace}"
        printf '%s\n' 'NEURAL_LABS_OPENCLAW_VERSION=2026.8.2' 'NEURAL_LABS_CODEX_VERSION=0.152.0' 'UNRELATED_SECRET=placeholder'
      fi
      ;;
    image) echo tag >>"${trace}" ;;
    *) return 1 ;;
  esac
}
wait_for_health() { echo health >>"${trace}"; }
curl() { printf '401'; }
command_workspace_update
DRIVER
for failure in build backup none; do
  : >"${scratch}/trace"
  if CLI_TEST_REPOSITORY="${repository_root}" CLI_TEST_SCRATCH="${scratch}" CLI_TEST_FAILURE="${failure}" \
      bash "${scratch}/driver.sh" >"${scratch}/output" 2>&1; then
    [[ "${failure}" == none ]]
  else
    [[ "${failure}" != none ]]
  fi
  actual="$(cat "${scratch}/trace")"
  case "${failure}" in
    build) [[ "${actual}" == $'inspect-image\ntag\nbuild' ]] ;;
    backup) [[ "${actual}" == $'inspect-image\ntag\nbuild\nbackup' ]] ;;
    none) [[ "${actual}" == $'inspect-image\ntag\nbuild\nbackup\ninspect-env\nup\nhealth' ]] ;;
  esac
done
record="$(find "${scratch}/backups" -name rollback-images.yaml)"
grep -q 'image: sha256:' "${record}"
grep -q 'NEURAL_LABS_OPENCLAW_VERSION: "2026.8.2"' "${record}"
if grep -q 'UNRELATED_SECRET' "${record}"; then
  echo 'rollback record must not contain unrelated container environment' >&2
  exit 1
fi
echo 'workspace-update: build/backup failure ordering and exact-image recovery passed'
