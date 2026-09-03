# Backup and restore

A complete recovery set contains a PostgreSQL dump, the protected root `.env`,
and the shared workspace archive. Omitting any one loses instance state.

## Backup

Run from the repository root with the stack healthy:

```bash
bin/neural-labs backup
```

The default destination is `../backups/neural-labs`, deliberately outside the
public Git worktree. `NEURAL_LABS_BACKUP_ROOT` can set another operator-owned
default, and an explicit destination directory may be supplied as the next
argument. Never place recovery sets inside the source repository.

The command briefly stops the workspace for a consistent archive, restarts it,
and creates a timestamped recovery set containing the custom-format PostgreSQL
dump, shared home/OpenClaw/provider state, project sites below
`/home/node/workspace/projects`, media provenance, and the complete
deployment environment.
It never deletes or expires older backups.

Encrypt and move the resulting recovery set to the operator's backup system.
Never commit it. The dump contains user emails, identity identifiers, password
hashes, passkey public credentials and counters, sessions, audit data, and the
encrypted Entra credential. Passkey private keys never enter Neural Labs.

Test restoration on an isolated host or isolated Compose project. A backup that
has not been restored is not a verified backup.

## Restore

Restoration replaces instance state and is destructive. The CLI validates the
recovery set and creates a separate safety backup first. Run:

```bash
sudo bin/neural-labs restore /absolute/path/to/neural-labs-backup-TIMESTAMP --confirm
```

The explicit confirmation is required. The command stops public services,
restores PostgreSQL and workspace volumes, synchronizes the database role
password with the restored `.env`, starts the cluster, and runs the deployment
doctor. If restoration fails, inspect the reported safety backup before taking
further action.

For manual disaster recovery:

1. Restore the root `.env` with mode `0600` before starting the control plane.
2. Start PostgreSQL without exposing application routes.
3. Restore the custom-format dump with `pg_restore --clean --if-exists` into the
   `neural_labs` database.
4. Start the control plane, check `/readyz`, and inspect container logs.
5. Restore `workspace-home.tar.gz` into the three workspace volumes while the
   Gateway is stopped.
6. Start the landing and workspace containers and restore Nginx traffic.
7. Test local login, Microsoft login, administrator access, workspace HTTP and
   WebSocket access, Codex status, an OpenClaw automation, and the loopback
   provider MCP.

The PostgreSQL password can be deliberately rotated with coordinated database
and `.env` changes. Compose rematerializes the MCP config token for both
consuming containers and the separate workspace-control token for the control
plane and workspace. Replacing the control-plane master key without
first re-encrypting the stored Entra credential breaks Microsoft login; use the
administrator credential-rotation form instead.
