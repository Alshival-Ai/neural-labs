# OpenClaw Gateway overlay

The official OpenClaw image is extended with common development command-line tools, Python, Git, SSH, and container-local `sudo`. The developer and agent work from the same persistent `/home/node` volume.

The base image argument has no default on purpose. Select and verify a release, then pin its digest:

```bash
docker build \
  --build-arg OPENCLAW_BASE_IMAGE=ghcr.io/openclaw/openclaw@sha256:REPLACE_WITH_VERIFIED_DIGEST \
  -t neural-labs/openclaw-gateway:dev \
  images/openclaw-gateway
```

Container `sudo` can change this disposable container filesystem, but it does not grant host `sudo`. Preserve that boundary by never mounting the host Docker/Podman socket, host administrator directories, devices, or another tenant's home. This platform's isolation unit is the tenant cell, and the Gateway has direct access only to its own container and home.
