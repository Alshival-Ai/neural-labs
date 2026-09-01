# Incident response

## Suspected tenant compromise

1. From the host, stop the affected tenant without entering its container:

   ```bash
   ./scripts/tenant-compose.sh <tenant> down
   ```

2. Block its assigned VPN ingress and revoke its Gateway, MCP, provider, channel, and SSH credentials.
3. Preserve logs and a read-only copy of the tenant state for investigation. Do not print secrets.
4. Check runtime events, host authentication logs, MCP audit records, unexpected mounts, image identity, and cross-tenant network attempts.
5. Verify Kiki's production services and every other tenant.
6. Rebuild from pinned images and a known-good state or provision a fresh tenant. Do not merely restart a suspected compromised container.

## Leaked credential

Revoke and replace the credential at its issuer first, then update the protected tenant secret file and restart only that tenant. Verify the old credential fails. Review audit logs for the entire exposure window.

## Resource exhaustion

Stop or reduce the offending tenant, preserve Kiki's production-service headroom, and inspect memory, process, CPU, and disk-I/O limits. Do not remove global resource controls to make one workload pass.

## Container escape suspicion

Treat Kiki as compromised. Isolate it from the network while preserving required incident access, stop issuing new credentials, and follow the organization's host incident process. Tenant container rebuilds alone are not sufficient.
