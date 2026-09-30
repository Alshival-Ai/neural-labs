import { constants } from 'node:fs';
import { open, writeFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { prepareNativeHome } from './launcher.mjs';

// A workspace credential is shared, but CLI histories are not. Copy only the
// selected provider's authentication file into a per-message execution home.
export async function prepareConnectorHome(source, destination, provider) {
  await prepareNativeHome(source); await prepareNativeHome(destination);
  const directory = provider === 'codex' ? '.codex' : '.claude';
  const filename = provider === 'codex' ? 'auth.json' : '.credentials.json';
  const flags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
  const sourceRoot = await open(source, flags), destinationRoot = await open(destination, flags);
  let from, to, file;
  try {
    from = await open(`/proc/self/fd/${sourceRoot.fd}/${directory}`, flags);
    to = await open(`/proc/self/fd/${destinationRoot.fd}/${directory}`, flags);
    file = await open(`/proc/self/fd/${from.fd}/${filename}`, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await file.stat(); if (!info.isFile() || info.size > 1024 * 1024) throw new Error('Invalid provider authentication file');
    const temp = `/proc/self/fd/${to.fd}/.connector-${randomUUID()}`;
    try { await writeFile(temp, await file.readFile(), { flag: 'wx', mode: 0o600 }); await rename(temp, `/proc/self/fd/${to.fd}/${filename}`); }
    finally { await rm(temp, { force: true }); }
  } finally { await file?.close(); await from?.close(); await to?.close(); await sourceRoot.close(); await destinationRoot.close(); }
}
