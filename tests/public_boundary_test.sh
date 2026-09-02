#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repository_root="$(cd -- "${script_directory}/.." && pwd -P)"
cd "${repository_root}"

fail() {
  echo "public-boundary: $*" >&2
  exit 1
}

assert_git_ignored() {
  local path="$1"
  git check-ignore --no-index --quiet -- "${path}" ||
    fail "Git does not ignore private path: ${path}"
}

assert_docker_rule() {
  local pattern="$1"
  grep -Fqx -- "${pattern}" .dockerignore ||
    fail ".dockerignore is missing required rule: ${pattern}"
}

for private_path in \
  .env \
  .env.production \
  backups/private/database.dump \
  skills/private-team-skill/SKILL.md \
  memory/private.md \
  .openclaw/openclaw.json \
  secrets/provider.token \
  'Screenshot From private console.png'
do
  assert_git_ignored "${private_path}"
done

if git check-ignore --no-index --quiet -- .env.example; then
  fail '.env.example must remain eligible for publication'
fi

for pattern in \
  .env \
  '.env.*' \
  '**/.env' \
  '**/.env.*' \
  '**/*.secret' \
  '**/*.token' \
  '**/*.key' \
  '**/*.pem' \
  '**/*.p12' \
  '**/*.pfx' \
  '**/secrets' \
  '**/secrets/**' \
  '**/backups' \
  '**/backups/**' \
  '**/.openclaw' \
  '**/.openclaw/**' \
  '**/openclaw.json'
do
  assert_docker_rule "${pattern}"
done

while IFS= read -r -d '' tracked_path; do
  [[ -e "${tracked_path}" ]] || continue
  case "${tracked_path}" in
    .env|*/.env|.env.*|*/.env.*)
      [[ "${tracked_path}" == .env.example || "${tracked_path}" == */.env.example ]] ||
        fail "private environment file is tracked: ${tracked_path}"
      ;;
    backups/*|*/backups/*|skills/*|memory/*|.openclaw/*|*/.openclaw/*|secrets/*|*/secrets/*)
      fail "private runtime path is tracked: ${tracked_path}"
      ;;
    *.secret|*.token|*.key|*.pem|*.p12|*.pfx|id_rsa*|*/id_rsa*|id_ed25519*|*/id_ed25519*)
      fail "credential-shaped file is tracked: ${tracked_path}"
      ;;
    MEMORY.md|USER.md|IDENTITY.md|SOUL.md)
      fail "private agent profile is tracked: ${tracked_path}"
      ;;
  esac
done < <(git ls-files -z)

if grep -Fq 'backup_root="${repository_root}/backups"' bin/neural-labs; then
  fail 'default backup root must remain outside the public worktree'
fi

echo 'public-boundary: pass'
