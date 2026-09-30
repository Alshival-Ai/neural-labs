#!/usr/bin/env node
// Structural checks only. Browser review and deployment authorization are separate.
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const privateNames = /^(?:\.env(?:\..*)?|\.git|\.ssh|\.aws|\.codex|\.claude|node_modules|\.venv|credentials(?:\..*)?|.*\.(?:pem|key)|(?:DESIGN|STORYBOARD|SOURCES|VALIDATION|MEDIA|BUSINESS-VISUAL-BRIEF|RESEARCH-EVIDENCE|PIPELINE-STATE)\.(?:md|json))$/i;

export async function checkSite(directory) {
  const root = path.resolve(directory), failures = [];
  let files = 0, bytes = 0;
  if (!(await lstat(root)).isDirectory()) throw new Error("Output must be a real directory");
  async function walk(relative = "") {
    for (const name of (await readdir(path.join(root, relative))).sort()) {
      const entry = path.join(relative, name), info = await lstat(path.join(root, entry));
      if (privateNames.test(name)) { failures.push({ path: entry, reason: "Private or project-only content in public output" }); continue; }
      if (info.isDirectory()) await walk(entry);
      else if (info.isFile()) { files++; bytes += info.size; }
      else failures.push({ path: entry, reason: "Symlinks and special files must not be published" });
    }
  }
  await walk();
  const index = await lstat(path.join(root, "index.html")).catch(error => { if (error.code === "ENOENT") return null; throw error; });
  if (!index?.isFile() || index.size === 0) failures.push({ path: "index.html", reason: "Missing or empty static entry point" });
  return { kind: "static-output-structure", ok: failures.length === 0, files, bytes, failures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error("Usage: node check-site.mjs <public-output-directory>");
    const result = await checkSite(process.argv[2]);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    console.error(error.message); process.exitCode = 1;
  }
}
