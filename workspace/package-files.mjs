import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";

// Resolve each component from an open directory descriptor. Checking realpath
// before readFile is insufficient when a workspace process can replace a parent.
export async function openPackageDirectory(directory) {
  const flags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
  let handle = await open("/", flags);
  try {
    for (const part of path.resolve(directory).split("/").filter(Boolean)) {
      const next = await open(`/proc/self/fd/${handle.fd}/${part}`, flags);
      await handle.close(); handle = next;
    }
    return handle;
  } catch (error) { await handle.close(); throw error; }
}

export async function readPackageFile(filename, maximum) {
  const directory = await openPackageDirectory(path.dirname(filename));
  try {
    const file = await open(`/proc/self/fd/${directory.fd}/${path.basename(filename)}`,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await file.stat();
      if (!before.isFile() || before.size > maximum) throw new Error("Package file is not a bounded regular file");
      const buffer = Buffer.alloc(before.size + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      const after = await file.stat();
      if (length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
        throw new Error("Package file changed during reading");
      return { content: buffer.subarray(0, length), stat: before };
    } finally { await file.close(); }
  } finally { await directory.close(); }
}
