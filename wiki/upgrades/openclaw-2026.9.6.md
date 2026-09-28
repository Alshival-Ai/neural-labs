# OpenClaw 2026.9.6 upgrade record

Prepared on 2026-09-25 from OpenClaw 2026.9.5. The official runtime and
matching Gateway client, protocol, and SMS packages are pinned to 2026.9.6.
The terminal Codex CLI remains independently pinned to 0.155.1. OpenClaw's
Codex plugin uses app-server 0.155.1.

## Release coordinates

- Upstream source: `eb377ac59e6c9fd6c7705028034812becf00271b`.
- Official image: `ghcr.io/openclaw/openclaw:2026.9.6@sha256:0a5ff5e682e62afa19149df126aa50063bf65ef885b5c94713ce32dc0eb12e15`.
- Image source labels, npm provenance, and `openclaw --version` agree.
- The reviewed local workspace image is
  `sha256:948dd4ecd6891c2723893d1e06d71999f5a387c4a991fcc32279bed8c08a1bcf`.

## Compatibility and Skill Workshop policy

The 2026.9.6 startup migration creates protected SQLite backups, upgrades
agent databases, and moves legacy Skill Workshop ownership into per-agent
directories. Autonomous Workshop capture and maintenance are disabled with
`skills.workshop.autonomous.mode="off"`; explicit user-requested skill work
remains available.

The separately installed Codex app-server now matches the upstream plugin's
0.155.1 dependency. The upstream `/app` tree remains unmodified.

## Validation

- Release inspection, pin synchronization, package-lock regeneration, and the
  complete `make validate` suite passed.
- The official public CLI dry-run, atomic-write, rejection, and unrelated-key
  preservation smoke test passed.
- All 129,448 upstream `/app` entries match the official base; fingerprint
  `c92bcaf60d363f80283d6888b5219c493cdca85de20e5983ee108f9d410e8774`.
- The Samuel Cavazos portal candidate reported the exact runtime and retained
  its same-origin GIF recovery assets before promotion.
- Pre-migration live and recovery copies passed 11 SQLite quick checks each.
- After promotion, the portal and both private M365 sidecars became healthy,
  the Gateway reported ready, database verification passed, and the public
  greeter returned a valid KLIPY GIF through the same-origin proxy.

## Recovery

The Samuel deployment preserves the prior Compose descriptor, exact image
identifiers, configuration, and a stopped-state copy under its protected
maintenance backups. The 2026.9.6 migration also wrote its own pre-startup
SQLite backups. Restoring the old state discards later writes and must be done
only while the stack is stopped.

Upstream evidence: [2026.9.6 release](https://github.com/openclaw/openclaw/releases/tag/v2026.9.6),
[Skill Workshop configuration](https://docs.openclaw.ai/tools/skill-workshop/configuration).
