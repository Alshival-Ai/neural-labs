#!/usr/bin/env python3
"""Build the small, attested deployment manifest; no tenant input is read."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
from updater import REPOSITORY, validate_manifest


def fingerprint(root, paths):
    digest = hashlib.sha256()
    files = []
    for relative in paths:
        item = root / relative
        files.extend([item] if item.is_file() else (p for p in item.rglob('*') if p.is_file()
                     and not any(part in {'node_modules', 'dist', '__pycache__'} for part in p.parts)))
    for item in sorted(set(files)):
        digest.update(str(item.relative_to(root)).encode() + b'\0' + item.read_bytes() + b'\0')
    return digest.hexdigest()


def compatibility(root):
    return {
        'controlPlaneRevision': fingerprint(root, ['control-plane/src', 'control-plane/package.json', 'control-plane/package-lock.json', 'control-plane/Containerfile']),
        'hostRevision': fingerprint(root, ['deploy/updater', '.github/workflows/workspace-release.yml']),
    }


def manifest(root, tag, image):
    release = json.loads((root / 'workspace/openclaw-release.json').read_text())
    policy = json.loads((root / 'workspace/update-release-policy.json').read_text())
    return validate_manifest({
        'schema': 1, 'id': tag, 'image': image,
        'sourceRevision': subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip(),
        'openclawVersion': release['version'], 'codexVersion': release['codexVersion'], 'appServerVersion': release['appServerVersion'],
        'upstreamImage': release['image'], 'upstreamRevision': release['sourceRevision'],
        'packages': {name: release['version'] for name in release['packages']},
        'supportedOrigins': list(policy['baselineImages']), 'protocol': 1, 'platform': 'linux/amd64',
        'manualRequired': policy['manualRequired'], 'reason': policy['reason'],
        'notesUrl': f'https://github.com/{REPOSITORY}/releases/tag/{tag}', **compatibility(root),
    })


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument('--tag', required=True)
    parser.add_argument('--image', required=True)
    args = parser.parse_args()
    print(json.dumps(manifest(args.root, args.tag, args.image), indent=2))
