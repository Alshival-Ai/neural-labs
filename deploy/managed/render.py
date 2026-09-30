#!/usr/bin/env python3
"""Render an operator-owned managed deployment; never invokes Docker or edits a host.

Input is a private JSON registration, not a request from a tenant. Images must
already have passed acceptance and be present on the destination host.
"""
import argparse
import ipaddress
import json
import os
from pathlib import Path
import re
import uuid


def build(registration, destination):
    cfg = registration
    runtime, workspace, instance = (str(uuid.UUID(cfg[key])) for key in ("runtime", "workspace", "instance"))
    hostname = cfg["hostname"]
    # This is private operator input. Portal admission separately owns which
    # workspace may use an origin, including a portal's own team desktop.
    if (len(hostname) > 253 or not re.fullmatch(
            r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}", hostname)):
        raise ValueError("Invalid managed hostname")
    if not re.fullmatch(r"[a-f0-9]{40}", cfg["release"]):
        raise ValueError("Pin the Neural Labs source commit")
    images = cfg["images"]
    if set(images) != {"postgres", "control-plane", "workspace"} or any(
        not re.fullmatch(r"[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}", image) for image in images.values()
    ):
        raise ValueError("Every service requires an immutable image digest")
    root = Path(cfg["storage_root"])
    if not root.is_absolute() or ".." in root.parts or str(root) == "/" or re.search(r"[:$\x00-\x1f]", str(root)):
        raise ValueError("Invalid bounded storage root")
    documents = cfg.get("documents_name", "documents")
    if documents not in {"documents", "workspace"}:
        raise ValueError("Invalid document storage binding")
    slot, port, memory, cpu = (cfg[key] for key in ("slot", "port", "memory_mb", "cpu"))
    if any(type(value) is not int for value in (slot, port, memory, cpu)) or not 0 <= slot < 4096 or not 1024 <= port <= 65532 or memory < 4096 or cpu < 2:
        raise ValueError("Invalid stack capacity or port reservation")
    network = ipaddress.ip_network(cfg["subnet"], strict=True)
    if network.version != 4 or network.prefixlen != 28 or not any(network.subnet_of(ipaddress.ip_network(block)) for block in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")):
        raise ValueError("Reserve a private /28 network per stack")
    if not re.fullmatch(r"[A-Za-z0-9_-]{43,256}", cfg["portal_secret"]):
        raise ValueError("Invalid instance secret")
    # Reuse secrets on re-render; callers must persist the original registration.
    for key in ("database_password", "control_token", "mcp_token"):
        if not isinstance(cfg.get(key), str) or not re.fullmatch(r"[A-Za-z0-9_-]{43,256}", cfg[key]):
            raise ValueError(f"Missing persistent {key}")
    if not re.fullmatch(r"[a-fA-F0-9]{64}", cfg.get("master_key", "")):
        raise ValueError("Master key must be 32 random bytes encoded as hexadecimal")
    database_name = cfg.get("database_name", "neural_labs")
    if database_name != "neural_labs" and not re.fullmatch(r"neural_labs_native_[a-f0-9]{20}", database_name):
        raise ValueError("Unrecognized managed database binding")
    public = "https://" + hostname
    release = json.loads((Path(__file__).resolve().parents[2] / "workspace/native/release.json").read_text())
    labels = {"ai.alshival.workspace": workspace, "ai.alshival.runtime": runtime, "ai.alshival.instance": instance}
    common = {"restart": "no", "labels": labels, "cap_drop": ["ALL"], "pids_limit": 256}
    health = lambda endpoint: {"test": ["CMD", "node", "-e", f"fetch('{endpoint}').then(r=>{{if(!r.ok)process.exit(1)}}).catch(()=>process.exit(1))"],
                              "interval": "10s", "timeout": "5s", "retries": 12, "start_period": "120s"}
    services = {
        "postgres": {"restart": "no", "labels": labels, "image": images["postgres"], "mem_limit": "512m", "cpus": .5,
            "pids_limit": 128, "environment": {"POSTGRES_DB": "neural_labs", "POSTGRES_USER": "neural_labs",
                "POSTGRES_PASSWORD": cfg["database_password"], "PGDATA": "/var/lib/postgresql/18/docker"},
            "volumes": [f"{root}/neural-labs/postgres:/var/lib/postgresql"], "networks": ["database"],
            "healthcheck": {"test": ["CMD-SHELL", "pg_isready -U neural_labs -d neural_labs"], "interval": "5s", "timeout": "5s", "retries": 20}},
        "control-plane": {**common, "image": images["control-plane"], "read_only": True, "tmpfs": ["/tmp:size=32m,mode=1777"],
            "mem_limit": "512m", "cpus": .5, "networks": ["database", "workspace"],
            "ports": [f"127.0.0.1:{port + 1}:4174"], "healthcheck": health("http://127.0.0.1:4174/readyz"),
            "depends_on": {"postgres": {"condition": "service_healthy"}},
            "environment": {"CONTROL_PLANE_HOST": "0.0.0.0", "CONTROL_PLANE_PORT": "4174", "CONTROL_PLANE_PUBLIC_ORIGIN": public,
                "NEURAL_LABS_AUTH_MODE": "alshival", "NEURAL_LABS_PORTAL_ORIGIN": "https://alshival.ai",
                "NEURAL_LABS_PORTAL_WORKSPACE": workspace, "NEURAL_LABS_PORTAL_INSTANCE": instance, "NEURAL_LABS_PORTAL_SECRET": cfg["portal_secret"],
                "PGHOST": "postgres", "PGPORT": "5432", "PGDATABASE": database_name, "PGUSER": "neural_labs", "PGPASSWORD": cfg["database_password"],
                "CONTROL_PLANE_MASTER_KEY": cfg["master_key"], "MCP_CONFIG_TOKEN": cfg["mcp_token"], "WORKSPACE_CONTROL_TOKEN": cfg["control_token"],
                "CONTROL_PLANE_WORKSPACE_STATUS_URL": "http://workspace:18790/status", "CONTROL_PLANE_WORKSPACE_CONTROL_URL": "http://workspace:18790/internal/provider-auth/openai",
                "CONTROL_PLANE_WORKSPACE_PERSONAL_AUTH_URL": "http://workspace:18790/internal/provider-auth/openai/users",
                "CONTROL_PLANE_WORKSPACE_TEAM_AGENT_URL": "http://workspace:18790/internal/neura/team-run",
                "CONTROL_PLANE_WORKSPACE_CLAUDE_VERSION": release["claude"], "CONTROL_PLANE_WORKSPACE_CODEX_VERSION": release["codex"]}},
        "workspace": {**common, "container_name": "neura-" + runtime, "image": images["workspace"], "mem_limit": f"{memory - 1024}m", "cpus": cpu - 1,
            "networks": ["workspace"], "ports": [f"127.0.0.1:{port + 3}:18790"],
            "cap_add": [], "read_only": True, "user": "1000:1000",
            "tmpfs": ["/tmp:size=1g,mode=1777", "/run/neural-labs:size=16m,mode=0700,uid=1000,gid=1000"],
            "shm_size": "256m", "security_opt": ["seccomp=/etc/neural-labs-security/native-seccomp.json",
                "apparmor=neural-labs-native-v1", "systempaths=unconfined"],
            "volumes": [f"{root}/neural-labs/home:/home/node", f"{root}/{documents}:/home/node/workspace",
                        f"{root}/{documents}:/workspace", f"{root}/state/ssh:/state/ssh:ro"],
            "healthcheck": {"test": ["CMD", "curl", "--fail", "--silent", "--max-time", "6", "http://127.0.0.1:18790/healthz"],
                            "interval": "15s", "timeout": "8s", "retries": 12, "start_period": "120s"},
            "environment": {"NEURAL_LABS_AUTH_MODE": "alshival", "NEURAL_LABS_PUBLIC_ORIGIN": public, "NEURAL_LABS_WORKSPACE_PROXY_IP": str(network.network_address + 1),
                "NEURAL_LABS_APP_DOMAIN": hostname, "NEURAL_LABS_APP_LOCAL_ENABLED": "false",
                "NEURAL_LABS_EMBED_ORIGINS": "https://alshival.ai",
                "NEURAL_LABS_WORKSPACE_CONTROL_TOKEN": cfg["control_token"],
                "NEURAL_LABS_RUNTIME_VERSION": release["version"], "NEURAL_LABS_CODEX_VERSION": release["codex"],
                "NEURAL_LABS_CLAUDE_VERSION": release["claude"],
                "NEURAL_LABS_WORKSPACE_STATUS_PORT": "18790", "NEURAL_LABS_PROJECTS_ROOT": "/home/node/workspace/projects",
                "NEURAL_LABS_TURN_CREDENTIAL_URL": "http://control-plane:4174/internal/turn-credentials",
                "NEURAL_LABS_TEAM_CHANNEL_ACCESS_URL": "http://control-plane:4174/internal/team-terminal/access",
                "NEURAL_LABS_NOTIFICATION_URL": "http://control-plane:4174/internal/notifications/send"}},
    }
    if cfg.get("turn"):
        services["control-plane"]["environment"].update({"CONTROL_PLANE_TURN_URLS": cfg["turn"]["urls"], "CONTROL_PLANE_TURN_SECRET": cfg["turn"]["secret"]})
    if cfg.get("sms_webhook_origin"):
        from urllib.parse import urlsplit
        callback = urlsplit(cfg["sms_webhook_origin"])
        if (callback.scheme != "https" or not callback.hostname or callback.username or callback.password
                or callback.path not in {"", "/"} or callback.query or callback.fragment):
            raise ValueError("Use an HTTPS SMS callback origin")
        services["control-plane"]["environment"]["CONTROL_PLANE_SMS_WEBHOOK_ORIGIN"] = cfg["sms_webhook_origin"]
    compose = {"services": services, "networks": {"database": {"internal": True}, "workspace": {
        "driver_opts": {"com.docker.network.bridge.name": "nl" + runtime.replace("-", "")[:10]},
        "ipam": {"config": [{"subnet": str(network), "gateway": str(network.network_address + 1)}]}}}}
    descriptor = {"runtime_kind": "native", "runtime_protocol": 1, "runtime": runtime, "workspace": workspace, "instance": instance, "slot": slot,
        "release": cfg["release"], "compose": str(destination / "compose.json"), "services": list(services),
        "hostname": hostname, "port": port, "storage_root": str(root), "documents_name": documents, "subnet": str(network), "cpu": cpu, "memory_mb": memory}
    return compose, descriptor, ingress(hostname, runtime, port)


def ingress(hostname, runtime, port):
    source = (Path(__file__).resolve().parents[1] / "nginx/neural-labs.ai.conf").read_text()
    # Reuse the reviewed upstream route and identity-header policy, excluding
    # public marketing and TLS (TLS terminates at the platform gateway).
    prefix = source[:source.index("server {\n    listen 80;")]
    server = source[source.index("server {\n    listen 443 ssl;", source.index("server_name www.neural-labs.ai;")):]
    text = prefix + server
    text = text.replace("    listen 443 ssl;", f"    listen 127.0.0.1:{port};")
    text = "\n".join(line for line in text.splitlines() if not any(value in line for value in
        ["listen [::]", "http2 on;", "ssl_certificate", "options-ssl-nginx", "ssl_dhparam"])) + "\n"
    text = text.replace("server_name neural-labs.ai;", f"server_name {hostname};")
    for old, new in [(4173, port + 1), (4174, port + 1), (4180, port + 2), (4181, port + 3)]:
        text = text.replace(f"127.0.0.1:{old};", f"127.0.0.1:{new};")
    text = text.replace("$neural_labs_connection_upgrade", "$nl_" + runtime.replace("-", "")[:12] + "_upgrade")
    text = text.replace("$scheme", "https")
    # Namespace upstreams only. Header variables such as
    # $upstream_http_x_neural_labs_user are part of the authentication protocol.
    for name in ("workspace_desktop", "control_plane", "workspace", "web"):
        text = text.replace("neural_labs_" + name, "nl_" + runtime.replace("-", "") + "_" + name)
    location = f'''    location = /internal/workspace/auth {{
        allow 127.0.0.1; deny all;
        proxy_pass http://127.0.0.1:{port + 1};
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
    }}
    location ^~ /__alshival_app/ {{
        allow 127.0.0.1; deny all;
        proxy_pass http://nl_{runtime.replace('-', '')}_workspace_desktop;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $nl_{runtime.replace('-', '')[:12]}_upgrade;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_read_timeout 3600s;
    }}
'''
    text = text.replace("    location = /healthz {", location + "    location = /healthz {")
    return text


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("registration", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    cfg = json.loads(args.registration.read_text())
    destination = args.destination.resolve()
    compose, descriptor, nginx = build(cfg, destination)
    if args.check:
        print("Managed registration validated; no files written.")
        return
    if destination.exists():
        raise SystemExit("Destination must be new; preserve previous descriptors and secrets.")
    destination.mkdir(parents=True, mode=0o700)
    for name, value in [("compose.json", json.dumps(compose, indent=2)), ("descriptor.json", json.dumps(descriptor, indent=2)), ("ingress.conf", nginx)]:
        path = destination / name
        with path.open("x") as output:
            os.chmod(path, 0o600)
            output.write(value + "\n")
    print("Managed deployment rendered; host installation and acceptance are still required.")


if __name__ == "__main__":
    main()
