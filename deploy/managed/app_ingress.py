#!/usr/bin/env python3
"""Upgrade an existing managed instance's root-owned private app ingress."""

import argparse
import json
import os
from pathlib import Path
import stat
import subprocess

from render import ingress


def owned_file(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
        raise ValueError("Managed ingress file must be root-owned and not group writable")


def update(descriptor_path, *, apply=False, etc=Path("/etc/nginx")):
    if os.geteuid() != 0:
        raise ValueError("Run on the destination as root")
    owned_file(descriptor_path)
    descriptor = json.loads(descriptor_path.read_text())
    runtime, hostname, port = (descriptor[key] for key in ("runtime", "hostname", "port"))
    target = etc / "conf.d" / ("neura-labs-" + runtime + ".conf")
    source = descriptor_path.parent / "ingress.conf"
    owned_file(source)
    owned_file(target)
    previous = source.read_text()
    if target.read_text() != previous:
        raise ValueError("Live ingress differs from the registered descriptor")
    desired = ingress(hostname, runtime, port)
    start = desired.index("    location ^~ /__alshival_app/ {")
    end = desired.index("    location = /healthz {", start)
    original = desired[:start] + desired[end:]
    if previous.rstrip("\n") not in {original.rstrip("\n"), desired.rstrip("\n")}:
        raise ValueError("Ingress differs from the reviewed managed template")
    if not apply or previous.rstrip("\n") == desired.rstrip("\n"):
        return "Already current" if previous.rstrip("\n") == desired.rstrip("\n") else "Reviewed app ingress upgrade is ready"
    source.write_text(desired)
    target.write_text(desired)
    try:
        subprocess.run(["nginx", "-t"], check=True, capture_output=True)
        subprocess.run(["systemctl", "reload", "nginx"], check=True, capture_output=True)
    except BaseException:
        source.write_text(previous)
        target.write_text(previous)
        subprocess.run(["nginx", "-t"], check=True, capture_output=True)
        subprocess.run(["systemctl", "reload", "nginx"], check=True, capture_output=True)
        raise
    return "Private app ingress installed; workspace image acceptance is separate"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("descriptor", type=Path)
    parser.add_argument("--apply", action="store_true")
    arguments = parser.parse_args()
    print(update(arguments.descriptor, apply=arguments.apply))
