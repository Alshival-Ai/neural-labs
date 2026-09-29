"""Explicit operator rehearsal; temporarily extends only Snap's native-profile
management permissions, then restores its original kernel policy. No daemon
configuration file is changed. Runs a labeled synthetic container, no volumes,
no external network, no inference, and no deployment credentials.
"""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("snap_policy", ROOT / "deploy/security/snap_policy.py")
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)
DAEMON_PROFILE = Path("/var/lib/snapd/apparmor/profiles/snap.docker.dockerd")
NAME = "neural-native-startup-fixture"
IMAGE = "neural-labs-native:synthetic-20260929"


def command(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, capture_output=True, timeout=60, **kwargs).stdout


if os.geteuid() != 0:
    raise SystemExit("Run this explicit operator rehearsal with sudo")
if command("docker", "ps", "--all", "--filter", f"name=^/{NAME}$", "--format", "{{.ID}}").strip():
    raise SystemExit("Preserve the existing fixture; do not replace it")
original = DAEMON_PROFILE.read_text()
candidate = policy.with_native_management(original)
loaded = False
created = False
with tempfile.TemporaryDirectory(prefix="neural-native-policy-") as directory:
    original_file = Path(directory) / "original"
    candidate_file = Path(directory) / "candidate"
    original_file.write_text(original)
    candidate_file.write_text(candidate)
    command("apparmor_parser", "--skip-kernel-load", "--skip-cache", str(candidate_file))
    command("apparmor_parser", "--replace", "--skip-cache", str(ROOT / "deploy/security/neural-labs-native.apparmor"))
    try:
        command("apparmor_parser", "--replace", "--skip-cache", str(candidate_file))
        loaded = True
        command("docker", "run", "--detach", "--name", NAME, "--label", "neural-labs.fixture=native-migration",
                "--network", "none", "--read-only", "--cap-drop", "ALL",
                "--security-opt", "systempaths=unconfined",
                "--security-opt", f"seccomp={ROOT / 'deploy/security/native-seccomp.json'}",
                "--security-opt", "apparmor=neural-labs-native-v1",
                "--tmpfs", "/home/node:uid=1000,gid=1000,mode=0700,size=128m",
                "--tmpfs", "/tmp:mode=1777,size=128m",
                "--tmpfs", "/run/neural-labs:uid=1000,gid=1000,mode=0700,size=16m",
                "--env", "NEURAL_LABS_WORKSPACE_CONTROL_TOKEN=synthetic-native-control-token-for-isolated-fixture",
                "--env", "NEURAL_LABS_PUBLIC_ORIGIN=https://fixture.invalid",
                "--env", "NEURAL_LABS_CONTROL_PLANE_ORIGIN=http://127.0.0.1:9", IMAGE)
        created = True
        result = None
        for attempt in range(30):
            try:
                output = command("docker", "exec", NAME, "node", "-e", """
Promise.all([
 fetch('http://127.0.0.1:18790/healthz').then(async r=>({health:r.status,body:await r.json()})),
 fetch('http://127.0.0.1:18790/workspace/api/files').then(r=>({unsigned:r.status})),
 fetch('http://127.0.0.1:8792/mcp').then(r=>({unscopedMcp:r.status}))
]).then(v=>console.log(JSON.stringify(v))).catch(()=>process.exit(1))
""")
                result = json.loads(output)
                if result[0]["health"] == 200:
                    break
            except subprocess.CalledProcessError:
                pass
            time.sleep(1)
        assert result is not None and result[0]["health"] == 200, "Native readiness failed"
        assert result[0]["body"]["runtime"] == "native"
        assert result[1]["unsigned"] == 401 and result[2]["unscopedMcp"] == 401, result
        command("docker", "stop", "--timeout", "10", NAME)
        state = json.loads(command("docker", "inspect", NAME))[0]["State"]
        assert not state["Running"] and state["ExitCode"] == 0, state
        print(json.dumps({"nativeReadiness": True, "unsignedRejected": True, "unscopedMcpRejected": True,
                          "dockerExec": True, "gracefulStop": True, "inference": False}))
    finally:
        try:
            if created:
                state = json.loads(command("docker", "inspect", NAME))[0]
                assert state["Config"]["Labels"].get("neural-labs.fixture") == "native-migration"
                if state["State"]["Running"]:
                    command("docker", "stop", "--timeout", "10", NAME)
                command("docker", "rm", NAME)
        finally:
            if loaded:
                # Re-read to preserve a legitimate concurrent on-disk policy update.
                original_file.write_text(DAEMON_PROFILE.read_text())
                command("apparmor_parser", "--replace", "--skip-cache", str(original_file))
