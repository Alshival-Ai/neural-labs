# Web deployment

The standalone `neural-labs-web.service` deployment has been superseded by the
containerized landing page, control plane, MCP server, and PostgreSQL topology.

See [Container deployment and onboarding](container-deployment.md). The former
host-specific systemd unit is intentionally not retained as a reusable example;
container restart policies now provide service lifecycle management.
