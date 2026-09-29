import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(tmpdir(), "native-claude-probe-"));
const env = { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: root, CLAUDE_CONFIG_DIR: path.join(root, "claude"), DISABLE_AUTOUPDATER: "1" };
let child;
try {
  if (!execFileSync("claude", ["--version"], { env, cwd: root, encoding: "utf8", timeout: 10000 }).startsWith("2.1.226 ")) throw new Error("Claude release pin mismatch");
  child = spawn("claude", ["--print", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
    "--permission-prompt-tool", "stdio", "--permission-mode", "default", "--effort", "high", "--setting-sources", "", "--strict-mcp-config"],
  { env, cwd: root, detached: true, stdio: ["pipe", "pipe", "pipe"] });
  child.stderr.resume();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Claude initialization timed out")), 15000);
    let buffer = "";
    child.once("error", () => { clearTimeout(timer); reject(new Error("Claude could not start")); });
    child.once("exit", () => { clearTimeout(timer); reject(new Error("Claude exited before initialization")); });
    child.stdin.on("error", () => { clearTimeout(timer); reject(new Error("Claude input closed")); });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      buffer += chunk;
      if (buffer.length > 1024 * 1024) { clearTimeout(timer); reject(new Error("Claude initialization frame exceeded limit")); return; }
      while (buffer.includes("\n")) {
        const index = buffer.indexOf("\n"), line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        let message; try { message = JSON.parse(line); } catch { clearTimeout(timer); reject(new Error("Invalid Claude protocol")); return; }
        if (message.type === "control_response" && message.response?.request_id === "initialize-1") {
          clearTimeout(timer);
          if (message.response.subtype !== "success") reject(new Error("Claude rejected initialization"));
          else resolve();
        }
      }
    });
    child.stdin.write(JSON.stringify({ type: "control_request", request_id: "initialize-1", request: { subtype: "initialize" } }) + "\n");
  });
  console.log(JSON.stringify({ claude: "2.1.226", initialize: true, inference: false }));
} finally {
  if (child?.pid && child.exitCode === null) {
    const exited = new Promise(resolve => child.once("exit", resolve));
    try { process.kill(-child.pid, "SIGKILL"); } catch {}
    await exited;
  }
  await rm(root, { recursive: true, force: true });
}
