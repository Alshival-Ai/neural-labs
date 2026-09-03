import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const METADATA_FILE = ".neural-labs.json";
const SKILL_FILE = "SKILL.md";
const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_INSTRUCTIONS_BYTES = 128 * 1024;
const MAX_TEXT_FILE_BYTES = 1024 * 1024;
const MAX_PACKAGE_FILES = 200;
const MAX_PACKAGE_BYTES = 100 * 1024 * 1024;
const PACKAGE_PATH = /^(?:SKILL\.md|agents\/openai\.yaml|references\/[A-Za-z0-9][A-Za-z0-9._/-]*|scripts\/[A-Za-z0-9][A-Za-z0-9._/-]*|assets\/[A-Za-z0-9][A-Za-z0-9._/-]*)$/;
const FORBIDDEN_PACKAGE_PATH = /(^|\/)(?:\.env(?:\.|$)|\.ssh|credentials?|secrets?|backups?|\.openclaw|\.codex)(?:\/|$)|\.(?:pem|p12|pfx|key|crt|cer|ovpn|token)$/i;
const CREDENTIAL_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[opusr]_[A-Za-z0-9_]{30,}\b/,
  /\bsk-[A-Za-z0-9_-]{24,}\b/,
];

export class WorkspaceSkillError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "WorkspaceSkillError";
    this.status = status;
    this.code = code;
  }
}

function normalizedText(value, label, maximum) {
  if (typeof value !== "string" || !value.trim()) {
    throw new WorkspaceSkillError(400, "invalid_skill", `${label} is required`);
  }
  const normalized = value.trim();
  if (normalized.length > maximum) {
    throw new WorkspaceSkillError(400, "invalid_skill", `${label} is too long`);
  }
  return normalized;
}

function skillSlug(value) {
  const slug = normalizedText(value, "Name", MAX_NAME_LENGTH)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new WorkspaceSkillError(400, "invalid_skill", "Name must include a letter or number");
  }
  return slug;
}

function validateInstructions(value) {
  const instructions = normalizedText(value, "Instructions", MAX_INSTRUCTIONS_BYTES);
  if (Buffer.byteLength(instructions) > MAX_INSTRUCTIONS_BYTES) {
    throw new WorkspaceSkillError(413, "skill_too_large", "Skill instructions must be 128 KB or smaller");
  }
  if (CREDENTIAL_PATTERNS.some((pattern) => pattern.test(instructions))) {
    throw new WorkspaceSkillError(400, "credential_detected", "Remove credentials or private keys before saving this skill");
  }
  return instructions;
}

function yamlString(value) {
  return JSON.stringify(value);
}

function skillDocument({ slug, description, instructions, scope }) {
  return [
    "---",
    `name: ${slug}`,
    `description: ${yamlString(description)}`,
    "user-invocable: true",
    `disable-model-invocation: ${scope === "personal" ? "true" : "false"}`,
    "metadata:",
    "  neural-labs:",
    `    scope: ${scope}`,
    "---",
    "",
    instructions,
    "",
  ].join("\n");
}

function bodyFromDocument(content) {
  if (!content.startsWith("---\n")) return content.trim();
  const end = content.indexOf("\n---\n", 4);
  return end === -1 ? content.trim() : content.slice(end + 5).trim();
}

function publicRecord(metadata, instructions, directory, actor) {
  return {
    id: metadata.slug,
    key: metadata.slug,
    name: metadata.name,
    description: metadata.description,
    scope: metadata.scope,
    ownerUserId: metadata.ownerUserId,
    ownerDisplayName: metadata.ownerDisplayName,
    ownedByCurrentUser: metadata.ownerUserId === actor.id,
    editable: metadata.ownerUserId === actor.id,
    instructions,
    path: path.join(directory, SKILL_FILE),
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
  };
}

