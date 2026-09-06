import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, readlink } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Content, names, symlink targets, modes and ownership; ignore build timestamps.
export async function fingerprintTree(root) {
  const hash = createHash("sha256");
  let entries = 0;
  async function visit(relative) {
    const file = path.join(root, relative);
    const info = await lstat(file);
    const kind = info.isSymbolicLink() ? "link" : info.isDirectory() ? "dir" : info.isFile() ? "file" : "other";
    hash.update(JSON.stringify([relative, kind, info.mode, info.uid, info.gid]) + "\n");
    entries++;
    if (kind === "link") hash.update(JSON.stringify(await readlink(file)) + "\n");
    else if (kind === "dir") for (const name of (await readdir(file)).sort()) await visit(path.join(relative, name));
    else if (kind === "file") {
      const content = createHash("sha256");
      for await (const chunk of createReadStream(file)) content.update(chunk);
      hash.update(content.digest("hex") + "\n");
    } else throw new Error(`Unsupported entry in upstream application: ${relative}`);
  }
  await visit("");
  return { entries, sha256: hash.digest("hex") };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await fingerprintTree(process.argv[2] ?? "/app")));
}
