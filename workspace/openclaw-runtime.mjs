import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const openclawRelease = JSON.parse(await readFile(new URL("./openclaw-release.json", import.meta.url), "utf8"));

// SMS ingress requires an official registry install record, not just matching
// code and a global plugin directory. OpenClaw validates the record at runtime.
export function isOfficialSmsInstallation(info, version = openclawRelease.version) {
  const spec = `@openclaw/sms@${version}`;
  return info?.plugin?.origin === "global" && info.plugin.version === version &&
    info.install?.source === "npm" && info.install.spec === spec &&
    info.install.resolvedName === "@openclaw/sms" &&
    info.install.resolvedVersion === version && info.install.resolvedSpec === spec;
}

// Check the installed binary, not just a version string supplied by Compose.
export async function verifyOpenClawRuntime(env = process.env, execute = promisify(execFile)) {
  if (env.NEURAL_LABS_OPENCLAW_VERSION && env.NEURAL_LABS_OPENCLAW_VERSION !== openclawRelease.version) {
    throw new Error("OpenClaw environment version does not match the reviewed workspace release");
  }
  const { stdout } = await execute("openclaw", ["--version"], { encoding: "utf8", timeout: 10_000, maxBuffer: 64 * 1024 });
  const match = stdout.trim().match(/^OpenClaw (\S+)(?: \(([a-f0-9]+)\))?$/u);
  if (match?.[1] !== openclawRelease.version || (match[2] && !openclawRelease.sourceRevision.startsWith(match[2]))) {
    throw new Error("Installed OpenClaw does not match the reviewed workspace release");
  }
  return { version: openclawRelease.version, sourceRevision: openclawRelease.sourceRevision };
}