function safePackagePath(value) {
  if (typeof value !== "string") throw new WorkspaceSkillError(400, "invalid_package_path", "A skill package path is required");
  const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.length > 240 || path.posix.normalize(normalized) !== normalized || normalized.split("/").some((part) => !part || part === "." || part === "..") || !PACKAGE_PATH.test(normalized)) {
    throw new WorkspaceSkillError(400, "invalid_package_path", "Skill package files must stay in the supported skill directories");
  }
  if (FORBIDDEN_PACKAGE_PATH.test(normalized)) throw new WorkspaceSkillError(400, "unsafe_package_path", "Credential and private-state files are not allowed in a skill package");
  return normalized;
}

async function writePackage(directory, files) {
  if (!Array.isArray(files) || files.length > MAX_PACKAGE_FILES) throw new WorkspaceSkillError(400, "invalid_package", `A skill package may contain at most ${MAX_PACKAGE_FILES} files`);
  let total = 0;
  const normalized = [];
  for (const candidate of files) {
    const filePath = safePackagePath(candidate?.path);
    const content = Buffer.isBuffer(candidate?.content) ? candidate.content : Buffer.from(typeof candidate?.content === "string" ? candidate.content : "", "utf8");
    if (!content.length && filePath === SKILL_FILE) throw new WorkspaceSkillError(400, "invalid_skill", "SKILL.md cannot be empty");
    if (candidate?.kind !== "asset") {
      const maximum = filePath === SKILL_FILE ? MAX_INSTRUCTIONS_BYTES : MAX_TEXT_FILE_BYTES;
      if (content.length > maximum) throw new WorkspaceSkillError(413, "skill_too_large", `${filePath} is too large`);
      if (CREDENTIAL_PATTERNS.some((pattern) => pattern.test(content.toString("utf8")))) {
        throw new WorkspaceSkillError(400, "credential_detected", `Remove credentials or private keys from ${filePath}`);
      }
    }
    total += content.length;
    if (total > MAX_PACKAGE_BYTES) throw new WorkspaceSkillError(413, "skill_too_large", "The skill package must be 100 MB or smaller");
    normalized.push({ path: filePath, content, kind: candidate?.kind === "asset" ? "asset" : "text" });
  }
  if (!normalized.some((file) => file.path === SKILL_FILE)) throw new WorkspaceSkillError(400, "invalid_skill", "SKILL.md is required");
  for (const file of normalized) {
    const destination = path.join(directory, ...file.path.split("/"));
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o750 });
    await writeFile(destination, file.content, { flag: "wx", mode: file.path.startsWith("scripts/") ? 0o750 : 0o640 });
  }
  return normalized;
}

async function packageFiles(directory, relative = "") {
  const entries = await readdir(path.join(directory, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === METADATA_FILE || entry.isSymbolicLink()) continue;
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (["agents", "references", "scripts", "assets"].includes(child.split("/")[0])) files.push(...await packageFiles(directory, child));
      continue;
    }
    if (!entry.isFile()) continue;
    const filePath = safePackagePath(child);
    const content = await readFile(path.join(directory, ...filePath.split("/")));
    files.push({
      path: filePath,
      kind: filePath.startsWith("assets/") ? "asset" : "text",
      ...(filePath.startsWith("assets/") ? { data: content.toString("base64"), size: content.length } : { content: content.toString("utf8") }),
    });
  }
  return files;
}

