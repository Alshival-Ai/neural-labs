import { constants } from "node:fs";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, realpath, mkdir, open } from "node:fs/promises";
import path from "node:path";

const execute = promisify(execFile);
const SYSTEM_TREES = ["/usr", "/bin", "/sbin", "/lib", "/lib64"];
const SYSTEM_FILES = ["/etc/ssl", "/etc/ca-certificates", "/etc/resolv.conf", "/etc/hosts", "/etc/nsswitch.conf", "/etc/localtime", "/etc/passwd", "/etc/group", "/etc/fonts", "/etc/chromium", "/etc/chromium.d"];
export const NATIVE_HOME = "/home/node";
export const NATIVE_WORKSPACE = "/home/node/workspace";

async function directory(value) {
  if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0")) throw new Error("An absolute execution directory is required");
  const info = await lstat(value);
  if (!info.isDirectory() || await realpath(value) !== path.resolve(value)) throw new Error("Execution roots must be real directories without symlinks");
  return path.resolve(value);
}
function contained(parent, child) { return child === parent || child.startsWith(`${parent}/`); }

// No host daemon/socket, capabilities, root helper, or provider listener. The
// selected home is the ONLY persistent home mounted in the child namespace.
// Namespace setup failure is fatal; never retry the command without isolation.
export async function createNativeLauncher({ workspaceRoot, homeRoot, readOnly = false,
  bubblewrap = "/usr/bin/bwrap", spawnProcess = spawn, executeProcess = execute,
  extraReadOnly = [], skillDiscoveryRoot, editorSocketRoot,
}) {
  const workspace = await directory(workspaceRoot), home = await directory(homeRoot);
  if (contained(home, workspace) || contained(workspace, home)) throw new Error("Credential and workspace roots must be separate");
  const base = ["--unshare-user", "--unshare-pid", "--unshare-ipc", "--unshare-uts", "--die-with-parent",
    "--new-session", "--cap-drop", "ALL", "--clearenv"];
  for (const entry of [...SYSTEM_TREES, ...SYSTEM_FILES]) {
    try {
      await lstat(entry);
      // Bind the resolved system tree; /bin etc may be distribution symlinks.
      base.push("--ro-bind", await realpath(entry), entry);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  base.push("--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp", "--tmpfs", "/run",
    "--bind", home, NATIVE_HOME,
    readOnly ? "--ro-bind" : "--bind", workspace, NATIVE_WORKSPACE);
  if (editorSocketRoot) {
    const socketRoot = await directory(editorSocketRoot);
    if ([home, workspace].some(root => contained(root, socketRoot) || contained(socketRoot, root))) throw new Error("Editor sockets must be outside persistent user roots");
    base.push("--bind", socketRoot, "/run/neural-labs-editor");
  }
  for (const root of extraReadOnly) {
    const source = await directory(root.source);
    if (!/^\/opt\/neural-labs\/skills\/[a-zA-Z0-9_-]+$/.test(root.target)
        || contained(source, home) || contained(home, source)) throw new Error("Invalid skill discovery mount");
    base.push("--ro-bind", source, root.target);
  }
  if (skillDiscoveryRoot) {
    const discovery = await directory(skillDiscoveryRoot);
    if ([home, workspace].some(root => contained(root, discovery) || contained(discovery, root))) throw new Error("Skill discovery must be outside user roots");
    base.push("--ro-bind", discovery, `${NATIVE_HOME}/.agents/skills`,
      "--ro-bind", discovery, `${NATIVE_HOME}/.claude/skills`);
  }
  const invocation = (command, args, options = {}) => {
    if (typeof command !== "string" || !path.isAbsolute(command) || !Array.isArray(args)
        || args.some(arg => typeof arg !== "string" || arg.includes("\0"))) throw new Error("Invalid native process command");
    const cwd = options.cwd || NATIVE_WORKSPACE;
    if (!contained(NATIVE_WORKSPACE, path.resolve(cwd))) throw new Error("Native working directory must be inside the workspace");
    const env = options.env || {};
    if (env.HOME !== NATIVE_HOME || Object.keys(env).some(key => !/^[A-Z][A-Z0-9_]*$/.test(key))) throw new Error("Invalid native process environment");
    const environment = Object.entries(env).flatMap(([key, value]) => {
      if (typeof value !== "string" || value.includes("\0")) throw new Error("Invalid native process environment");
      return ["--setenv", key, value];
    });
    // Clear the launcher's own environment too: bwrap's parent/supervisor must
    // not inherit the runtime's control token or integration credentials.
    return { file: bubblewrap, args: [...base, ...environment, "--chdir", cwd, "--", command, ...args],
      options: { ...options, cwd: workspace, env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" } } };
  };
  return {
    invocation,
    spawn(command, args, options) { const spec = invocation(command, args, options); return spawnProcess(spec.file, spec.args, spec.options); },
    exec(command, args, options) { const spec = invocation(command, args, options); return executeProcess(spec.file, spec.args, spec.options); },
    async probe() {
      const result = await this.exec("/usr/bin/true", [], { env: { HOME: NATIVE_HOME }, timeout: 10000 });
      return result;
    },
  };
}

// Account parent ownership is controlled by the runtime and is never mounted
// into a user process. The caller selects this root after authorization.
export async function prepareNativeHome(root) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  await directory(root);
  // A native process can edit its own home while another turn starts. Anchor
  // every mkdir/open to directory descriptors and refuse symlinks; recursive
  // mkdir on user-writable paths could otherwise follow a link out of this home.
  for (const child of [".codex", ".claude/skills", ".config", ".cache", ".local", ".agents/skills"]) {
    let parent = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      for (const segment of child.split("/")) {
        const target = `/proc/self/fd/${parent.fd}/${segment}`;
        try { await mkdir(target, { mode: 0o700 }); } catch (error) { if (error.code !== "EEXIST") throw error; }
        const next = await open(target, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        await parent.close(); parent = next;
      }
    } finally { await parent.close(); }
  }
  return root;
}
