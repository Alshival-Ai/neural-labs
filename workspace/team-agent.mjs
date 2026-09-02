import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function finalText(payload) {
  if (typeof payload?.final === "string" && payload.final.trim()) return payload.final.trim();
  if (Array.isArray(payload?.payloads)) {
    const text = payload.payloads
      .map((item) => typeof item?.text === "string" ? item.text.trim() : "")
      .filter(Boolean)
      .join("\n\n");
    if (text) return text;
  }
  throw new Error("OpenClaw returned no final assistant message");
}

export async function runTeamAgent({ prompt, capability, workspaceRoot, execute = execFileAsync }) {
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 1024 * 1024) {
    throw new Error("The Team Chat prompt is invalid");
  }
  if (typeof capability !== "string" || capability.length < 32 || capability.length > 512) {
    throw new Error("The Team Chat capability is invalid");
  }
  const { stdout } = await execute(
    "openclaw",
    ["agent", "exec", prompt, "--cwd", workspaceRoot, "--json"],
    {
      cwd: workspaceRoot,
      encoding: "utf8",
      timeout: 10 * 60 * 1000,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        NEURAL_LABS_TEAM_CAPABILITY: capability,
      },
    },
  );
  return finalText(JSON.parse(stdout));
}
