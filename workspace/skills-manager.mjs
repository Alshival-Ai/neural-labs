import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const METADATA_FILE = ".neural-labs.json";
const SKILL_FILE = "SKILL.md";
const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_INSTRUCTIONS_BYTES = 128 * 1024;

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
  const credentialPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bgh[opusr]_[A-Za-z0-9_]{30,}\b/,
    /\bsk-[A-Za-z0-9_-]{24,}\b/,
  ];
  if (credentialPatterns.some((pattern) => pattern.test(instructions))) {
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
    editable: metadata.ownerUserId === actor.id || actor.role === "admin",
    instructions,
    path: path.join(directory, SKILL_FILE),
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
  };
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
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
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

export function createSkillsManager({ personalRoot, teamRoot }) {
  if (!path.isAbsolute(personalRoot) || !path.isAbsolute(teamRoot) || personalRoot === teamRoot) {
    throw new Error("Skill roots must be distinct absolute paths");
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

  return { list, save, share };
}

export function workspaceSkillActor(headers) {
  const id = typeof headers["x-forwarded-user"] === "string" ? headers["x-forwarded-user"].trim() : "";
  if (!id) return undefined;
  const email = typeof headers["x-neural-labs-email"] === "string" ? headers["x-neural-labs-email"].trim() : "";
  const displayName = email ? email.split("@")[0] : "Workspace user";
  return {
    id: createHash("sha256").update(id).digest("hex"),
    displayName,
    role: headers["x-neural-labs-role"] === "admin" ? "admin" : "user",
  };
}
