.PHONY: validate test compose-config gateway-build

validate:
	./scripts/validate.sh

test: validate

compose-config:
	@test -n "$(TENANT_ENV)" || { echo "usage: make compose-config TENANT_ENV=/path/to/tenant.env" >&2; exit 2; }
	./scripts/tenant-compose.sh --env-file "$(TENANT_ENV)" config

gateway-build:
	@test -n "$(OPENCLAW_BASE_IMAGE)" || { echo "usage: make gateway-build OPENCLAW_BASE_IMAGE=ghcr.io/openclaw/openclaw@sha256:..." >&2; exit 2; }
	$${CONTAINER_CLI:-docker} build --build-arg "OPENCLAW_BASE_IMAGE=$(OPENCLAW_BASE_IMAGE)" -t neural-labs/openclaw-gateway:dev images/openclaw-gateway
