import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { agentEnvironment } from "./provider-environment.mjs";

// This is the terminal CLI. OpenClaw owns and selects its managed app-server
// independently; never rewrite or infer its launchers from an internal path.
export async function verifyCodexRuntime(expectedVersion, execute = promisify(execFile)) {
  if (!/^\d+\.\d+\.\d+$/.test(expectedVersion ?? "")) throw new Error("A pinned Codex version is required");
  const { stdout } = await execute("/usr/local/bin/codex", ["--version"], { timeout: 10_000, encoding: "utf8", env: agentEnvironment(process.env) });
  if (stdout.trim() !== `codex-cli ${expectedVersion}`) throw new Error("Terminal Codex CLI does not match the release pin");
  return { name: "Codex CLI", version: expectedVersion };
}
