// Explicit operator check: requires unprivileged user namespaces and bubblewrap.
// Uses only synthetic files and never reads or mounts a deployment account.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readlink, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const { createNativeLauncher, prepareNativeHome } = await import(process.env.NATIVE_LAUNCHER_MODULE || "../workspace/native/launcher.mjs");
const root = await mkdtemp(path.join(os.tmpdir(), "neural-native-isolation-"));
try {
  const workspaceRoot = path.join(root, "workspace"), homeRoot = path.join(root, "selected");
  const other = path.join(root, "another-owner");
  await mkdir(workspaceRoot); await prepareNativeHome(homeRoot); await mkdir(other);
  await writeFile(path.join(other, "credential"), "synthetic-other-owner-secret");
  await mkdir(path.join(other, "skills"));
  await writeFile(path.join(other, "skills/SKILL.md"), "synthetic-private-team-skill");
  const runtime = path.join(root, "runtime-state");
  await mkdir(runtime);
  await writeFile(path.join(runtime, "runtime.sqlite"), "synthetic-runtime-authority");
  // An attacker can create arbitrary links in the shared workspace and its
  // selected home. Neither link may reopen a path outside the child namespace.
  await symlink(other, path.join(workspaceRoot, "outside-workspace"));
  await symlink(runtime, path.join(homeRoot, "outside-home"));
  await writeFile(path.join(homeRoot, ".codex/auth.json"), "synthetic-selected-account");
  const launch = await createNativeLauncher({ workspaceRoot, homeRoot });
  await launch.probe();
  const parentNamespace = await readlink("/proc/self/ns/pid");
  const script = `import os, pathlib
p = pathlib.Path
assert p('/home/node/.codex/auth.json').read_text() == 'synthetic-selected-account'
for forbidden in [${JSON.stringify(path.join(other, "credential"))},
    ${JSON.stringify(path.join(other, "skills/SKILL.md"))},
    ${JSON.stringify(path.join(runtime, "runtime.sqlite"))},
    '/home/node/workspace/outside-workspace/credential',
    '/home/node/outside-home/runtime.sqlite', '/etc/shadow',
    '/proc/1/root' + ${JSON.stringify(path.join(other, "credential"))},
    '/proc/self/root' + ${JSON.stringify(path.join(runtime, "runtime.sqlite"))}]:
    try: p(forbidden).read_bytes()
    except OSError: pass
    else: raise AssertionError('private path exposed')
for socket in ['/var/run/docker.sock', '/run/docker.sock']:
    assert not p(socket).exists(), 'host control socket exposed'
mounts = [line.split() for line in p('/proc/self/mountinfo').read_text().splitlines()]
assert any(row[4] == '/usr' and 'ro' in row[5].split(',') for row in mounts)
try: p('/usr/bin/neural-fixture').write_text('denied')
except OSError: pass
else: raise AssertionError('system tree writable')
assert os.readlink('/proc/self/ns/pid') != ${JSON.stringify(parentNamespace)}
for environ in p('/proc').glob('[0-9]*/environ'):
    try: content = environ.read_bytes()
    except OSError: continue
    assert b'NEURAL_LABS_WORKSPACE_CONTROL_TOKEN=' not in content
assert 'NEURAL_LABS_WORKSPACE_CONTROL_TOKEN' not in os.environ
assert 'NoNewPrivs:\t1' in p('/proc/self/status').read_text()
p('/home/node/workspace/result').write_text('workspace-tools-work')
p('/home/node/.codex/session').write_text('persistent-session')
print('selected home, cross-owner and runtime denial, symlink denial, process isolation, and no-new-privileges verified')`;
  const result = await launch.exec('/usr/bin/python3', ['-c', script], {
    env: { HOME: '/home/node', PATH: '/usr/bin:/bin' }, timeout: 10000, maxBuffer: 65536 });
  assert.equal(await readFile(path.join(workspaceRoot, 'result'), 'utf8'), 'workspace-tools-work');
  assert.equal(await readFile(path.join(homeRoot, '.codex/session'), 'utf8'), 'persistent-session');
  const readOnly = await createNativeLauncher({ workspaceRoot, homeRoot, readOnly: true });
  await assert.rejects(readOnly.exec('/bin/sh', ['-c', 'echo denied > /home/node/workspace/result'], {
    env: { HOME: '/home/node' }, timeout: 5000 }));
  console.log(result.stdout.trim());
} finally { await rm(root, { recursive: true, force: true }); }
