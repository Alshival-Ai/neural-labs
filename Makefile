.PHONY: validate test build compose-config security

validate:
	bash tests/public_boundary_test.sh
	python3 bin/export-wiki.py --check
	python3 tests/wiki_export_test.py
	node bin/openclaw-release.mjs check
	node --test tests/openclaw-release.test.mjs tests/openclaw-tree.test.mjs
	npm --prefix console run validate
	npm --prefix control-plane run validate
	npm --prefix mcp run validate
	node --check web/app.js
	node --check web/server.mjs
	node --check workspace/start.mjs
	node --check workspace/browser-config.mjs
	node --check workspace/notification-scheduler.mjs
	node --check workspace/personal-automation-runs.mjs
	node --check bin/install-prospect-automation.mjs
	python3 workspace/bundled-skills/prospect-video-site/scripts/test_helpers.py
	python3 workspace/bundled-skills/prospect-video-site/scripts/test_presentation_profiles.py
	python3 workspace/bundled-skills/prospect-video-site/scripts/test_visual_quality.py
	node --check workspace/bundled-skills/prospect-video-site/scripts/qa-site.mjs
	node --check workspace/http-server.mjs
	node --check workspace/builder-manager.mjs
	node --check workspace/vscode-proxy.mjs
	node --check workspace/file-manager.mjs
	node --check workspace/explorer-manager.mjs
	node --check workspace/build-minipaint.mjs
	node --check workspace/skills-manager.mjs
	node --check workspace/file-events.mjs
	node --check workspace/claude-accounts.mjs
	node --check workspace/claude-login-socket.mjs
	node --check workspace/claude-runtime.mjs
	node --check workspace/model-accounts.mjs
	node --check workspace/claude-native-key.mjs
	node --check workspace/native-provider-order.mjs
	node --check workspace/provider-auth.mjs
	node --check workspace/provider-environment.mjs
	node --check workspace/model-catalog.mjs
	node --check workspace/model-policies.mjs
	node --check workspace/native-config-batch.mjs
	node --check workspace/openclaw-runtime.mjs
	node --check workspace/gateway-isolation.mjs
	node --check workspace/team-openai.mjs
	node --check workspace/personal-openai.mjs
	node --check workspace/team-agent.mjs
	node --check workspace/voice.mjs
	node --check workspace/terminal-manager.mjs
	node --check workspace/terminal-agent.mjs
	node --check workspace/terminal-guidance.mjs
	node --check mcp/dist/local.js
	npm --prefix workspace/desktop run validate
	node --test web/server.test.mjs
	npm --prefix workspace test
	bash -n bin/neural-labs
	bash -n bin/openclaw-smoke-test
	bash -n bin/openclaw-compare-image
	bash -n bin/openclaw-upgrade-smoke
	node --check tests/openclaw-migration-smoke.mjs
	node --check tests/openclaw-role-smoke.mjs
	node --check tests/openclaw-sms-smoke.mjs
	bash tests/deployment_cli_test.sh
	bash -n tests/workspace_update_test.sh
	bash tests/workspace_update_test.sh
	docker compose --env-file .env.example -f deploy/compose/compose.yaml config --quiet

test:
	npm --prefix console test
	npm --prefix control-plane test
	npm --prefix mcp test
	npm --prefix workspace/desktop test
	node --test web/server.test.mjs
	npm --prefix workspace test

build:
	npm --prefix console run build
	npm --prefix control-plane run build
	npm --prefix mcp run build
	npm --prefix workspace/desktop run build
	docker compose --env-file .env.example -f deploy/compose/compose.yaml build

compose-config:
	docker compose --env-file .env.example -f deploy/compose/compose.yaml config

security:
	bash tests/public_boundary_test.sh
