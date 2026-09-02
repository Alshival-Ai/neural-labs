# Web deployment

The standalone `neural-labs-web.service` deployment has been superseded by the
containerized landing page, control plane, shared workspace, and PostgreSQL
topology. The provider MCP runs inside the workspace container and is not
publicly routed.

See [Container deployment and onboarding](container-deployment.md). The former
host-specific systemd unit is intentionally not retained as a reusable example;
container restart policies now provide service lifecycle management.
