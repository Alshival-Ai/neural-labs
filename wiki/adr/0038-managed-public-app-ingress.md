# ADR 0038: Managed public application ingress

Date: 2026-09-27. Status: accepted for Alshival-managed instances.

## Decision

Each registered managed instance can receive one application namespace below its
single-label origin, such as `*.workspace.alshival.cloud`. Alshival owns the DNS
record, wildcard TLS certificate, public gateway, current coverage checks, and
the workspace manager's web access switch. The switch defaults off. A DNS record
or certificate alone does not open an application.

The Alshival gateway resolves exactly one application label and the registered
workspace hostname. It rechecks the enabled instance, current runtime generation,
and web switch during active traffic. It forwards to the instance's private,
root-owned ingress. Only loopback traffic can enter the instance's reserved
`/__alshival_app/` route. The workspace desktop server reads
`/workspace/.neural-labs/public-apps.json` and forwards the requested label to a
port in `30000–30999` on **its own container loopback**. The application manifest
has the shape `{ "apps": { "site": { "port": 30000 } } }`. Missing names and
out-of-range ports return 404. The tenant can choose its own app labels and
processes, but cannot choose another workspace or the control plane as a target.

These hosts are public websites, outside Neural Labs member authentication. The
gateway strips portal identity and authorization headers. Application cookies are
confined to their exact host. The desktop/control origin retains its host-only
cookie, and the portal stays on `alshival.ai`. Public application content receives
no portal credentials or private workspace API grant.

## Operational consequences

An operator installs the reviewed private ingress route and accepted workspace
image on each managed host. Alshival creates the workspace DNS wildcard and its
own wildcard certificate using DNS-01, then verifies public TLS and the private
runtime route before marking the switch ready. The certificate for
`*.alshival.cloud` does not cover application hosts one level deeper. The
per-workspace certificate renews through the root-owned DNS hook.

The [deployment service](0043-workspace-app-deployments.md) now assigns app ports,
supervises processes, and verifies URLs. Its broker-owned route table is
authoritative; the editable manifest is only a browser-preview compatibility view. SSH stays behind the existing
authenticated access path; this ADR opens HTTP and HTTPS only.
