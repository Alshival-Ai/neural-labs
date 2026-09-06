import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { agentEnvironment } from "./provider-environment.mjs";

export const managedCodexCommand = "/app/extensions/codex/node_modules/.bin/codex";

export async function verifyCodexRuntime(expectedVersion, execute = promisify(execFile)) {
  if (!/^\d+\.\d+\.\d+$/.test(expectedVersion ?? "")) throw new Error("A pinned Codex version is required");
  for (const command of [managedCodexCommand, "/app/node_modules/.bin/codex", "/usr/local/bin/codex"]) {
    const { stdout } = await execute(command, ["--version"], { timeout: 10_000, encoding: "utf8", env: agentEnvironment(process.env) });
    if (stdout.trim() !== `codex-cli ${expectedVersion}`) throw new Error("Managed Codex and workspace CLI versions must match the release pin");
  }
  return { name: "Codex", version: expectedVersion };
}
