.PHONY: validate test build compose-config security

validate:
	bash tests/public_boundary_test.sh
	npm --prefix console run validate
	npm --prefix control-plane run validate
	npm --prefix mcp run validate
	node --check web/app.js
	node --check web/server.mjs
	node --check workspace/start.mjs
	node --check workspace/http-server.mjs
	node --check workspace/file-manager.mjs
	node --check workspace/file-events.mjs
	node --check workspace/provider-auth.mjs
	node --check workspace/terminal-manager.mjs
	node --check mcp/dist/local.js
	npm --prefix workspace/desktop run validate
	node --test web/server.test.mjs
	npm --prefix workspace test
	bash -n bin/neural-labs
	bash tests/deployment_cli_test.sh
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
