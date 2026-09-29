#!/usr/bin/env python3
"""Explicit host preparation and policy refresh. Never run by validation/startup."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
from snap_policy import with_native_management

INSTALL = Path('/opt/neural-labs-security')
STATE = Path('/var/lib/neural-labs-security')
PROFILE = Path('/etc/apparmor.d/neural-labs-native-v1')
SECCOMP = Path('/etc/neural-labs-security/native-seccomp.json')
SNAP = Path('/var/lib/snapd/apparmor/profiles/snap.docker.dockerd')
KERNEL = Path('/sys/kernel/security/apparmor/policy/profiles')


def digest(value):
    return hashlib.sha256(value).hexdigest()


def command(*args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=60)


def write(path, content, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        os.fchmod(stream.fileno(), mode)
        stream.write(content); stream.flush(); os.fsync(stream.fileno())
    try:
        os.replace(temporary, path)
        fd = os.open(path.parent, os.O_DIRECTORY)
        try: os.fsync(fd)
        finally: os.close(fd)
    finally:
        temporary.unlink(missing_ok=True)


def loaded_profile(name):
    matches = []
    for item in KERNEL.iterdir():
        if item.name.startswith(name + '.') and (item / 'name').read_text().strip() == name:
            matches.append({'mode': (item / 'mode').read_text().strip(), 'hash': (item / 'sha256').read_text().strip()})
    if len(matches) != 1 or matches[0]['mode'] != 'enforce' or not matches[0]['hash']:
        return None
    return matches[0]


def record():
    path = STATE / 'loaded.json'
    return json.loads(path.read_text()) if path.exists() else {}


def reconcile(check=False):
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    with open(STATE / 'lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        prior = record()
        files = [(PROFILE, 'neural-labs-native-v1', lambda source: source)]
        if SNAP.exists(): files.append((SNAP, 'snap.docker.dockerd', with_native_management))
        result = {}
        for filename, name, transform in files:
            original = filename.read_bytes()
            candidate = transform(original.decode()).encode()
            identity = {'source': digest(original), 'candidate': digest(candidate)}
            loaded = loaded_profile(name)
            if loaded and prior.get(name) == {**identity, 'kernel': loaded}:
                result[name] = prior[name]; continue
            if check:
                raise RuntimeError('Native host policy needs reconciliation')
            # Keep every encountered original. Snap owns its generated file;
            # apply the additional management rules only to kernel policy.
            backup = STATE / 'originals' / f'{name}-{identity["source"]}'
            if not backup.exists(): write(backup, original)
            with tempfile.TemporaryDirectory(prefix='policy-', dir=STATE) as directory:
                staged = Path(directory) / name
                staged.write_bytes(candidate)
                command('apparmor_parser', '--skip-kernel-load', '--skip-cache', str(staged))
                if filename.read_bytes() != original:
                    raise RuntimeError('Policy changed during validation; retry reconciliation')
                command('apparmor_parser', '--replace', '--skip-cache', str(staged))
            loaded = loaded_profile(name)
            if not loaded or filename.read_bytes() != original:
                raise RuntimeError('Loaded policy could not be verified; retry reconciliation')
            result[name] = {**identity, 'kernel': loaded}
        if not check: write(STATE / 'loaded.json', (json.dumps(result, indent=2) + '\n').encode())
        return result


def install(source):
    # Root-controlled installed files are the only sources for subsequent
    # systemd runs. No daemon restart or generated Snap file edit is needed.
    source = source.resolve()
    command('apparmor_parser', '--skip-kernel-load', '--skip-cache', str(source / 'neural-labs-native.apparmor'))
    json.loads((source / 'native-seccomp.json').read_text())
    if SNAP.exists(): with_native_management(SNAP.read_text())
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not SECCOMP.parent.exists():
        SECCOMP.parent.mkdir(mode=0o755)
        SECCOMP.parent.chmod(0o755)
    targets = {PROFILE: source / 'neural-labs-native.apparmor', SECCOMP: source / 'native-seccomp.json'}
    targets.update({INSTALL / name: source / name for name in ['install.py', 'snap_policy.py']})
    for name in ['neural-labs-security.service', 'neural-labs-security.path', 'neural-labs-security.timer']:
        targets[Path('/etc/systemd/system') / name] = source / name
    for target, origin in targets.items():
        content = origin.read_bytes()
        if target.exists() and target.read_bytes() != content:
            old = target.read_bytes()
            write(STATE / 'originals' / f'{target.name}-{digest(old)}', old)
        write(target, content, 0o644)
    reconcile()
    command('systemctl', 'daemon-reload')
    command('systemctl', 'enable', '--now', 'neural-labs-security.service', 'neural-labs-security.path', 'neural-labs-security.timer')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['install', 'reconcile', 'check'])
    args = parser.parse_args()
    if os.geteuid() != 0: parser.error('Run this explicit host operation as root')
    os.umask(0o077)
    try:
        if args.mode == 'install': install(Path(__file__).parent)
        else: reconcile(check=args.mode == 'check')
        print('Native AppArmor policy verified; Docker and retained workspace volumes were not restarted or changed.')
    except Exception:
        raise SystemExit('Native host policy preparation failed. Review the protected policy state and service journal before activation.')
