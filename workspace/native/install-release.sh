#!/usr/bin/env bash
set -euo pipefail
release_file=/usr/local/lib/neural-labs/native/release.json
runtime_arch=$(dpkg --print-architecture)
case "$runtime_arch" in amd64|arm64) ;; *) echo 'Unsupported native runtime architecture' >&2; exit 1 ;; esac
release_value() { jq --exit-status --raw-output "$1" "$release_file"; }

codex_version=$(release_value '.codex')
claude_version=$(release_value '.claude')
npm install --prefix /usr/local/lib/neural-labs/codex-app-server --ignore-scripts --no-audit --no-fund "@openai/codex@${codex_version}"
ln -s /usr/local/lib/neural-labs/codex-app-server/node_modules/.bin/codex /usr/local/bin/codex
npm install --global --ignore-scripts --no-audit --no-fund "@anthropic-ai/claude-code@${claude_version}"
# The pinned package's postinstall selects its matching native optional binary.
npm rebuild --global @anthropic-ai/claude-code
test "$(codex --version)" = "codex-cli ${codex_version}"
test "$(claude --version)" = "${claude_version} (Claude Code)"

code_server_version=$(release_value '.codeServer.version')
code_server_sha=$(release_value ".codeServer.sha256.${runtime_arch}")
code_server_archive=/tmp/neural-labs-code-server.tar.gz
curl --fail --location --retry 3 --output "$code_server_archive" \
  "https://github.com/coder/code-server/releases/download/v${code_server_version}/code-server-${code_server_version}-linux-${runtime_arch}.tar.gz"
echo "${code_server_sha}  ${code_server_archive}" | sha256sum --check --strict
tar --extract --gzip --file "$code_server_archive" --directory /usr/local/lib
mv "/usr/local/lib/code-server-${code_server_version}-linux-${runtime_arch}" /usr/local/lib/code-server
ln -s /usr/local/lib/code-server/bin/code-server /usr/local/bin/code-server
rm "$code_server_archive"

supercronic_version=$(release_value '.supercronic.version')
supercronic_sha=$(release_value ".supercronic.sha256.${runtime_arch}")
curl --fail --location --retry 3 --output /usr/local/bin/supercronic \
  "https://github.com/aptible/supercronic/releases/download/v${supercronic_version}/supercronic-linux-${runtime_arch}"
echo "${supercronic_sha}  /usr/local/bin/supercronic" | sha256sum --check --strict
chmod 0755 /usr/local/bin/supercronic
/usr/local/bin/supercronic -version
npm cache clean --force