async function pathExists(value) {
  try {
    await stat(value);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function assertRoot(root) {
  await mkdir(root, { recursive: true, mode: 0o750 });
  return realpath(root);
}

async function readManagedSkill(directory, actor) {
  try {
    const [directoryInfo, metadataInfo, skillInfo] = await Promise.all([
      lstat(directory),
      lstat(path.join(directory, METADATA_FILE)),
      lstat(path.join(directory, SKILL_FILE)),
    ]);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() ||
        !metadataInfo.isFile() || metadataInfo.isSymbolicLink() ||
        !skillInfo.isFile() || skillInfo.isSymbolicLink()) return undefined;
    const [metadataText, content] = await Promise.all([
      readFile(path.join(directory, METADATA_FILE), "utf8"),
      readFile(path.join(directory, SKILL_FILE), "utf8"),
    ]);
    const metadata = JSON.parse(metadataText);
    if (!metadata || metadata.schema !== "neural-labs.skill.v1" || typeof metadata.slug !== "string") return undefined;
    return publicRecord(metadata, bodyFromDocument(content), directory, actor);
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error?.code) || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

async function listRoot(root, actor) {
  const resolvedRoot = await assertRoot(root);
  const entries = await readdir(resolvedRoot, { withFileTypes: true });
  const records = await Promise.all(entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith(".neural-labs-"))
    .map((entry) => readManagedSkill(path.join(resolvedRoot, entry.name), actor)));
  return records.filter(Boolean);
}

function mapFsError(error) {
  if (error instanceof WorkspaceSkillError) return error;
  if (error?.code === "EEXIST") return new WorkspaceSkillError(409, "skill_exists", "A skill with that name already exists");
  if (error?.code === "ENOENT") return new WorkspaceSkillError(404, "skill_not_found", "Skill not found");
  if (error?.code === "EACCES" || error?.code === "EPERM") return new WorkspaceSkillError(403, "forbidden", "This skill cannot be changed");
  return error;
}

export function createSkillsManager({ personalRoot, teamRoot, instructionRoots = [personalRoot, teamRoot] }) {
  if (!path.isAbsolute(personalRoot) || !path.isAbsolute(teamRoot) || personalRoot === teamRoot) {
    throw new Error("Skill roots must be distinct absolute paths");
  }
  if (!Array.isArray(instructionRoots) || instructionRoots.some((root) => !path.isAbsolute(root))) {
    throw new Error("Skill instruction roots must be absolute paths");
  }

  async function find(slug, actor) {
    const normalizedSlug = skillSlug(slug);
    for (const [scope, root] of [["personal", personalRoot], ["team", teamRoot]]) {
      const directory = path.join(await assertRoot(root), normalizedSlug);
      const record = await readManagedSkill(directory, actor);
      if (record) return { record, directory, scope, root };
    }
    throw new WorkspaceSkillError(404, "skill_not_found", "Skill not found");
  }

  async function list(actor) {
    const [personal, team] = await Promise.all([listRoot(personalRoot, actor), listRoot(teamRoot, actor)]);
    return [...personal, ...team].sort((left, right) => left.name.localeCompare(right.name));
  }

  async function save(actor, input, existingSlug) {
    const name = normalizedText(input?.name, "Name", MAX_NAME_LENGTH);
    const slug = existingSlug ? skillSlug(existingSlug) : skillSlug(name);
    const description = normalizedText(input?.description, "Description", MAX_DESCRIPTION_LENGTH);
    const instructions = validateInstructions(input?.instructions);
    const scope = input?.scope === "team" ? "team" : "personal";
    const now = new Date().toISOString();

    try {
      if (existingSlug) {
        const existing = await find(slug, actor);
        if (!existing.record.editable) throw new WorkspaceSkillError(403, "forbidden", "Only the skill owner can edit this skill");
        const metadata = {
          schema: "neural-labs.skill.v1",
          slug,
          name,
          description,
          scope: existing.scope,
          ownerUserId: existing.record.ownerUserId,
          ownerDisplayName: existing.record.ownerDisplayName,
          createdAt: existing.record.createdAt,
          updatedAt: now,
        };
        await Promise.all([
          writeFile(path.join(existing.directory, SKILL_FILE), skillDocument({ slug, description, instructions, scope: existing.scope }), { mode: 0o640 }),
          writeFile(path.join(existing.directory, METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o640 }),
        ]);
        if (scope !== existing.scope) return share(actor, slug, scope);
        return publicRecord(metadata, instructions, existing.directory, actor);
      }

      const personal = await assertRoot(personalRoot);
      const team = await assertRoot(teamRoot);
      if (await pathExists(path.join(personal, slug)) || await pathExists(path.join(team, slug))) {
        throw new WorkspaceSkillError(409, "skill_exists", "A skill with that name already exists");
      }
      const root = scope === "team" ? team : personal;
      const directory = path.join(root, slug);
      const temporary = path.join(root, `.neural-labs-skill-${randomUUID()}`);
      const metadata = {
        schema: "neural-labs.skill.v1",
        slug,
        name,
        description,
        scope,
        ownerUserId: actor.id,
        ownerDisplayName: actor.displayName,
        createdAt: now,
        updatedAt: now,
      };
      await mkdir(temporary, { mode: 0o750 });
      try {
        await Promise.all([
          writeFile(path.join(temporary, SKILL_FILE), skillDocument({ slug, description, instructions, scope }), { flag: "wx", mode: 0o640 }),
          writeFile(path.join(temporary, METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`, { flag: "wx", mode: 0o640 }),
        ]);
        await rename(temporary, directory);
      } catch (error) {
        await rm(temporary, { recursive: true, force: true });
        throw error;
      }
      return publicRecord(metadata, instructions, directory, actor);
    } catch (error) {
      throw mapFsError(error);
    }
  }

  async function share(actor, rawSlug, nextScope) {
    if (nextScope !== "personal" && nextScope !== "team") {
      throw new WorkspaceSkillError(400, "invalid_scope", "Scope must be personal or team");
    }
    try {
      const slug = skillSlug(rawSlug);
      const existing = await find(slug, actor);
      if (!existing.record.editable) throw new WorkspaceSkillError(403, "forbidden", "Only the skill owner can share this skill");
      if (existing.scope === nextScope) return existing.record;
      const destinationRoot = await assertRoot(nextScope === "team" ? teamRoot : personalRoot);
      const destination = path.join(destinationRoot, slug);
      if (await pathExists(destination)) throw new WorkspaceSkillError(409, "skill_exists", "A skill with that name already exists at that scope");
      const content = await readFile(path.join(existing.directory, SKILL_FILE), "utf8");
      const metadata = {
        schema: "neural-labs.skill.v1",
        slug,
        name: existing.record.name,
        description: existing.record.description,
        scope: nextScope,
        ownerUserId: existing.record.ownerUserId,
        ownerDisplayName: existing.record.ownerDisplayName,
        createdAt: existing.record.createdAt,
        updatedAt: new Date().toISOString(),
      };
      await writeFile(path.join(existing.directory, SKILL_FILE), skillDocument({
        slug,
        description: metadata.description,
        instructions: bodyFromDocument(content),
        scope: nextScope,
      }), { mode: 0o640 });
      await writeFile(path.join(existing.directory, METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o640 });
      await rename(existing.directory, destination);
      return publicRecord(metadata, bodyFromDocument(content), destination, actor);
    } catch (error) {
      throw mapFsError(error);
    }
  }

  async function readPackage(actor, rawSlug) {
    const existing = await find(rawSlug, actor);
    return { skill: existing.record, files: await packageFiles(existing.directory) };
  }

  async function readInstruction(rawPath) {
    if (typeof rawPath !== "string" || !rawPath.trim() || rawPath.length > 4096 || !path.isAbsolute(rawPath)) {
      throw new WorkspaceSkillError(400, "invalid_skill_path", "A valid absolute SKILL.md path is required");
    }
    const requested = path.resolve(rawPath);
    if (path.basename(requested) !== SKILL_FILE) {
      throw new WorkspaceSkillError(400, "invalid_skill_path", "Only SKILL.md instructions can be read here");
    }
    try {
      const [resolved, info, allowedRoots] = await Promise.all([
        realpath(requested),
        lstat(requested),
        Promise.all(instructionRoots.map(async (root) => {
          try { return await realpath(root); }
          catch (error) { if (error?.code === "ENOENT") return undefined; throw error; }
        })),
      ]);
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_INSTRUCTIONS_BYTES) {
        throw new WorkspaceSkillError(400, "invalid_skill_file", "The skill instructions are not a readable SKILL.md file");
      }
      if (!allowedRoots.some((root) => root && isPathInside(root, resolved))) {
        throw new WorkspaceSkillError(403, "skill_path_not_allowed", "That Skill is outside the readable workspace skill roots");
      }
      const content = await readFile(resolved, "utf8");
      if (CREDENTIAL_PATTERNS.some((pattern) => pattern.test(content))) {
        throw new WorkspaceSkillError(403, "credential_detected", "This Skill cannot be shown because it appears to contain credential material");
      }
      return { path: requested, sizeBytes: Buffer.byteLength(content), content };
    } catch (error) {
      throw mapFsError(error);
    }
  }

  async function savePackage(actor, input, existingSlug) {
    const fields = input?.fields && typeof input.fields === "object" ? input.fields : {};
    const name = normalizedText(fields.name || fields.displayName, "Name", MAX_NAME_LENGTH);
    const slug = existingSlug ? skillSlug(existingSlug) : skillSlug(fields.slug || name);
    const description = normalizedText(fields.description, "Description", MAX_DESCRIPTION_LENGTH);
    const scope = fields.scope === "team" ? "team" : "personal";
    const now = new Date().toISOString();
    let previous;
    if (existingSlug) {
      previous = await find(slug, actor);
      if (previous.record.ownerUserId !== actor.id) throw new WorkspaceSkillError(403, "forbidden", "Duplicate this skill before editing it");
    } else {
      const [personal, team] = await Promise.all([assertRoot(personalRoot), assertRoot(teamRoot)]);
      if (await pathExists(path.join(personal, slug)) || await pathExists(path.join(team, slug))) throw new WorkspaceSkillError(409, "skill_exists", "A skill with that name already exists");
    }
    const root = await assertRoot(scope === "team" ? teamRoot : personalRoot);
    const destination = path.join(root, slug);
    if (previous && previous.directory !== destination && await pathExists(destination)) {
      throw new WorkspaceSkillError(409, "skill_exists", "A skill with that name already exists at that scope");
    }
    const temporary = path.join(root, `.neural-labs-skill-${randomUUID()}`);
    const backup = path.join(previous?.root ?? root, `.neural-labs-skill-backup-${randomUUID()}`);
    const metadata = {
      schema: "neural-labs.skill.v1",
      slug,
      name,
      description,
      scope,
      ownerUserId: previous?.record.ownerUserId ?? actor.id,
      ownerDisplayName: previous?.record.ownerDisplayName ?? actor.displayName,
      createdAt: previous?.record.createdAt ?? now,
      updatedAt: now,
    };
    await mkdir(temporary, { mode: 0o750 });
    let movedPrevious = false;
    let installed = false;
    try {
      const normalized = await writePackage(temporary, input?.files);
      await writeFile(path.join(temporary, METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`, { flag: "wx", mode: 0o640 });
      if (previous) {
        await rename(previous.directory, backup);
        movedPrevious = true;
      }
      await rename(temporary, destination);
      installed = true;
      if (movedPrevious) await rm(backup, { recursive: true, force: true }).catch(() => undefined);
      const skillContent = normalized.find((file) => file.path === SKILL_FILE)?.content.toString("utf8") ?? "";
      return publicRecord(metadata, bodyFromDocument(skillContent), destination, actor);
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      if (movedPrevious) {
        if (installed) await rm(destination, { recursive: true, force: true });
        if (await pathExists(backup)) await rename(backup, previous.directory);
      }
      throw mapFsError(error);
    }
  }

  return { list, save, share, readPackage, readInstruction, savePackage };
}

export function workspaceSkillActorId(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function workspaceSkillActor(headers) {
  const id = typeof headers["x-forwarded-user"] === "string" ? headers["x-forwarded-user"].trim() : "";
  if (!id) return undefined;
  const email = typeof headers["x-neural-labs-email"] === "string" ? headers["x-neural-labs-email"].trim() : "";
  const displayName = email ? email.split("@")[0] : "Workspace user";
  return {
    id: workspaceSkillActorId(id),
    userId: id,
    displayName,
    role: headers["x-neural-labs-role"] === "admin" ? "admin" : "user",
  };
}
