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
  automations/private-task/automation.md \
  .codex/private-state.json \
  .ssh/id_example \
  credentials/provider.json \
  memory/private.md \
  .openclaw/openclaw.json \
  secrets/provider.token \
  certificates/private.crt \
  private-network.ovpn \
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
  '**/*.crt' \
  '**/*.cer' \
  '**/*.ovpn' \
  '**/.ssh' \
  '**/.ssh/**' \
  '**/secrets' \
  '**/secrets/**' \
  '**/credentials' \
  '**/credentials/**' \
  '**/skills' \
  '**/skills/**' \
  '**/automations' \
  '**/automations/**' \
  '**/backups' \
  '**/backups/**' \
  '**/.openclaw' \
  '**/.openclaw/**' \
  '**/.codex' \
  '**/.codex/**' \
  '**/openclaw.json'
do
  assert_docker_rule "${pattern}"
done

while IFS= read -r -d '' publication_path; do
  [[ -e "${publication_path}" ]] || continue
  case "${publication_path}" in
    .env|*/.env|.env.*|*/.env.*)
      [[ "${publication_path}" == .env.example || "${publication_path}" == */.env.example ]] ||
        fail "private environment file is eligible for publication: ${publication_path}"
      ;;
    backups/*|*/backups/*|skills/*|automations/*|credentials/*|memory/*|.codex/*|*/.codex/*|.openclaw/*|*/.openclaw/*|.ssh/*|*/.ssh/*|secrets/*|*/secrets/*)
      fail "private runtime path is eligible for publication: ${publication_path}"
      ;;
    *.secret|*.token|*.key|*.pem|*.p12|*.pfx|*.crt|*.cer|*.ovpn|id_rsa*|*/id_rsa*|id_ed25519*|*/id_ed25519*)
      fail "credential-shaped file is eligible for publication: ${publication_path}"
      ;;
    MEMORY.md|USER.md|IDENTITY.md|SOUL.md)
      fail "private agent profile is eligible for publication: ${publication_path}"
      ;;
  esac
done < <(git ls-files -co --exclude-standard -z)

node <<'NODE'
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

const paths = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"])
  .toString("utf8")
  .split("\0")
  .filter(Boolean);
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i,
];
const ipv4 = /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g;

function allowedAddress(octets) {
  return octets[0] === 127 ||
    octets.every((value) => value === 0) ||
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 192 && octets[1] === 0 && octets[2] === 2) ||
    (octets[0] === 198 && octets[1] === 51 && octets[2] === 100) ||
    (octets[0] === 203 && octets[1] === 0 && octets[2] === 113);
}

for (const path of paths) {
  let content;
  try { content = fs.readFileSync(path); } catch { continue; }
  if (content.includes(0)) continue;
  const text = content.toString("utf8");
  if (secretPatterns.some((pattern) => pattern.test(text))) {
    console.error(`public-boundary: credential-shaped content is tracked in ${path}`);
    process.exit(1);
  }
  for (const match of text.matchAll(ipv4)) {
    const octets = match[0].split(".").map(Number);
    if (octets.some((value) => value > 255) || allowedAddress(octets)) continue;
    console.error(`public-boundary: non-publication IP address is tracked in ${path}`);
    process.exit(1);
  }
}
NODE

if grep -Fq 'backup_root="${repository_root}/backups"' bin/neural-labs; then
  fail 'default backup root must remain outside the public worktree'
fi

echo 'public-boundary: pass'
