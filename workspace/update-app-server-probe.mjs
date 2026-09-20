import { spawn, execFile } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { tmpdir } from "node:os";

// Exercise the public stdio protocol in an empty, isolated account directory.
// No tenant configuration, provider credentials, or real inference is involved.
export async function verifyAppServer(version, command = "/usr/local/lib/neural-labs/codex-app-server/node_modules/.bin/codex") {
  const root = await mkdtemp(path.join(tmpdir(), "neural-app-server-probe-"));
  const env = { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: root, CODEX_HOME: path.join(root, "codex"), XDG_CONFIG_HOME: path.join(root, "config") };
  let child;
  try {
    await mkdir(env.CODEX_HOME, { mode: 0o700 });
    await mkdir(env.XDG_CONFIG_HOME, { mode: 0o700 });
    const result = await promisify(execFile)(command, ["--version"], { env, cwd: root, timeout: 10000, maxBuffer: 65536 });
    if (result.stdout.trim() !== `codex-cli ${version}`) throw new Error("App-server version mismatch");
    child = spawn(command, ["app-server"], { cwd: root, env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    await new Promise((resolve, reject) => {
      let buffer = "", settled = false;
      const timer = setTimeout(() => finish(new Error("App-server handshake timed out")), 15000);
      const finish = error => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(); };
      const send = message => child.stdin.write(JSON.stringify(message) + "\n");
      child.once("error", () => finish(new Error("App-server could not start")));
      child.stdin.once("error", () => finish(new Error("App-server input stream closed")));
      child.once("exit", () => finish(new Error("App-server exited before verification")));
      child.stderr.resume();
      child.stdout.on("data", chunk => {
        buffer += chunk;
        if (buffer.length > 1024 * 1024) { finish(new Error("App-server output exceeded the probe limit")); return; }
        while (buffer.includes("\n")) {
          const index = buffer.indexOf("\n"), line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
          let response; try { response = JSON.parse(line); } catch { finish(new Error("Invalid app-server protocol response")); return; }
          if (response.id === 1) {
            if (response.error || !response.result) { finish(new Error("App-server initialization failed")); return; }
            send({ method: "initialized" });
            send({ id: 2, method: "thread/list", params: { limit: 1 } });
          } else if (response.id === 2) {
            if (response.error || !Array.isArray(response.result?.data) || response.result.data.length !== 0) finish(new Error("App-server isolated thread listing failed"));
            else finish();
          }
        }
      });
      send({ id: 1, method: "initialize", params: { clientInfo: { name: "neural_labs_update_probe", version: "1" } } });
    });
  } finally {
    if (child?.pid) {
      try { process.kill(-child.pid, "SIGTERM"); } catch { /* already exited */ }
      if (child.exitCode === null) await new Promise(resolve => {
        const timer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} resolve(); }, 3000);
        child.once("exit", () => { clearTimeout(timer); resolve(); });
      });
    }
    await rm(root, { recursive: true, force: true });
  }
}
