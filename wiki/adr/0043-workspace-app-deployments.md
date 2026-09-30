# ADR 0043: Supervised workspace application deployments

Date: 2026-09-30. Status: accepted.

A bundled deploy skill calls a runtime-owned deployment service shared with the
Deployments desktop app. The broker owns persisted definitions, process groups,
release snapshots, readiness checks and the authoritative public route table.
An editable project manifest never authorizes a public upstream. A compatibility
manifest remains available for authenticated browser previews.

Public app visitors execute no agent tools and receive no provider, portal, or
control-plane credentials. App launchers reuse native filesystem/PID isolation
with a dedicated home and only the selected release mounted. Builds are writable;
serving releases are read-only. Persistent data is kept in the app's home.
Private-infrastructure egress restrictions and workspace resource limits remain
host-enforced. Apps are workspace-owned, survive chat completion and need no
continued AI execution lease. Admission/build operations revalidate their caller;
public gateway coverage and generation checks continue independently.

Agent calls use the existing per-execution MCP capability and read-only policy.
Desktop calls require signed workspace requests, same-origin mutations and live
control-plane session revalidation. Long-lived apps cannot hold upgrade idle
gates forever: in-flight deployments count as activity, while serving processes
are stopped at maintenance and restored after committed activation.

Loopback hosting uses explicit host-only Docker port mappings and exact Host
validation on the app gateways. Public hosting uses a separate wildcard namespace
and operator-owned TLS ingress. Managed hosting obtains current domain/readiness
through the optional hosting integration; no billing or provider-specific DNS
credentials are part of the generic product. Custom managed namespaces require
operator verification of workspace-bound DNS ownership, TLS and ingress before
registration. See [Deployments](../deployments.md) for setup and limitations.
