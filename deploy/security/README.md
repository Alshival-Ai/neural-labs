# Native workspace isolation

The runtime service holds account directories and short-lived execution leases.
Every provider, private Terminal, and editor runs through Bubblewrap with a
private PID/user/mount namespace, a cleared environment, read-only system files,
one selected account home, and the shared workspace. Namespace setup failure
rejects the operation. Browsers never connect directly to provider processes.

`native-seccomp.json` derives from Moby's default profile at
[`85e237f1fe229a0c61c9c7d8e743fa780d3b97ca`](https://github.com/moby/profiles/tree/85e237f1fe229a0c61c9c7d8e743fa780d3b97ca).
The final three rules allow creation of the broker's user/mount/PID/IPC/UTS
namespaces and filesystem setup. The `chroot` allowance is also required by
Chromium's own sandbox. Other default restrictions, including BPF, keys,
io_uring, AF_ALG, AF_VSOCK, and clone3 fallback behavior, remain in place.
The supported native architectures are amd64 and arm64.

`neural-labs-native.apparmor` derives from that same revision's container
profile. It permits nested namespace mount operations and retains the default
kernel-path, signal, and network-family restrictions. The outer container **must
run as UID 1000 with all Linux capabilities dropped**, private PID/IPC/network
namespaces, and no host devices or daemon socket. Mount/chroot capability checks
then apply inside the newly created unprivileged user namespace.

Docker's masked `/proc` submounts prevent creation of a fresh private `/proc`
inside an unprivileged child namespace. The native container therefore uses
`systempaths=unconfined` together with the supplied AppArmor profile; the broker
mounts no `/sys` tree into providers. Do not use this option with a privileged
container, host PID namespace, or an unconfined AppArmor profile. Seccomp and
AppArmor themselves remain enabled. See Docker's [seccomp documentation](https://docs.docker.com/engine/security/seccomp/)
and [AppArmor documentation](https://docs.docker.com/engine/security/apparmor/).

The entrypoint sets `no_new_privs` using `setpriv` after the container's AppArmor
transition and before starting the runtime. Setting it in Docker's OCI
configuration prevents that transition on Snap Docker; the entrypoint covers the
runtime and all descendants. Bubblewrap also sets it for launched processes.

Snap Docker additionally restricts which container profiles its daemon may
inspect and signal. `snap_policy.py` produces an idempotent extension granting
only `signal(send)` and `ptrace(read,trace)` to `neural-labs-native-v1`. The native
profile grants the matching receive/read-by access. This leaves `docker-default`
and existing containers' profiles unchanged. The installer retains originals,
leaves Snap's generated file unchanged, and applies the extension in kernel
policy only. Do not activate native workspaces on Snap hosts before the
management permission check passes.

`sudo python3 tests/native-snap-startup.py` is an explicit synthetic rehearsal:
it temporarily loads this extension, verifies native readiness, rejects unsigned
workspace and unscoped MCP requests, checks Docker exec and graceful stop, and
restores the original daemon policy in `finally`. It does not install persistent
host configuration. Its fixed image tag is a local fixture, never a release pin.

## Explicit host preparation

Review and install this **separately named** AppArmor profile on the destination
before starting a candidate:

```bash
sudo python3 deploy/security/install.py install
sudo python3 /opt/neural-labs-security/install.py check
```

This explicit host step installs the native profile, a root-owned reconciler,
and the seccomp profile at `/etc/neural-labs-security/native-seccomp.json`. It
does not restart Docker, modify `docker-default`, or access workspace volumes.
Compose uses this absolute seccomp path, independent of the checkout directory.
Saved originals and loaded policy hashes live under
`/var/lib/neural-labs-security`, accessible only to root.

The systemd path watcher handles Snap source regeneration. A 30-second timer
also compares loaded kernel hashes: Snap or AppArmor can reload a policy after
the path event without changing its source again. Unchanged policies are not
reloaded. Invalid or unexpectedly changed Snap rules fail validation and remain
visible in `journalctl -u neural-labs-security.service`. Resolve a failed check
before workspace activation. The service runs after AppArmor and before Docker
at boot. No provider discovery or user account polling is involved.

Do not change host-wide user namespace sysctls to make a failing probe pass.
Hosts without the required namespace/AppArmor support need a reviewed adapter.

Run `tests/native-launcher-smoke.mjs` inside an isolated candidate to verify
other account homes and runtime environment are inaccessible, system files are
read-only, the PID namespace differs, and workspace/session writes persist.
`tests/native-container-smoke.mjs` verifies the pinned Codex initialization
protocol without inference, private editor sockets with idle/revocation cleanup,
and Chromium with its sandbox enabled. Both scripts use generated fixture state.
These operator checks are separate from non-mutating repository validation.

The native migration remains under implementation. Component checks on amd64
and ARM64 do not establish the four-job 8GB acceptance target or authorize
activation before preservation and readiness checks pass.
