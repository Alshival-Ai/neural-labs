import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { workspaceSkillActorId } from "../skills-manager.mjs";

// Keep originals untouched. Each execution gets its own immutable discovery
// view, even when several actors deliberately select the same AI connection.
// Descriptor-relative traversal refuses links and special files throughout the
// package, including directories a concurrent editor replaces while copying.
async function snapshot(source, destination, relative = "", receipt = [], budget = { files: 0, bytes: 0 }) {
  // Open every source ancestor without following links. The shared workspace
  // can be edited concurrently, so checking only the package's final component
  // would still let a replaced `skills` parent reach a broker-private home.
  const flags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
  let parent;
  if (typeof source === "string") {
    parent = await open("/", flags);
    try {
      for (const part of path.resolve(source).split("/").filter(Boolean)) {
        const next = await open(`/proc/self/fd/${parent.fd}/${part}`, flags);
        await parent.close(); parent = next;
      }
    } catch (error) { await parent.close(); throw error; }
  } else parent = source;
  try {
    for (const name of (await readdir(`/proc/self/fd/${parent.fd}`)).sort()) {
      const from = `/proc/self/fd/${parent.fd}/${name}`, to = path.join(destination, name);
      const file = await open(from, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const info = await file.stat(), filename = relative ? `${relative}/${name}` : name;
        if (info.isDirectory()) {
          await mkdir(to, { mode: 0o700 });
          // Reopen the already anchored descriptor, not a mutable directory
          // name. snapshot owns the new descriptor; this frame owns `file`.
          await snapshot(await open(`/proc/self/fd/${file.fd}`, constants.O_RDONLY | constants.O_DIRECTORY), to, filename, receipt, budget);
        } else {
          if (!info.isFile() || ++budget.files > 2000 || (budget.bytes += info.size) > 100 * 1024 ** 2)
            throw new Error("Skill package is not a bounded regular-file package");
          // Bound the read even if another process keeps appending to a file.
          const bytes = Buffer.alloc(info.size + 1);
          let length = 0;
          while (length < bytes.length) {
            const result = await file.read(bytes, length, bytes.length - length, length);
            if (!result.bytesRead) break;
            length += result.bytesRead;
          }
          if (length !== info.size) throw new Error("Skill package changed during preparation");
          const after = await file.stat();
          if (info.size !== after.size || info.mtimeMs !== after.mtimeMs || info.ctimeMs !== after.ctimeMs) throw new Error("Skill package changed during preparation");
          const content = bytes.subarray(0, length);
          const mode = info.mode & 0o111 ? 0o500 : 0o400;
          await writeFile(to, content, { flag: "wx", mode });
          receipt.push({ path: filename, sha256: createHash("sha256").update(content).digest("hex"), executable: Boolean(info.mode & 0o111) });
        }
      } finally { await file.close(); }
    }
    return receipt;
  } finally { await parent.close(); }
}

