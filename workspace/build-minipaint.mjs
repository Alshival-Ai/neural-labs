import { cp, mkdir, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const workspace = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(workspace, "vendor/minipaint");
const destination = path.join(process.cwd(), "dist/image-editor");
try {
  await access(path.join(source, "node_modules/.bin/webpack"));
} catch {
  const install = spawnSync("npm", ["ci", "--include=dev", "--ignore-scripts"], {
    cwd: source,
    stdio: "inherit",
  });
  if (install.status !== 0) process.exit(install.status || 1);
}
const build = spawnSync("npm", ["run", "build"], {
  cwd: source,
  stdio: "inherit",
});
if (build.status !== 0) process.exit(build.status || 1);
await mkdir(destination, { recursive: true });
for (const name of ["index.html", "dist", "images", "MIT-LICENSE.txt"])
  await cp(path.join(source, name), path.join(destination, name), {
    recursive: true,
  });
