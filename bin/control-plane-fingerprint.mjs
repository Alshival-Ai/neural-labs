import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(process.argv[2] ?? "control-plane");
const files = ["package.json", "package-lock.json", "Containerfile"];
async function walk(relative) {
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = `${relative}/${entry.name}`;
    if (entry.isDirectory()) await walk(name); else if (entry.isFile()) files.push(name);
  }
}
await walk("src");
const hash = createHash("sha256");
for (const file of files.sort()) hash.update(`control-plane/${file}\0`).update(await readFile(path.join(root, file))).update("\0");
console.log(hash.digest("hex"));
