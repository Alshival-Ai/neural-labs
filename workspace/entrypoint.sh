#!/usr/bin/env bash
set -euo pipefail
runtime_state_root="${NEURAL_LABS_NATIVE_STATE_ROOT:-/home/node/.local/state/neural-labs/native}"
mkdir -p -- "$runtime_state_root"
chmod 700 -- "$runtime_state_root"
# Keep the lock in the runtime itself, not a flock parent that SIGTERM could
# terminate before the runtime finishes draining its children.
exec 9>"$runtime_state_root/runtime.lock"
flock --exclusive --nonblock 9
# Set no-new-privileges after entering the container's AppArmor profile. Setting
# it before exec prevents Snap Docker's profile transition on supported hosts.
exec setpriv --no-new-privs node /usr/local/lib/neural-labs/start.mjs
