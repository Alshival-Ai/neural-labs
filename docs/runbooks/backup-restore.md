# Tenant backup and restore

## Backup scope

Back up each tenant's complete directory under `/srv/neural-labs/tenants/<tenant>`, including its home, OpenClaw state, SSH configuration, and secrets. Treat every backup as credential-bearing sensitive data.

Also retain the exact repository commit, image digests, tenant port allocation, and MCP policy needed to recreate the cell.

## Backup procedure

1. Record Gateway health and the active image digests.
2. Stop the tenant cell for a simple consistent skeleton backup. If future databases require online snapshots, add application-aware snapshot logic before allowing write traffic.
3. Archive with owners, modes, ACLs, and xattrs preserved.
4. Encrypt the backup, generate a checksum, and store it separately from Kiki.
5. Restart the cell and verify health.
6. Periodically restore to an isolated staging path and run a smoke test.

Do not mix this tenant backup workflow with Kiki's one-time OS migration backup. Preserve the migration backup under its existing recovery rules.

## Restore procedure

1. Verify the encrypted backup and checksum.
2. Restore into staging, never over an active tenant.
3. inspect paths, numeric ownership, modes, and secret files without printing values.
4. Confirm the target tenant ID and ports are not active.
5. Move the staged directory into the tenant state root.
6. run `tenant-compose.sh <tenant> config` and review mounts before startup.
7. Start the cell, check Gateway and Control UI health, test MCP authorization, and confirm other tenants remain isolated.

Rotate credentials after a restore into any environment with a different trust level.
