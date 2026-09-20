#!/usr/bin/env python3
"""Host-only reviewed-release worker. No Docker authority crosses into a tenant."""
import argparse
import asyncio
import contextlib
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading
import time
import urllib.request
import uuid
from zoneinfo import ZoneInfo

REPOSITORY = "Alshival-Ai/neural-labs"
WORKFLOW = REPOSITORY + "/.github/workflows/workspace-release.yml"
IMAGE = r"ghcr\.io/alshival-ai/neural-labs-workspace@sha256:[a-f0-9]{64}"
TERMINAL = {"succeeded", "restored", "failed", "recovery_required", "cancelled"}
MOUNTS = ["/home/node", "/home/node/.openclaw", "/home/node/.config/openclaw"]


class UpdateFailure(Exception):
    """Only fixed, credential-free messages cross the control-plane boundary."""


def atomic(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(path.name + ".next")
    with open(temporary, "w", encoding="utf8", opener=lambda p, f: os.open(p, f, 0o600)) as out:
        json.dump(value, out)
        out.flush()
        os.fsync(out.fileno())
    os.replace(temporary, path)
    fd = os.open(path.parent, os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def read(path, default=None):
    try:
        return json.loads(Path(path).read_text())
    except FileNotFoundError:
        return default


def window_seconds(policy, now=None):
    """Real elapsed seconds left in this local window, including DST folds/gaps."""
    now = now or dt.datetime.now(dt.timezone.utc)
    zone = ZoneInfo(policy["timezone"])
    def inside(moment):
        local = moment.astimezone(zone)
        return (local.weekday() + 1) % 7 in policy["days"] and policy["start"] <= local.strftime("%H:%M") < policy["end"]
    if not inside(now):
        return 0
    # Walk real instants, not ambiguous local datetime arithmetic.
    for seconds in range(60, 27 * 3600, 60):
        if not inside(now + dt.timedelta(seconds=seconds)):
            return max(0, seconds - 60)
    return 0


def validate_manifest(value):
    required = {"schema", "id", "image", "sourceRevision", "openclawVersion", "codexVersion", "appServerVersion",
                "upstreamImage", "upstreamRevision", "packages", "supportedOrigins", "protocol", "platform",
                "manualRequired", "reason", "notesUrl", "controlPlaneRevision", "hostRevision"}
    if not isinstance(value, dict) or set(value) != required or value["schema"] != 1 or value["protocol"] != 1:
        raise UpdateFailure("Unsupported release manifest")
    checks = [("id", r"workspace-v[0-9][A-Za-z0-9.-]{0,79}"), ("image", IMAGE),
              ("sourceRevision", r"[a-f0-9]{40}"), ("upstreamRevision", r"[a-f0-9]{40}"),
              ("controlPlaneRevision", r"[a-f0-9]{64}"), ("hostRevision", r"[a-f0-9]{64}"),
              ("upstreamImage", r"ghcr\.io/openclaw/openclaw:[0-9.]+@sha256:[a-f0-9]{64}")]
    checks += [(key, r"\d+\.\d+\.\d+") for key in ["openclawVersion", "codexVersion", "appServerVersion"]]
    if any(not isinstance(value[key], str) or not re.fullmatch(pattern, value[key]) for key, pattern in checks):
        raise UpdateFailure("Invalid release identity")
    if value["notesUrl"] != f'https://github.com/{REPOSITORY}/releases/tag/{value["id"]}':
        raise UpdateFailure("Invalid release notes location")
    if (type(value["manualRequired"]) is not bool or not isinstance(value["reason"], str) or len(value["reason"]) > 300
            or value["platform"] != "linux/amd64" or not isinstance(value["supportedOrigins"], list)
            or not 1 <= len(value["supportedOrigins"]) <= 20
            or any(not isinstance(v, str) or not re.fullmatch(r"\d+\.\d+\.\d+", v) for v in value["supportedOrigins"])
            or value["packages"] != {p: value["openclawVersion"] for p in ["@openclaw/gateway-client", "@openclaw/gateway-protocol", "@openclaw/sms"]}):
        raise UpdateFailure("Invalid release compatibility declaration")
    return value


def summary(manifest):
    return {key: manifest[key] for key in ["id", "image", "sourceRevision", "openclawVersion", "codexVersion",
                                           "appServerVersion", "notesUrl", "manualRequired", "reason"]}


def run(args, timeout=120, output=None, input_file=None):
    try:
        result = subprocess.run(args, check=True, stdin=input_file, stdout=output or subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
        return result.stdout.decode() if result.stdout else ""
    except (subprocess.SubprocessError, OSError):
        # Never expose stderr, argv, env, or private paths in browser logs.
        raise UpdateFailure("Host operation failed; protected recovery state was retained") from None


class Api:
    def __init__(self, origin, token):
        if not re.fullmatch(r"http://127\.0\.0\.1:\d+", origin) or len(token) < 32:
            raise UpdateFailure("Invalid local update service configuration")
        self.origin, self.token = origin, token

    def call(self, path, body=None):
        request = urllib.request.Request(self.origin + path, data=None if body is None else json.dumps(body).encode(),
            headers={"Authorization": "Bearer " + self.token, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.load(response)
        except Exception:
            raise UpdateFailure("Local update service is unavailable") from None


class Host:
    def __init__(self, config):
        self.config = config
        self.root = Path(config["stateDirectory"])
        self.api = Api(config["controlPlane"], config["workerToken"])
        self.workspace = Api(config["workspace"], config["workspaceToken"])
        self.update_deadline = None

    def operation_timeout(self, maximum):
        if self.update_deadline is None:
            return maximum
        remaining = self.update_deadline - time.monotonic() - (2 * self.config["readinessSeconds"] + 180)
        if remaining <= 0:
            raise UpdateFailure("Maintenance budget exhausted; preserving time for recovery")
        return min(maximum, remaining)

    def compose(self, *args):
        return run(["docker", "compose", "--project-name", self.config["project"], "-f", str(self.root / "base-compose.json"),
                    "-f", str(self.root / "active-compose.yaml"), *args], timeout=self.operation_timeout(600))

    def installed(self):
        containers = self.compose("ps", "--all", "--quiet", "workspace").split()
        if len(containers) != 1:
            raise UpdateFailure("Expected one managed workspace")
        c = json.loads(run(["docker", "inspect", containers[0]]))[0]
        volumes = {m["Destination"]: m["Name"] for m in c["Mounts"] if m["Type"] == "volume"}
        if set(volumes) != set(MOUNTS) or len(set(volumes.values())) != 3:
            raise UpdateFailure("Workspace volume layout needs manual review")
        env = dict(item.split("=", 1) for item in c["Config"]["Env"] if "=" in item)
        return {"image": c["Image"], "volumes": volumes, "openclawVersion": env["NEURAL_LABS_OPENCLAW_VERSION"],
                "codexVersion": env["NEURAL_LABS_CODEX_VERSION"], "container": containers[0]}

    def overlay(self, deployment, probation):
        # Only image, known version variables, three named volumes, and loopback
        # backend ports change. Compose isolation comes from the operator snapshot.
        data = {"image": deployment["image"], "environment": {
            "NEURAL_LABS_OPENCLAW_VERSION": deployment["openclawVersion"],
            "NEURAL_LABS_CODEX_VERSION": deployment["codexVersion"],
            "NEURAL_LABS_UPDATE_PROBATION": "true" if probation else "false"}}
        text = "services:\n  workspace:\n"
        for key, value in data.items():
            text += "    " + key + ": " + json.dumps(value) + "\n"
        text += '    ports: !override ["127.0.0.1:4182:18789", "127.0.0.1:4183:18790"]\n'
        text += "    volumes: !override\n"
        for i, target in enumerate(MOUNTS):
            text += f"      - type: volume\n        source: updater_volume_{i}\n        target: {target}\n"
        text += "volumes:\n"
        for i, target in enumerate(MOUNTS):
            text += f"  updater_volume_{i}:\n    external: true\n    name: {json.dumps(deployment['volumes'][target])}\n"
        filename = self.root / "active-compose.yaml"
        with open(str(filename) + ".next", "w", opener=lambda p, f: os.open(p, f, 0o600)) as out:
            out.write(text); out.flush(); os.fsync(out.fileno())
        os.replace(str(filename) + ".next", filename)

    def gate(self, closed):
        nonce = str(uuid.uuid4())
        atomic(self.root / "gate.json", {"closed": closed, "nonce": nonce})
        for _ in range(100):
            if read(self.root / "gate-ack.json", {}).get("nonce") == nonce:
                return
            time.sleep(.1)
        raise UpdateFailure("Ingress maintenance gate did not acknowledge")

    def discover(self):
        releases = json.loads(run(["gh", "api", f"repos/{REPOSITORY}/releases?per_page=100"]))
        release = next((r for r in releases if not r["draft"] and not r["prerelease"]
                        and re.fullmatch(r"workspace-v[0-9][A-Za-z0-9.-]{0,79}", r["tag_name"])), None)
        if not release:
            return None
        tag = release["tag_name"]
        directory = self.root / "releases" / tag
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        run(["gh", "release", "download", tag, "--repo", REPOSITORY, "--pattern", "workspace-release.json", "--dir", str(directory), "--clobber"])
        filename = directory / "workspace-release.json"
        if filename.stat().st_size > 32768:
            raise UpdateFailure("Release manifest is too large")
        m = validate_manifest(read(filename))
        if m["id"] != tag:
            raise UpdateFailure("Release tag mismatch")
        verification = ["--repo", REPOSITORY, "--signer-workflow", WORKFLOW, "--source-ref", "refs/tags/" + tag,
                        "--source-digest", m["sourceRevision"], "--deny-self-hosted-runners"]
        run(["gh", "attestation", "verify", str(filename), *verification])
        run(["gh", "attestation", "verify", "oci://" + m["image"], *verification])
        installed = self.installed()
        if (m["controlPlaneRevision"] != self.config["controlPlaneRevision"] or m["hostRevision"] != self.config["hostRevision"]
                or installed["openclawVersion"] not in m["supportedOrigins"]):
            m = {**m, "manualRequired": True, "reason": "This release requires an operator update of the host, control plane, or migration baseline."}
        return m

    def prepare(self, manifest):
        docker_root = run(["docker", "info", "--format", "{{.DockerRootDir}}"] ).strip()
        if min(shutil.disk_usage(self.root).free, shutil.disk_usage(docker_root).free) < self.config["reserveBytes"] + 5 * 1024 ** 3:
            raise UpdateFailure("Insufficient storage to stage the reviewed image")
        run(["docker", "pull", manifest["image"]], timeout=1800)
        # Budget is conservative and operator-configured from a measured rehearsal.
        volumes = self.installed()["volumes"]
        sizes = []
        for name in volumes.values():
            size = run(["docker", "run", "--rm", "--network=none", "--read-only", "--cap-drop=ALL", "--cap-add=DAC_OVERRIDE",
                "--user=0", "--entrypoint=du", "--mount", f"type=volume,src={name},dst=/source,readonly", manifest["image"], "-sb", "/source"])
            sizes.append(int(size.split()[0]))
        required = sum(sizes) * 3 + self.config["reserveBytes"]
        docker_root = run(["docker", "info", "--format", "{{.DockerRootDir}}"] ).strip()
        if min(shutil.disk_usage(self.root).free, shutil.disk_usage(docker_root).free) < required:
            raise UpdateFailure("Insufficient storage for retained backups and cloned volumes")

    def activity(self):
        workspace = self.workspace.call("/internal/updates/activity")
        cp = self.api.call("/internal/updates/worker")
        if workspace.get("eligible") is False:
            raise UpdateFailure("Workspace channel configuration requires an operator update")
        return workspace.get("protocol") == 1 and workspace.get("idle") is True and all(cp.get(k) == 0 for k in ["teamRuns", "activeRequests", "notificationSends"])

    def pause(self):
        return self.workspace.call("/internal/updates/pause", {})

    def resume(self):
        return self.workspace.call("/internal/updates/resume", {})

    def stop(self):
        self.compose("stop", "--timeout", "30", "workspace")

    def launch(self, deployment, probation):
        self.overlay(deployment, probation)
        self.compose("up", "--detach", "--no-build", "--no-deps", "--force-recreate", "workspace")

    def clone(self, job, old, candidate):
        directory = self.root / "backups" / job
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        atomic(directory / "deployment.json", old)
        # DB is for operator disaster recovery only. Automatic recovery never
        # restores it because the control plane continues accepting settings.
        with open(directory / "control-plane.dump", "wb", opener=lambda p, f: os.open(p, f, 0o600)) as out:
            run(["docker", "compose", "--project-name", self.config["project"], "-f", str(self.root / "base-compose.json"),
                 "exec", "-T", "postgres", "pg_dump", "-U", "neural_labs", "-d", "neural_labs", "-Fc"], timeout=600, output=out)
        def copy(args, output=None, input_file=None):
            name = "neural-update-copy-" + uuid.uuid4().hex
            try:
                run(["docker", "run", "--name", name, *args], timeout=self.operation_timeout(1800), output=output, input_file=input_file)
            finally:
                with contextlib.suppress(UpdateFailure):
                    run(["docker", "rm", "--force", name], timeout=30)
        for i, target in enumerate(MOUNTS):
            archive = f"volume-{i}.tar"
            common = ["--rm", "--network=none", "--read-only", "--cap-drop=ALL", "--cap-add=DAC_OVERRIDE", "--cap-add=CHOWN", "--cap-add=FOWNER", "--user=0", "--entrypoint=tar"]
            with open(directory / archive, "wb", opener=lambda p, f: os.open(p, f, 0o600)) as out:
                copy([*common, "--mount", f"type=volume,src={old['volumes'][target]},dst=/source,readonly",
                      old["image"], "--numeric-owner", "--acls", "--xattrs", "-C", "/source", "-cpf", "-", "."], output=out)
            # A unique name is journaled before creation. Never reuse a partial
            # clone after interruption; recovery returns to the original volumes.
            run(["docker", "volume", "create", "--label", f"neural-labs.update={job}", candidate["volumes"][target]])
            with open(directory / archive, "rb") as source:
                copy([*common, "--interactive", "--mount", f"type=volume,src={candidate['volumes'][target]},dst=/target",
                      old["image"], "--numeric-owner", "--acls", "--xattrs", "-C", "/target", "-xpf", "-"], input_file=source)

    def verify(self, deployment, probation):
        deadline = time.monotonic() + self.operation_timeout(self.config["readinessSeconds"])
        while time.monotonic() < deadline:
            try:
                actual = self.installed()
                status = self.workspace.call("/internal/updates/activity")
                if actual["volumes"] != deployment["volumes"] or actual["openclawVersion"] != deployment["openclawVersion"]:
                    raise UpdateFailure("Workspace deployment identity mismatch")
                image_id = run(["docker", "image", "inspect", "--format", "{{.Id}}", deployment["image"]]).strip()
                if actual["image"] != image_id or status.get("probation") != probation or not status.get("idle"):
                    raise UpdateFailure("Candidate is not ready and idle")
                health = json.loads(run(["docker", "inspect", actual["container"]]))[0]["State"].get("Health", {}).get("Status")
                if health != "healthy":
                    raise UpdateFailure("Candidate health checks have not passed")
                run(["docker", "exec", actual["container"], "node", "/usr/local/lib/neural-labs/update-probe.mjs"], timeout=120)
                return
            except UpdateFailure:
                time.sleep(5)
        raise UpdateFailure("Workspace readiness or migration verification failed")


class Worker:
    def __init__(self, host):
        self.host = host
        self.journal = host.root / "journal.json"

    def save(self, state):
        atomic(self.journal, state)

    def phase(self, state, phase, message):
        # Write intent before external effects. Replaying a same-phase report is
        # accepted; an unavailable control plane prevents further mutation.
        state["phase"] = phase
        self.save(state)
        self.host.api.call("/internal/updates/worker", {"job": {"id": state["id"], "phase": phase, "message": message}})

    def finish(self, state, phase, message):
        self.phase(state, phase, message)
        if phase in {"succeeded", "restored"} and state.get("old"):
            self.host.gate(False)
        state["done"] = True
        self.save(state)

    def recover(self, state):
        self.host.update_deadline = None
        self.host.gate(True)
        if state["phase"] == "activating":
            self.phase(state, "recovery_required", "Activation was interrupted after the deployment decision. The selected volumes are preserved for operator recovery.")
            with contextlib.suppress(Exception):
                self.host.pause()
            state["done"] = True
            self.save(state)
            return
        if state.get("committed"):
            # Never roll back once the candidate could have accepted writes.
            self.host.launch(state["candidate"], False)
            self.host.verify(state["candidate"], False)
            self.phase(state, "activating", "Resuming the verified workspace.")
            self.host.resume()
            self.finish(state, "succeeded", "Reviewed release installed and verified.")
            return
        self.phase(state, "restoring", "Restoring the previous image and original volumes.")
        self.host.stop()
        self.host.launch(state["old"], True)
        self.host.verify(state["old"], True)
        # The restore decision is durable before enabling native channels/jobs.
        state["restoreVerified"] = True
        self.save(state)
        self.host.launch(state["old"], False)
        self.host.verify(state["old"], False)
        self.phase(state, "activating", "Resuming the restored workspace.")
        self.host.resume()
        self.finish(state, "restored", "Update failed; the previous workspace has been restored.")

    def execute(self, job, manifest, policy):
        state = {"id": job["id"], "phase": job["phase"], "done": False, "committed": False}
        self.save(state)
        if job["kind"] == "check":
            self.phase(state, "checking", "Checking reviewed Neural Labs releases.")
            self.host.api.call("/internal/updates/worker", {"available": summary(manifest) if manifest else None})
            self.finish(state, "succeeded", "Release check complete.")
            return
        if not manifest or manifest["manualRequired"] or manifest["id"] != job["release_id"]:
            self.finish(state, "failed", "The requested release is unavailable or requires an operator update.")
            return
        if job["phase"] in {"queued", "preparing"}:
            self.phase(state, "preparing", "Verifying the image, storage, and recovery budget.")
        self.host.prepare(manifest)
        self.phase(state, "ready", "Waiting for an idle workspace and the configured maintenance window.")
        while True:
            live = self.host.api.call("/internal/updates/worker")
            policy = live["policy"]
            if job["kind"] == "automatic" and not policy["openclawAutomatic"]:
                self.finish(state, "cancelled", "Automatic updates were disabled before maintenance.")
                return
            allowed = job["kind"] != "automatic" or window_seconds(policy) >= self.host.config["budgetSeconds"]
            if allowed and self.host.activity():
                break
            self.phase(state, "deferred", "Deferred until the workspace is idle and enough maintenance time remains.")
            time.sleep(30)
        state["old"] = self.host.installed()
        state["candidate"] = {"image": manifest["image"], "openclawVersion": manifest["openclawVersion"], "codexVersion": manifest["codexVersion"],
                              "volumes": {target: f"{self.host.config['project']}_update_{job['id'].replace('-', '')}_{i}" for i, target in enumerate(MOUNTS)}}
        self.host.update_deadline = time.monotonic() + self.host.config["budgetSeconds"]
        self.phase(state, "maintenance", "Workspace maintenance is starting.")
        self.host.gate(True)
        self.host.pause()
        # Recheck after every ingress and scheduler is gated. Never kill a job
        # that raced with the initial idle sample.
        if not self.host.activity():
            self.host.resume()
            self.phase(state, "deferred", "Work started before maintenance; the update was deferred.")
            self.host.gate(False)
            self.host.update_deadline = None
            state["done"] = True
            self.save(state)
            return
        self.phase(state, "updating", "Backing up original state and starting the candidate on cloned volumes.")
        self.host.stop()
        self.host.clone(job["id"], state["old"], state["candidate"])
        self.host.launch(state["candidate"], True)
        self.phase(state, "verifying", "Verifying the candidate with outbound work disabled.")
        self.host.verify(state["candidate"], True)
        state["committed"] = True
        self.host.update_deadline = None
        self.phase(state, "committing", "Activating the verified release.")
        self.host.launch(state["candidate"], False)
        self.host.verify(state["candidate"], False)
        self.phase(state, "activating", "Resuming the verified workspace.")
        self.host.resume()
        self.finish(state, "succeeded", "Reviewed release installed and verified.")

    def tick(self):
        state = read(self.journal)
        if state and not state.get("done"):
            self.host.api.call("/internal/updates/worker", {"job": {"id": state["id"], "phase": state["phase"], "message": "Resuming interrupted update reconciliation."}})
            if state["phase"] in TERMINAL:
                if state.get("old") and state["phase"] in {"succeeded", "restored"}:
                    self.host.gate(False)
                state["done"] = True
                self.save(state)
                return
            if state.get("old") and state["phase"] in {"maintenance", "updating", "verifying", "committing", "activating", "restoring"}:
                self.recover(state)
                return
        live = self.host.api.call("/internal/updates/worker")
        if live["maintenance"]:
            self.host.gate(True)
            raise UpdateFailure("Operator recovery is required before reopening the workspace")
        # Discovery is daily; explicit jobs always fetch and verify fresh.
        checked = read(self.host.root / "last-release-check.json", {})
        if live["job"] and (not state or state.get("done") or state["id"] != live["job"]["id"]):
            self.save({"id": live["job"]["id"], "phase": live["job"]["phase"], "done": False, "committed": False})
        if live["job"] or time.time() - checked.get("time", 0) >= 86400:
            manifest = self.host.discover()
            atomic(self.host.root / "release.json", manifest)
            atomic(self.host.root / "last-release-check.json", {"time": time.time()})
            self.host.api.call("/internal/updates/worker", {"available": summary(manifest) if manifest else None})
        else:
            manifest = read(self.host.root / "release.json")
        if live["job"]:
            self.execute(live["job"], manifest, live["policy"])
        elif (manifest and not manifest["manualRequired"] and live["policy"]["openclawAutomatic"]
                and window_seconds(live["policy"]) >= self.host.config["budgetSeconds"]):
            if not any(j["release_id"] == manifest["id"] and j["kind"] != "check" and j["phase"] in TERMINAL - {"cancelled"} for j in live["jobs"]):
                self.host.api.call("/internal/updates/automatic", {})

    def failure(self, error=None):
        state = read(self.journal)
        if state and not state.get("done"):
            try:
                if state["phase"] == "maintenance":
                    live = self.host.api.call("/internal/updates/worker")
                    if live.get("job") and live["job"]["id"] == state["id"] and live["job"]["phase"] in {"ready", "deferred"}:
                        # The control plane refused admission (for example an
                        # administrator disabled automatic updates). No host
                        # maintenance effect can precede that admission.
                        state.pop("old", None)
                        state["phase"] = live["job"]["phase"]
                        self.host.update_deadline = None
                        self.finish(state, "cancelled", "Maintenance admission was declined; the current workspace is unchanged.")
                        return
                self.host.api.call("/internal/updates/worker", {"job": {"id": state["id"], "phase": state["phase"], "message": "Reconciling update failure."}})
                if state["phase"] in TERMINAL:
                    return
                if state.get("old") and state["phase"] in {"maintenance", "updating", "verifying", "committing", "activating", "restoring"}:
                    self.recover(state)
                else:
                    self.finish(state, "failed", str(error)[:300] if isinstance(error, UpdateFailure) else "Update preparation failed; the current workspace is unchanged.")
            except Exception:
                self.host.gate(True)
                self.finish(state, "recovery_required", "Automatic recovery could not be verified. The workspace remains closed for operator recovery.")
        self.host.api.call("/internal/updates/worker", {"error": "Update operation failed; review update history."})


async def proxy(root, bindings=((4180, 4182), (4181, 4183))):
    """Loopback TCP forwarder preserves the host's existing trusted-proxy hop."""
    sockets = set()
    connections = set()
    current = {"closed": True}
    async def connection(reader, writer, port):
        task = asyncio.current_task()
        connections.add(task)
        sockets.add(writer)
        upstream = None
        try:
            if current["closed"]:
                writer.write(b"HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nRetry-After: 30\r\nContent-Length: 36\r\n\r\nWorkspace maintenance is in progress.")
                await writer.drain()
                return
            remote, upstream = await asyncio.open_connection("127.0.0.1", port)
            sockets.add(upstream)
            if current["closed"]:
                return
            async def pipe(source, destination):
                while data := await source.read(65536):
                    destination.write(data)
                    await destination.drain()
                destination.close()
            await asyncio.gather(pipe(reader, upstream), pipe(remote, writer))
        except (ConnectionError, OSError, asyncio.CancelledError):
            pass
        finally:
            connections.discard(task)
            for stream in [writer, upstream]:
                if stream:
                    sockets.discard(stream)
                    stream.close()
    servers = [await asyncio.start_server(lambda r, w, p=target: connection(r, w, p), "127.0.0.1", port) for port, target in bindings]
    try:
        while True:
            try:
                state = read(root / "gate.json", {"closed": True})
                if type(state.get("closed")) is not bool:
                    raise ValueError()
            except Exception:
                state = {"closed": True}
            current.update(state)
            if current["closed"]:
                for stream in list(sockets):
                    stream.transport.abort()
                pending = list(connections)
                for task in pending:
                    task.cancel()
                if pending:
                    await asyncio.gather(*pending, return_exceptions=True)
            if state.get("nonce") != read(root / "gate-ack.json", {}).get("nonce"):
                atomic(root / "gate-ack.json", state)
            await asyncio.sleep(.05)
    finally:
        for server in servers:
            server.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["worker", "proxy"])
    parser.add_argument("--config", default="/etc/neural-labs/updater.json")
    args = parser.parse_args()
    os.umask(0o077)
    config = read(args.config)
    host = Host(config)
    if args.mode == "proxy":
        asyncio.run(proxy(host.root))
        return
    with open(host.root / "worker.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        worker = Worker(host)
        def heartbeat():
            while True:
                try:
                    installed = host.installed()
                    host.api.call("/internal/updates/worker", {"installed": {k: installed[k] for k in ["image", "openclawVersion", "codexVersion"]}})
                except Exception:
                    pass
                time.sleep(30)
        threading.Thread(target=heartbeat, daemon=True).start()
        while True:
            try:
                worker.tick()
            except Exception as error:
                with contextlib.suppress(Exception):
                    worker.failure(error)
            time.sleep(30)


if __name__ == "__main__":
    main()