export class NativeSkills {
  constructor({ manager, root }) { this.manager = manager; this.root = root; }
  async prepare({ actor, input, provider, requestedSkillText, scope = "personal", explicitOnly = false }) {
    if (!["codex", "claude"].includes(provider)) throw new Error("Unknown skill provider");
    if (!["personal", "team"].includes(scope)) throw new Error("Unknown skill scope");
    const requested = new Set((requestedSkillText === undefined ? input.map(row => row.text) : [requestedSkillText])
      .flatMap(text => [...text.matchAll(/(?:^|\s)\$([a-z0-9][a-z0-9-]*)(?=$|[\s.,:;!?])/g)].map(match => match[1])));
    const owner = workspaceSkillActorId(actor);
    const skillActor = { id: owner, userId: actor, role: "user" };
    const records = (await this.manager.list(skillActor))
      .filter(row => row.scope === "team" || scope === "personal" && row.ownerUserId === owner);
    const canonicalKeys = new Set(records.map(row => row.key));
    for (const record of await this.manager.library?.(skillActor) || []) {
      // An explicitly saved package wins over its installed original. The
      // original remains in the library and is never overwritten or deleted.
      if (!canonicalKeys.has(record.key) && (record.canonicalScope === "team" || record.scope === "team"
          || scope === "personal" && record.ownerUserId === owner)) {
        records.push(record); canonicalKeys.add(record.key);
      }
    }
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const root = await mkdtemp(path.join(this.root, "execution-"));
    const release = () => rm(root, { recursive: true, force: true });
    try {
      const discovery = path.join(root, "discovery"); await mkdir(discovery, { mode: 0o700 });
      const mounts = [], packages = [], available = new Map(), dependencies = new Map();
      const eligible = new Map();
      for (const record of records) {
        if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(record.key) || eligible.has(record.key)) throw new Error("Ambiguous skill identity");
        eligible.set(record.key, record);
      }
      const queue = records.filter(record => record.enabled !== false && (!explicitOnly || requested.has(record.key)));
      const queued = new Set(queue.map(record => record.key));
      for (const record of queue) {
        if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(record.key) || available.has(record.key)) throw new Error("Ambiguous skill identity");
        const directory = path.join(root, record.key); await mkdir(directory, { mode: 0o700 });
        const files = await snapshot(path.dirname(record.path), directory);
        const document = await readFile(path.join(directory, "SKILL.md"), "utf8");
        // Metadata is authoritative after the snapshot, not the earlier list.
        try {
          const metadata = JSON.parse(await readFile(path.join(directory, ".neural-labs.json"), "utf8"));
          if (metadata.scope !== (record.canonicalScope || record.scope) || metadata.ownerUserId !== record.ownerUserId || metadata.slug !== record.key)
            throw new Error("Skill ownership changed during preparation");
          if (metadata.enabled === false) continue;
        } catch (error) { if (error.code !== "ENOENT") throw error; }
        // Read declarations only from the ownership-checked immutable package.
        // Names resolve through the same actor/scope-filtered catalog as a direct
        // selection. Declarations cannot grant access or enable disabled skills.
        let required = [];
        try {
          const declaration = JSON.parse(await readFile(path.join(directory, "references", "skill-dependencies.json"), "utf8"));
          if (declaration.schemaVersion !== 1 || !Array.isArray(declaration.skills) || declaration.skills.length > 16
              || declaration.skills.some(key => typeof key !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(key))
              || new Set(declaration.skills).size !== declaration.skills.length)
            throw new Error(`Invalid skill dependencies: ${record.key}`);
          required = declaration.skills;
        } catch (error) { if (error.code !== "ENOENT") throw error; }
        dependencies.set(record.key, required);
        if (explicitOnly) for (const key of required) {
          const dependency = eligible.get(key);
          if (!dependency || dependency.enabled === false) throw new Error(`Skill ${record.key} requires unavailable skill: ${key}`);
          if (!queued.has(key)) { queue.push(dependency); queued.add(key); }
        }
        const target = `/opt/neural-labs/skills/${record.key}`;
        mounts.push({ source: directory, target });
        await symlink(target, path.join(discovery, record.key));
        available.set(record.key, { target, userInvocable: !/^user-invocable:\s*false\s*$/m.test(document) });
        packages.push({ key: record.key, source: record.path, files, changes: [] });
      }
      const checked = new Set();
      function checkDependencies(key, visiting = new Set()) {
        if (visiting.has(key)) throw new Error(`Cyclic skill dependency: ${key}`);
        if (checked.has(key)) return;
        if (!available.has(key)) throw new Error(`Required skill is unavailable: ${key}`);
        visiting.add(key);
        for (const dependency of dependencies.get(key) || []) checkDependencies(dependency, visiting);
        visiting.delete(key); checked.add(key);
      }
      // Missing/cyclic dependencies on unselected packages do not prevent chat.
      // Selected packages need a complete dependency graph in both modes.
      for (const key of requested) if (available.has(key)) checkDependencies(key);
      const instructions = [];
      for (const key of requested) {
        const skill = available.get(key);
        if (!skill) continue; // Dollar-prefixed shell variables are not skills.
        if (!skill.userInvocable) throw new Error(`Skill ${key} does not allow manual invocation`);
        instructions.push({ skill: key, instruction: `${skill.target}/SKILL.md` });
      }
      const invocation = provider === "codex"
        ? instructions.map(row => ({ type: "skill", name: row.skill, path: row.instruction }))
        : instructions.length ? [{ type: "text", text: `Neural Labs skill selections: ${JSON.stringify(instructions)}. Read each selected SKILL.md and resolve its supporting files relative to its package directory. These selections do not change the execution permissions.` }] : [];
      return { mounts, discovery, packages, release,
        input: invocation.length ? [...input, ...invocation] : input };
    } catch (error) { await release(); throw error; }
  }
}
