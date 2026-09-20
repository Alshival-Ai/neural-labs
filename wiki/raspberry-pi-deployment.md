# Deploying on a Raspberry Pi

Use a 64-bit operating system (`uname -m` must report `aarch64`) and native
ARM64 containers. Do not force `linux/amd64` or install emulation to follow
this guide. A 32-bit Raspberry Pi OS installation is not covered.

The [deployment guide](container-deployment.md) remains the source for
configuration, HTTPS ingress, and account setup. This page covers the extra
steps a fresh Pi needs. The [managed host updater](workspace-updates.md) and
published workspace-release workflow currently support **linux/amd64 only**;
do not install or activate that updater on the Pi. Manual Compose deployment
is a separate path.

## Prepare a fresh host

Inspect the machine before installing anything:

```bash
uname -m
cat /etc/os-release
nproc
free -h
df -h /
```

For a disposable rehearsal, save package and service inventories **outside the
Pi** first. They make it possible to remove only what the rehearsal adds:

```bash
# Run on your operator computer; substitute your SSH alias.
ssh pi 'dpkg-query -W' > pi-packages-before.tsv
ssh pi 'apt-mark showmanual' > pi-manual-before.txt
ssh pi 'systemctl list-unit-files --state=enabled --no-legend --no-pager' \
  > pi-services-before.txt
```

On Ubuntu 26.04 ARM64, the distribution packages used for the rehearsal are:

```bash
sudo apt-get update
sudo apt-get install --no-install-recommends \
  git ca-certificates curl openssl \
  docker.io docker-compose-v2 docker-buildx nodejs nginx
sudo docker info
sudo docker compose version
sudo docker buildx version
node --version
```

