// Explicit operator check: requires unprivileged user namespaces and bubblewrap.
// Uses only synthetic files and never reads or mounts a deployment account.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const { createNativeLauncher, prepareNativeHome } = await import(process.env.NATIVE_LAUNCHER_MODULE || "../workspace/native/launcher.mjs");
const root = await mkdtemp(path.join(os.tmpdir(), "neural-native-isolation-"));
try {
  const workspaceRoot = path.join(root, "workspace"), homeRoot = path.join(root, "selected");
  const other = path.join(root, "another-owner");
  await mkdir(workspaceRoot); await prepareNativeHome(homeRoot); await mkdir(other);
  await writeFile(path.join(other, "credential"), "synthetic-other-owner-secret");
  await writeFile(path.join(homeRoot, ".codex/auth.json"), "synthetic-selected-account");
  const launch = await createNativeLauncher({ workspaceRoot, homeRoot });
  await launch.probe();
  const parentNamespace = await readlink("/proc/self/ns/pid");
  const script = `import os, pathlib
p = pathlib.Path
assert p('/home/node/.codex/auth.json').read_text() == 'synthetic-selected-account'
for forbidden in [${JSON.stringify(path.join(other, "credential"))}, '/etc/shadow']:
    try: p(forbidden).read_bytes()
    except OSError: pass
    else: raise AssertionError('private path exposed')
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
print('selected home, workspace tools, process isolation, and no-new-privileges verified')`;
  const result = await launch.exec('/usr/bin/python3', ['-c', script], {
    env: { HOME: '/home/node', PATH: '/usr/bin:/bin' }, timeout: 10000, maxBuffer: 65536 });
  assert.equal(await readFile(path.join(workspaceRoot, 'result'), 'utf8'), 'workspace-tools-work');
  assert.equal(await readFile(path.join(homeRoot, '.codex/session'), 'utf8'), 'persistent-session');
  const readOnly = await createNativeLauncher({ workspaceRoot, homeRoot, readOnly: true });
  await assert.rejects(readOnly.exec('/bin/sh', ['-c', 'echo denied > /home/node/workspace/result'], {
    env: { HOME: '/home/node' }, timeout: 5000 }));
  console.log(result.stdout.trim());
} finally { await rm(root, { recursive: true, force: true }); }
