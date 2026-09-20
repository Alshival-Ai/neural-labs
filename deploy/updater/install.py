#!/usr/bin/env python3
"""Explicit operator bootstrap. Never called from validation or image startup."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
from release import compatibility
from updater import Host, atomic, read, run, UpdateFailure

CONFIG = Path('/etc/neural-labs/updater.json')


def state_directory(docker_root):
    return Path('/var/snap/docker/common/neural-labs-updater' if docker_root.startswith('/var/snap/docker/common/')
                else '/var/lib/neural-labs/updater')


def compose_environment_value(value):
    # `compose config` serializes literal dollars as $$ for safe rereading.
    # Only decode values extracted for direct API use; keep the snapshot intact.
    return value.replace('$$', '$')


def prepare(repository):
    if CONFIG.exists():
        raise UpdateFailure('Updater is already prepared; review the existing deployment before replacing its configuration')
    root = state_directory(run(['docker', 'info', '--format', '{{.DockerRootDir}}']).strip())
    environment = repository / '.env'
    stat = environment.stat()
    lines = environment.read_text().splitlines()
    values = dict(line.split('=', 1) for line in lines if '=' in line and not line.startswith('#'))
    token = values.get('NEURAL_LABS_UPDATER_TOKEN', '').strip('"\'') or secrets.token_hex(32)
    if len(token) < 32:
        raise UpdateFailure('The configured updater token is too short')
    lines = [line for line in lines if not line.startswith('NEURAL_LABS_UPDATER_TOKEN=')]
    lines.append('NEURAL_LABS_UPDATER_TOKEN=' + token)
    temporary = environment.with_name('.env.updater-next')
    temporary.write_text('\n'.join(lines) + '\n')
    temporary.chmod(0o600)
    os.chown(temporary, stat.st_uid, stat.st_gid)
    os.replace(temporary, environment)
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    CONFIG.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    compose = ['docker', 'compose', '--env-file', str(environment), '-f', str(repository / 'deploy/compose/compose.yaml')]
    snapshot = json.loads(run([*compose, 'config', '--format', 'json']))
    workspace = snapshot['services']['workspace']
    if workspace.get('privileged') or workspace.get('network_mode') == 'host' or workspace.get('pid') == 'host' or workspace.get('ipc') == 'host':
        raise UpdateFailure('Unsupported workspace isolation configuration')
    if any(v['type'] != 'volume' for v in workspace['volumes']):
        raise UpdateFailure('Only the three documented workspace volumes are supported')
    atomic(root / 'base-compose.json', snapshot)
    (root / 'docker').mkdir(mode=0o700, exist_ok=True)
    config = {'stateDirectory': str(root), 'project': snapshot.get('name', 'neural-labs'),
              'controlPlane': 'http://127.0.0.1:4174', 'workspace': 'http://127.0.0.1:4183',
              'workerToken': token, 'workspaceToken': compose_environment_value(workspace['environment']['NEURAL_LABS_WORKSPACE_CONTROL_TOKEN']),
              'budgetSeconds': 3600, 'readinessSeconds': 300, 'reserveBytes': 10 * 1024 ** 3, **compatibility(repository)}
    atomic(CONFIG, config)
    destination = Path('/opt/neural-labs-updater')
    destination.mkdir(parents=True, exist_ok=True)
    for name in ['updater.py', 'release.py', 'install.py']:
        shutil.copyfile(repository / 'deploy/updater' / name, destination / name)
        (destination / name).chmod(0o644)
    for name in ['neural-labs-updater.service', 'neural-labs-update-proxy.service']:
        template = (repository / 'deploy/updater' / name).read_text()
        (Path('/etc/systemd/system') / name).write_text(template.replace('/var/lib/neural-labs/updater', str(root)))
    atomic(root / 'gate.json', {'closed': True})
    run(['systemctl', 'daemon-reload'])
    print('Prepared. Rebuild/deploy the control plane and workspace, then run the installed activate command during an idle period. Services are not enabled yet.')


def activate():
    config = read(CONFIG)
    root = Path(config['stateDirectory'])
    host = Host(config)
    with open(root / 'worker.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        base = ['docker', 'compose', '--project-name', config['project'], '-f', str(root / 'base-compose.json')]
        actual = run([*base, 'exec', '-T', 'control-plane', 'cat', '/app/compatibility']).strip()
        if actual != config['controlPlaneRevision']:
            raise UpdateFailure('Deploy the prepared control-plane revision before activating the updater')
        live = host.api.call('/internal/updates/worker')
        if live['job'] or live['maintenance']:
            raise UpdateFailure('Finish the existing update or recovery before activation')
        # Before the front ports move, read activity through the current desktop.
        from updater import Api
        host.workspace = Api('http://127.0.0.1:4181', config['workspaceToken'])
        if not host.activity():
            raise UpdateFailure('Close terminal/editor sessions and wait for work to finish before activation')
        def database_gate(closed):
            value = 'true' if closed else 'false'
            run([*base, 'exec', '-T', 'postgres', 'psql', '-U', 'neural_labs', '-d', 'neural_labs', '-v', 'ON_ERROR_STOP=1', '-c',
                 f"UPDATE update_runtime SET gate={value} WHERE singleton; INSERT INTO audit_log(action,metadata) VALUES('updates.host_bootstrap','{{}}');"])
        database_gate(True)
        host.pause()
        if not host.activity():
            host.resume(); database_gate(False)
            raise UpdateFailure('New activity deferred updater activation')
        # Record the original Compose file before changing listener ownership.
        if not (root / 'active-compose.yaml').exists():
            (root / 'active-compose.yaml').write_text('services: {}\n')
        deployment = host.installed()
        atomic(root / 'bootstrap-deployment.json', deployment)
        marker = Path('/etc/neural-labs-updater-active')
        marker.write_text(str(root) + '\n')
        marker.chmod(0o644)
        host.stop()
        host.overlay(deployment, False)
        run(['systemctl', 'start', 'neural-labs-update-proxy.service'])
        host.gate(True)
        host.workspace = Api(config['workspace'], config['workspaceToken'])
        host.launch(deployment, False)
        host.verify(deployment, False)
        database_gate(False)
        host.resume()
        host.gate(False)
    run(['systemctl', 'enable', '--now', 'neural-labs-updater.service', 'neural-labs-update-proxy.service'])
    print('Host updater activated. Enable automatic OpenClaw installation in Settings → Updates when ready.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=['prepare', 'activate'])
    parser.add_argument('--repository', type=Path, default=Path.cwd())
    parser.add_argument('--confirm', action='store_true', required=True)
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error('Run this explicit operator step as root')
    os.umask(0o077)
    try:
        prepare(args.repository.resolve()) if args.mode == 'prepare' else activate()
    except Exception as error:
        print(str(error) if isinstance(error, UpdateFailure) else 'Bootstrap failed; inspect protected updater state. No state was deleted.')
        raise SystemExit(1)