Check that Node is at least version 22. Other operating systems may package an
older Node or use different Compose package names. Alternatively, follow
[Docker's official Ubuntu installation instructions](https://docs.docker.com/engine/install/ubuntu/)
for Docker CE; do not mix its packages with the Ubuntu Docker packages above.
Installing Nginx may start its default HTTP site; replace it with the reviewed
Neural Labs site when configuring ingress.

Clone as the regular operator, then initialize using your Docker privilege
method:

```bash
umask 022
git clone https://github.com/Alshival-Ai/neural-labs.git
cd neural-labs
sudo bin/neural-labs init
sudoedit .env
```

Keep `.env` mode `0600`. `init` generates secrets but does not choose a hostname,
administrator, relay address, or resource budget for you.
The normal source-file permissions matter: Docker `COPY` retains them and
runtime processes run as non-root users. Cloning with `umask 077` makes ordinary
source files unreadable in the workspace image and the bind-mounted TURN
entrypoint. Use normal public-source permissions when cloning; do not apply
a recursive permission change to a checkout containing `.env` or other secrets.

## Set the resource and network values

For the **16 GiB, four-core Pi 5** rehearsal, use:

```dotenv
NEURAL_LABS_WORKSPACE_CPUS=4
NEURAL_LABS_WORKSPACE_MEMORY=10g
```

The default CPU limit of 10 is too high for this host. The memory value leaves
room for other services; it is a runtime ceiling and does not limit image
builds. These values do not establish a minimum requirement for smaller Pis.
Allow space for the upstream image, build layers, persistent volumes, and a
full backup. A first build downloads substantial data and writes many files;
keep the Pi powered and monitor `df -h /` and `free -h` while it runs.

Set every public value in the [quick setup table](README.md#2-download-and-configure),
including TURN values even if you will not use voice. Use an IPv4 address
actually assigned to the Pi for `NEURAL_LABS_TURN_RELAY_IP`. For public access
behind NAT, use the router's public address as the external IP and configure
the documented forwards. A LAN-only rehearsal can use the Pi's LAN address
for both IP values, but does not establish internet voice connectivity.

Keep the application bind address `127.0.0.1`. DNS and HTTPS must point to the
authenticated Nginx ingress, not directly to ports 4173, 4174, 4180, or 4181.
Use a certificate trusted by your browser for normal use. A temporary private
test certificate can verify HTTPS with an explicitly trusted test client;
it does not test public DNS, ACME issuance, or browser certificate trust.

## Start and verify

```bash
sudo bin/neural-labs up
sudo bin/neural-labs status
sudo bin/neural-labs doctor
```

`up` returning does not mean the workspace has finished its first initialization.
Wait for healthy containers before diagnosing login or workspace requests.
Follow [HTTPS ingress](container-deployment.md#enable-https-ingress), then
[administrator signup](container-deployment.md#claim-the-configured-administrator).
Register the exact configured email. Use a second synthetic email to verify
that other accounts remain pending during a disposable test.

The current doctor treats missing optional Google Maps, KLIPY, or Pexels keys
as a failure. Check each result; do not invent keys to make it pass. Verify
signed-out workspace rejection, authenticated Files and Terminal access, and
connect your own AI account to test a real Neura reply. Never copy another
installation's `.env`, account credentials, or persistent volumes onto a test Pi.

Before relying on the instance, exercise [backup and restore](backup-restore.md)
with synthetic data and check that restarting the workspace preserves files.

## Remove a disposable test

These steps permanently delete this instance's test data. Use them only on the
disposable installation you intend to remove. Do not use this procedure on a
host with an active managed updater or data you need to retain.

From its checkout, remove that Compose project's containers, volumes, and
networks:

```bash
sudo docker compose --env-file .env -f deploy/compose/compose.yaml \
  down --volumes --remove-orphans
```

Remove the test Nginx site and certificate, generated `.env`, checkout, and test
backups. Remove its test images and build cache only after confirming that no
other deployment uses them. Remove any test DNS/hosts entries or SSH tunnels you created. Compare
package inventories and purge only packages added by the rehearsal; do not run
a general autoremove or image/volume prune on a shared host. If Docker was
absent before the test and contains only rehearsal state, stop its services,
uninstall the added Docker packages, and remove its generated data directories.
Docker package removal alone leaves images and volumes on disk.

Verify the original package set, enabled services, listening ports, networking
settings, and disk use afterward. Keep the Pi's original SSH access and OS
configuration. Package-manager and SSH logs may record the rehearsal; restoring
the original software and configuration is not a byte-for-byte factory reset.

## Rehearsal results — September 19–20, 2026

Tested a Raspberry Pi 5 with 16 GB RAM, four ARM64 cores, Ubuntu 26.04.1 LTS,
and a 64 GB microSD card. Host tools were Ubuntu's Docker 29.1.3, Compose
2.40.3, Node 22.22.1, and Nginx 1.28.3. The source baseline was `62dd2d9`,
followed by the npm-cache fix described below. No emulation, production state,
provider credentials, or managed updater was used.

| Check | Observed result |
|---|---|
| Clone, prerequisites, and native build | Passed; 27 host packages added, no existing package versions changed |
| Default resource settings | Docker rejected the 10-CPU limit; four CPUs and a 10 GiB workspace limit worked |
| First boot on fresh volumes | Passed after isolating the final root-run Claude install's npm cache; all five services healthy |
| HTTPS and authentication | Passed with an explicitly trusted temporary certificate and the supplied Nginx routes on loopback; configured admin active, other signup pending |
| Access boundaries | Signed-out workspace and WebSocket requests redirected to login; retired public routes returned 404; cross-origin file mutation returned 403 |
| Workspace APIs | Desktop response, file creation/read, personal terminal creation/list/close passed |
| Codex app-server | Pinned ARM64 executable passed public initialization and empty-account thread-list checks |
| Persistence and recovery | File and admin session survived restart; restore recovered original file content and removed a post-backup database marker |
| Doctor | Service health and loopback bindings passed; missing optional provider keys produced the documented nonzero result |

The cold image build took roughly eleven minutes. First workspace initialization
took about two minutes. Disk use rose from about 3.3 GiB to a peak of 21 GiB
across repeated builds and the small synthetic backups, leaving about 35 GiB
available. These are observations from this test, not minimum capacity or
performance guarantees.

The rehearsal found and fixed a fresh-install bug: the final root-run Claude
package installation populated the future user's npm cache after home ownership
was set. The Containerfile now uses and removes a separate temporary build
cache. Fresh-volume startup verified the fix. The guide also records source
permission requirements, sudo usage, Nginx listener verification, and the
[restore readiness caveat](backup-restore.md#restore).
A separate permissions failure came from the test checkout's restrictive
`umask 077`; restoring normal tracked-source permissions resolved it.

Real model replies, ChatGPT/Claude account sign-in, browser interaction,
passkeys, public DNS/ACME, SMS delivery, and end-to-end voice were not tested.
The ARM64 managed updater remains unsupported. `make validate` passed; optional
database/browser suites requiring their own fixtures remained skipped.

Cleanup removed the test containers, volumes, images, build cache, checkout,
backups, TLS material, Nginx site, and all 27 added packages. After reboot,
installed package versions, manual package selections, and enabled services
exactly matched the saved baseline. Docker state and its group were absent,
IP forwarding and firewall state were restored, disk use returned to about
3.3 GiB, and the original SSH access and home files remained intact.
