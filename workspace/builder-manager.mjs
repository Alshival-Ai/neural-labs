import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import { WebSocketServer } from "ws";

import { workspaceSkillActor } from "./skills-manager.mjs";

export const BUILDER_SOCKET_PATH = "/workspace/builder/socket";
export const BUILDER_SOCKET_PROTOCOL = "neural-labs-builder-v1";

const MANIFEST_FILE = "manifest.json";
const STATE_FILE = "state.bin";
const BLOBS_DIRECTORY = "blobs";
const MAX_DRAFTS = 100;
const MAX_TEXT_FILES = 200;
const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_SKILL_BYTES = 128 * 1024;
const MAX_ASSET_BYTES = 25 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 100 * 1024 * 1024;

const AUTOMATION_DEFAULTS = {
  name: "",
  description: "",
  scheduleKind: "cron",
  scheduleValue: "0 9 * * 1-5",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  triggerScript: "",
  pacingMin: "",
  pacingMax: "",
  payloadKind: "agentTurn",
  payload: "",
  skillKey: "",
  skillPrompt: "",
  workingDirectory: "/home/node/workspace",
  sessionTarget: "isolated",
  wakeMode: "now",
  agent: "main",
  deliveryMode: "none",
  channel: "last",
  target: "",
  model: "Workspace default",
  thinking: "low",
  tools: "",
  timeoutSeconds: "600",
  failureAlertAfter: "3",
};

const FORBIDDEN_PATH = /(^|\/)(?:\.env(?:\.|$)|\.ssh|credentials?|secrets?|backups?|\.openclaw|\.codex)(?:\/|$)|\.(?:pem|p12|pfx|key|crt|cer|ovpn|token)$/i;
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
];

export class BuilderError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "BuilderError";
    this.status = status;
    this.code = code;
  }
}

function validDraftId(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)) {
    throw new BuilderError(400, "invalid_draft", "A valid builder draft is required");
  }
  return value;
}

function safeRelativePath(value, kind = "text") {
  if (typeof value !== "string") throw new BuilderError(400, "invalid_path", "A package path is required");
  const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.length > 240 || path.posix.normalize(normalized) !== normalized || normalized.split("/").some((part) => part === ".." || part === "." || !part)) {
    throw new BuilderError(400, "invalid_path", "Package paths must stay inside the skill folder");
  }
  if (FORBIDDEN_PATH.test(normalized)) throw new BuilderError(400, "unsafe_path", "Credential and private-state paths are not allowed in a skill package");
  if (kind === "asset" && !normalized.startsWith("assets/")) throw new BuilderError(400, "invalid_asset_path", "Assets must be stored below assets/");
  if (kind === "text" && normalized !== "SKILL.md" && normalized !== "agents/openai.yaml" && !/^(?:references|scripts)\//.test(normalized)) {
    throw new BuilderError(400, "invalid_package_path", "Text files belong in SKILL.md, agents/, references/, or scripts/");
  }
  return normalized;
}

function text(value, maximum = 500) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function slugForName(value) {
  return text(value, 80)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

function yamlString(value) {
  return JSON.stringify(value);
}

function skillSource({ name, description, scope }) {
  const slug = slugForName(name || "new-skill") || "new-skill";
  return [
    "---",
    `name: ${slug}`,
    `description: ${yamlString(description || "Explain what this skill does and when to use it.")}`,
    "user-invocable: true",
    `disable-model-invocation: ${scope === "team" ? "false" : "true"}`,
    "metadata:",
    "  neural-labs:",
    `    scope: ${scope === "team" ? "team" : "personal"}`,
    "---",
    "",
    `# ${name || "New skill"}`,
    "",
    "Explain the reusable workflow, important constraints, and expected result.",
    "",
  ].join("\n");
}

function openAiSource({ name }) {
  const slug = slugForName(name || "new-skill") || "new-skill";
  return [
    "interface:",
    `  display_name: ${yamlString(name || "New skill")}`,
    `  short_description: ${yamlString("A reusable Neural Labs workflow")}`,
    `  default_prompt: ${yamlString(`Use $${slug} to complete this task.`)}`,
    "policy:",
    "  allow_implicit_invocation: false",
    "",
  ].join("\n");
}

function setYText(map, key, value) {
  const shared = new Y.Text();
  shared.insert(0, String(value ?? ""));
  map.set(key, shared);
}

function yTextValue(value) {
  return value instanceof Y.Text ? value.toString() : "";
}

function createDocument(kind, initial = {}) {
  const doc = new Y.Doc();
  const fields = doc.getMap("fields");
  const flags = doc.getMap("flags");
  const files = doc.getMap("files");
  const assets = doc.getMap("assets");

  if (kind === "skill") {
    const name = text(initial.name, 80);
    const description = text(initial.description, 500);
    const scope = initial.scope === "team" ? "team" : "personal";
    const slug = text(initial.key, 64) || slugForName(name);
    for (const [key, value] of Object.entries({
      name,
      slug,
      description,
      scope,
      displayName: name,
      shortDescription: description.slice(0, 64),
      brandColor: "#7B4DFF",
      defaultPrompt: `Use $${slug || "new-skill"} to complete this task.`,
      iconSmall: "",
      iconLarge: "",
      dependencies: "",
    })) setYText(fields, key, value);
    flags.set("allowImplicitInvocation", scope === "team");
    const generatedSkill = skillSource({ name, description, scope });
    const generatedHeaderEnd = generatedSkill.indexOf("\n---\n", 4);
    const skillDocument = initial.skillSource || (typeof initial.instructions === "string" && generatedHeaderEnd >= 0
      ? `${generatedSkill.slice(0, generatedHeaderEnd + 5)}\n${initial.instructions.trim()}\n`
      : generatedSkill);
    files.set("SKILL.md", new Y.Text(skillDocument));
    files.set("agents/openai.yaml", new Y.Text(initial.openAiSource || openAiSource({ name })));
    if (Array.isArray(initial.files)) {
      for (const candidate of initial.files) {
        if (!candidate || candidate.kind === "asset" || typeof candidate.path !== "string" || typeof candidate.content !== "string") continue;
        const filePath = safeRelativePath(candidate.path, "text");
        files.set(filePath, new Y.Text(candidate.content));
      }
    }
    assets.set("version", 1);
  } else {
    const values = { ...AUTOMATION_DEFAULTS, ...initial };
    for (const [key, value] of Object.entries(values)) setYText(fields, key, value);
    flags.set("exact", initial.exact === true);
  }
  return doc;
}

function manifestTitle(manifest, doc) {
  const name = yTextValue(doc.getMap("fields").get("name")).trim();
  return name || (manifest.kind === "skill" ? "Untitled skill" : "Untitled automation");
}

function actorKey(actor) {
  return actor.userId || actor.id;
}

function publicManifest(manifest, doc, actor) {
  return {
    id: manifest.id,
    kind: manifest.kind,
    title: manifestTitle(manifest, doc),
    ownerUserId: manifest.ownerUserId,
    ownerDisplayName: manifest.ownerDisplayName,
    collaboratorUserIds: [...manifest.collaboratorUserIds],
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
    publishedAt: manifest.publishedAt,
    publishedKey: manifest.publishedKey,
    targetKey: manifest.targetKey,
    baseRevision: manifest.baseRevision,
    canPublish: manifest.ownerUserId === actorKey(actor) || actor.role === "admin",
    canManageCollaborators: manifest.ownerUserId === actorKey(actor) || actor.role === "admin",
    administrator: actor.role === "admin",
  };
}

function canAccess(manifest, actor) {
  return actor.role === "admin" || manifest.ownerUserId === actorKey(actor) || manifest.collaboratorUserIds.includes(actorKey(actor));
}

function assertCanAccess(manifest, actor) {
  if (!canAccess(manifest, actor)) throw new BuilderError(403, "forbidden", "You are not a collaborator on this draft");
}

function assertCanPublish(manifest, actor) {
  assertCanAccess(manifest, actor);
  if (manifest.kind === "automation" && actor.role !== "admin") throw new BuilderError(403, "administrator_required", "Only administrators can publish automations");
  if (manifest.ownerUserId !== actorKey(actor) && actor.role !== "admin") throw new BuilderError(403, "owner_required", "Only the draft owner or an administrator can publish it");
}

function issue(level, code, message, file) {
  return { level, code, message, ...(file ? { file } : {}) };
}

function parseSkillHeader(source) {
  if (!source.startsWith("---\n")) return {};
  const end = source.indexOf("\n---\n", 4);
  if (end < 0) return {};
  const header = source.slice(4, end);
  const name = header.match(/^name:\s*["']?([^\n"']+)["']?\s*$/m)?.[1]?.trim();
  const rawDescription = header.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  let description = rawDescription;
  if (rawDescription?.startsWith('"')) {
    try { description = JSON.parse(rawDescription); } catch {}
  }
  return { name, description };
}

function collectSkillPackage(room) {
  const files = [];
  let packageBytes = 0;
  for (const [rawPath, value] of room.doc.getMap("files")) {
    const filePath = safeRelativePath(rawPath, "text");
    if (!(value instanceof Y.Text)) throw new BuilderError(400, "invalid_package", `${filePath} is not editable text`);
    const content = value.toString();
    const maximum = filePath === "SKILL.md" ? MAX_SKILL_BYTES : MAX_TEXT_BYTES;
    const contentBytes = Buffer.byteLength(content);
    if (contentBytes > maximum) throw new BuilderError(413, "file_too_large", `${filePath} is too large`);
    packageBytes += contentBytes;
    files.push({ path: filePath, content, kind: "text" });
  }
  if (packageBytes > MAX_PACKAGE_BYTES) throw new BuilderError(413, "package_too_large", "The draft package exceeds 100 MB");
  return files;
}

function collectAssetDescriptors(room) {
  const assets = [];
  let packageBytes = collectSkillPackage(room).reduce((sum, file) => sum + Buffer.byteLength(file.content), 0);
  for (const [rawPath, descriptor] of room.doc.getMap("assets")) {
    if (rawPath === "version") continue;
    const assetPath = safeRelativePath(rawPath, "asset");
    if (!descriptor || typeof descriptor !== "object" || !/^[0-9a-f]{64}$/.test(descriptor.hash)
      || !Number.isSafeInteger(descriptor.size) || descriptor.size <= 0 || descriptor.size > MAX_ASSET_BYTES
      || typeof descriptor.mimeType !== "string" || descriptor.mimeType.length > 160) {
      throw new BuilderError(400, "invalid_asset", `${assetPath} has an invalid asset descriptor`);
    }
    packageBytes += descriptor.size;
    assets.push({ path: assetPath, ...descriptor });
  }
  if (packageBytes > MAX_PACKAGE_BYTES) throw new BuilderError(413, "package_too_large", "The draft package exceeds 100 MB");
  return assets;
}

function validateSkill(room) {
  const issues = [];
  const files = collectSkillPackage(room);
  const skill = files.find((file) => file.path === "SKILL.md");
  if (!skill) return [issue("error", "missing_skill", "SKILL.md is required")];
  const header = parseSkillHeader(skill.content);
  if (!header.name || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(header.name)) issues.push(issue("error", "invalid_name", "Frontmatter name must be a lowercase hyphenated skill name", "SKILL.md"));
  if (!header.description || header.description.length > 500) issues.push(issue("error", "invalid_description", "Frontmatter description is required and must be at most 500 characters", "SKILL.md"));
  const fieldSlug = yTextValue(room.doc.getMap("fields").get("slug")).trim();
  const expectedSlug = room.manifest.targetKey || fieldSlug;
  if (header.name && expectedSlug && header.name !== expectedSlug) issues.push(issue("error", "name_mismatch", `SKILL.md name must remain ${expectedSlug}`, "SKILL.md"));
  for (const file of files) if (SECRET_PATTERNS.some((pattern) => pattern.test(file.content))) issues.push(issue("error", "credential_detected", `Remove credential-shaped content from ${file.path}`, file.path));
  const openai = files.find((file) => file.path === "agents/openai.yaml");
  if (openai) {
    const lineValue = (key) => {
      const raw = openai.content.match(new RegExp(`^\\s+${key}:\\s*(.+)$`, "m"))?.[1]?.trim();
      if (!raw) return "";
      try { return JSON.parse(raw); } catch { return raw.replace(/^['"]|['"]$/g, ""); }
    };
    const shortDescription = lineValue("short_description");
    const defaultPrompt = lineValue("default_prompt");
    const brandColor = lineValue("brand_color");
    if (shortDescription.length < 25 || shortDescription.length > 64) issues.push(issue("error", "invalid_short_description", "Short description must be 25–64 characters", "agents/openai.yaml"));
    if (header.name && !defaultPrompt.includes(`$${header.name}`)) issues.push(issue("error", "invalid_default_prompt", `The default prompt must mention $${header.name}`, "agents/openai.yaml"));
    if (brandColor && !/^#[0-9a-f]{6}$/i.test(brandColor)) issues.push(issue("error", "invalid_brand_color", "Brand color must be a six-digit hex color", "agents/openai.yaml"));
  }
  if (files.length > MAX_TEXT_FILES) issues.push(issue("error", "too_many_files", `A skill package may contain at most ${MAX_TEXT_FILES} text files`));
  return issues;
}

function automationPayload(room) {
  const values = {};
  for (const [key, value] of room.doc.getMap("fields")) values[key] = yTextValue(value);
  values.exact = room.doc.getMap("flags").get("exact") === true;
  if (values.payloadKind === "skill") {
    const key = values.skillKey.trim();
    values.payloadKind = "agentTurn";
    values.payload = [`$${key}`, values.skillPrompt.trim()].filter(Boolean).join("\n\n");
  }
  return values;
}

function validateAutomation(room) {
  const draft = automationPayload(room);
  const issues = [];
  if (!draft.name.trim()) issues.push(issue("error", "missing_name", "Name is required"));
  if (!draft.scheduleValue.trim()) issues.push(issue("error", "missing_schedule", "A schedule value is required"));
  if (!draft.payload.trim()) issues.push(issue("error", "missing_action", "An automation action is required"));
  if (SECRET_PATTERNS.some((pattern) => pattern.test(JSON.stringify(draft)))) issues.push(issue("error", "credential_detected", "Remove credentials from the automation draft"));
  return { draft, issues };
}

async function exists(value) {
  try { await stat(value); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

export function createBuilderManager({ root, publishSkill }) {
  if (!path.isAbsolute(root)) throw new Error("Builder draft root must be absolute");
  const rooms = new Map();
  let closed = false;

  async function ensureRoot() {
    await mkdir(root, { recursive: true, mode: 0o750 });
    return root;
  }

  async function readManifest(id) {
    validDraftId(id);
    const directory = path.join(await ensureRoot(), id);
    try {
      const [directoryInfo, manifestInfo] = await Promise.all([lstat(directory), lstat(path.join(directory, MANIFEST_FILE))]);
      if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || !manifestInfo.isFile() || manifestInfo.isSymbolicLink()) throw new BuilderError(404, "draft_not_found", "Builder draft not found");
      const manifest = JSON.parse(await readFile(path.join(directory, MANIFEST_FILE), "utf8"));
      if (manifest.schema !== "neural-labs.builder-draft.v1" || manifest.id !== id || !["skill", "automation"].includes(manifest.kind)) throw new Error("invalid builder manifest");
      return { manifest, directory };
    } catch (error) {
      if (error instanceof BuilderError) throw error;
      if (["ENOENT", "ENOTDIR"].includes(error?.code)) throw new BuilderError(404, "draft_not_found", "Builder draft not found");
      throw error;
    }
  }

  async function persist(room) {
    if (room.persisting) {
      room.persistAgain = true;
      return room.persisting;
    }
    room.persisting = (async () => {
      room.manifest.updatedAt = new Date().toISOString();
      const marker = randomUUID();
      const stateTemporary = path.join(room.directory, `${STATE_FILE}.${marker}.tmp`);
      const manifestTemporary = path.join(room.directory, `${MANIFEST_FILE}.${marker}.tmp`);
      await Promise.all([
        writeFile(stateTemporary, Buffer.from(Y.encodeStateAsUpdate(room.doc)), { mode: 0o640 }),
        writeFile(manifestTemporary, `${JSON.stringify(room.manifest, null, 2)}\n`, { mode: 0o640 }),
      ]);
      await Promise.all([rename(stateTemporary, path.join(room.directory, STATE_FILE)), rename(manifestTemporary, path.join(room.directory, MANIFEST_FILE))]);
    })().finally(() => { room.persisting = undefined; });
    await room.persisting;
    if (room.persistAgain) {
      room.persistAgain = false;
      return persist(room);
    }
  }

  function schedulePersist(room) {
    clearTimeout(room.persistTimer);
    room.persistTimer = setTimeout(() => void persist(room), 350);
    room.persistTimer.unref?.();
  }

  async function openRoom(id) {
    if (rooms.has(id)) return rooms.get(id);
    const { manifest, directory } = await readManifest(id);
    const doc = new Y.Doc();
    const state = await readFile(path.join(directory, STATE_FILE));
    Y.applyUpdate(doc, state, "disk");
    const room = { manifest, directory, doc, awareness: new Awareness(doc), clients: new Set(), persistTimer: undefined, persisting: undefined, persistAgain: false };
    doc.on("update", (update, origin) => {
      if (origin === "disk") return;
      schedulePersist(room);
      broadcast(room, { type: "update", update: Buffer.from(update).toString("base64") }, room.clients.has(origin) ? origin : undefined);
    });
    rooms.set(id, room);
    return room;
  }

  async function list(actor) {
    const base = await ensureRoot();
    const entries = await readdir(base, { withFileTypes: true });
    const results = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      try {
        const room = await openRoom(entry.name);
        if (canAccess(room.manifest, actor)) results.push(publicManifest(room.manifest, room.doc, actor));
      } catch {}
    }
    return results.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async function create(actor, input = {}) {
    const existingDrafts = await list(actor);
    if (existingDrafts.length >= MAX_DRAFTS && actor.role !== "admin") throw new BuilderError(429, "too_many_drafts", "Discard an older draft before creating another one");
    const kind = input.kind === "automation" ? "automation" : "skill";
    if (kind === "automation" && actor.role !== "admin") throw new BuilderError(403, "administrator_required", "Only administrators can create automation drafts");
    const id = randomUUID();
    const now = new Date().toISOString();
    const manifest = {
      schema: "neural-labs.builder-draft.v1",
      id,
      kind,
      ownerUserId: actorKey(actor),
      ownerDisplayName: actor.displayName,
      collaboratorUserIds: [],
      targetKey: text(input.targetKey, 64) || undefined,
      baseRevision: text(input.baseRevision, 128) || undefined,
      createdAt: now,
      updatedAt: now,
    };
    const directory = path.join(await ensureRoot(), id);
    await mkdir(path.join(directory, BLOBS_DIRECTORY), { recursive: true, mode: 0o750 });
    const doc = createDocument(kind, input.initial && typeof input.initial === "object" ? input.initial : {});
    await Promise.all([
      writeFile(path.join(directory, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o640 }),
      writeFile(path.join(directory, STATE_FILE), Buffer.from(Y.encodeStateAsUpdate(doc)), { flag: "wx", mode: 0o640 }),
    ]);
    doc.destroy();
    const room = await openRoom(id);
    return publicManifest(manifest, room.doc, actor);
  }

  async function get(actor, id) {
    const room = await openRoom(validDraftId(id));
    assertCanAccess(room.manifest, actor);
    return { draft: publicManifest(room.manifest, room.doc, actor), update: Buffer.from(Y.encodeStateAsUpdate(room.doc)).toString("base64") };
  }

  async function collaborators(actor, id, rawIds) {
    const room = await openRoom(validDraftId(id));
    assertCanAccess(room.manifest, actor);
    if (room.manifest.ownerUserId !== actorKey(actor) && actor.role !== "admin") throw new BuilderError(403, "owner_required", "Only the owner or an administrator can manage collaborators");
    if (!Array.isArray(rawIds) || rawIds.length > 50) throw new BuilderError(400, "invalid_collaborators", "Choose up to 50 collaborators");
    room.manifest.collaboratorUserIds = [...new Set(rawIds.flatMap((value) => typeof value === "string" && /^[A-Za-z0-9-]{1,128}$/.test(value) ? [value] : []))].filter((value) => value !== room.manifest.ownerUserId);
    await persist(room);
    for (const socket of room.clients) {
      if (!canAccess(room.manifest, socket.builderActor)) socket.close(4003, "Draft access removed");
      else socket.send(JSON.stringify({ type: "draft", draft: publicManifest(room.manifest, room.doc, socket.builderActor) }));
    }
    return publicManifest(room.manifest, room.doc, actor);
  }

  async function discard(actor, id) {
    const room = await openRoom(validDraftId(id));
    assertCanAccess(room.manifest, actor);
    if (room.manifest.ownerUserId !== actorKey(actor) && actor.role !== "admin") throw new BuilderError(403, "owner_required", "Only the owner or an administrator can discard this draft");
    for (const socket of room.clients) socket.close(4004, "Draft discarded");
    clearTimeout(room.persistTimer);
    room.doc.destroy();
    rooms.delete(id);
    await rm(room.directory, { recursive: true, force: true });
  }

  async function saveAsset(actor, id, input = {}) {
    const room = await openRoom(validDraftId(id));
    assertCanAccess(room.manifest, actor);
    if (room.manifest.kind !== "skill") throw new BuilderError(400, "invalid_draft_kind", "Automation drafts do not contain package assets");
    const assetPath = safeRelativePath(input.path, "asset");
    if (typeof input.data !== "string") throw new BuilderError(400, "invalid_asset", "Asset data is required");
    const data = Buffer.from(input.data, "base64");
    if (!data.length || data.length > MAX_ASSET_BYTES) throw new BuilderError(413, "asset_too_large", `Assets must be ${MAX_ASSET_BYTES / 1024 / 1024} MB or smaller`);
    const currentAssets = collectAssetDescriptors(room);
    const existingAsset = currentAssets.find((asset) => asset.path === assetPath);
    const currentSize = currentAssets.reduce((sum, value) => sum + value.size, 0);
    if (currentSize - (typeof existingAsset?.size === "number" ? existingAsset.size : 0) + data.length > MAX_PACKAGE_BYTES) throw new BuilderError(413, "package_too_large", "The draft package exceeds 100 MB");
    const hash = createHash("sha256").update(data).digest("hex");
    const blobPath = path.join(room.directory, BLOBS_DIRECTORY, hash);
    if (!await exists(blobPath)) await writeFile(blobPath, data, { flag: "wx", mode: 0o640 }).catch((error) => { if (error?.code !== "EEXIST") throw error; });
    room.doc.transact(() => room.doc.getMap("assets").set(assetPath, { hash, size: data.length, mimeType: text(input.mimeType, 160) || "application/octet-stream" }), "asset");
    broadcast(room, { type: "asset", action: "saved", path: assetPath });
    await persist(room);
    return { path: assetPath, hash, size: data.length, mimeType: text(input.mimeType, 160) || "application/octet-stream" };
  }

  async function removeAsset(actor, id, rawPath) {
    const room = await openRoom(validDraftId(id));
    assertCanAccess(room.manifest, actor);
    const assetPath = safeRelativePath(rawPath, "asset");
    room.doc.transact(() => room.doc.getMap("assets").delete(assetPath), "asset");
    broadcast(room, { type: "asset", action: "removed", path: assetPath });
    await persist(room);
  }

  async function validate(actor, id) {
    const room = await openRoom(validDraftId(id));
    assertCanAccess(room.manifest, actor);
    const result = room.manifest.kind === "skill" ? { issues: validateSkill(room) } : validateAutomation(room);
    return { kind: room.manifest.kind, revision: createHash("sha256").update(Y.encodeStateAsUpdate(room.doc)).digest("hex"), ...result };
  }

  async function publish(actor, id) {
    const room = await openRoom(validDraftId(id));
    assertCanPublish(room.manifest, actor);
    if (room.manifest.kind === "automation") {
      const result = validateAutomation(room);
      if (result.issues.some((item) => item.level === "error")) throw new BuilderError(422, "invalid_draft", result.issues[0].message);
      return { kind: "automation", draft: result.draft, targetKey: room.manifest.targetKey, baseRevision: room.manifest.baseRevision, revision: createHash("sha256").update(Y.encodeStateAsUpdate(room.doc)).digest("hex") };
    }
    const issues = validateSkill(room);
    if (issues.some((item) => item.level === "error")) throw new BuilderError(422, "invalid_draft", issues[0].message);
    if (typeof publishSkill !== "function") throw new BuilderError(503, "publisher_unavailable", "Skill publishing is unavailable");
    const fields = {};
    for (const [key, value] of room.doc.getMap("fields")) fields[key] = yTextValue(value);
    const files = collectSkillPackage(room);
    for (const descriptor of collectAssetDescriptors(room)) {
      const blobPath = path.join(room.directory, BLOBS_DIRECTORY, descriptor.hash);
      const blobInfo = await lstat(blobPath).catch(() => undefined);
      if (!blobInfo?.isFile() || blobInfo.isSymbolicLink() || blobInfo.size !== descriptor.size) throw new BuilderError(400, "invalid_asset", `${descriptor.path} is missing or invalid`);
      files.push({ path: descriptor.path, content: await readFile(blobPath), kind: "asset", mimeType: descriptor.mimeType });
    }
    const published = await publishSkill(actor, { fields, files }, room.manifest.targetKey);
    room.manifest.publishedAt = new Date().toISOString();
    room.manifest.publishedKey = published.key;
    room.manifest.targetKey = published.key;
    room.manifest.baseRevision = published.updatedAt;
    await persist(room);
    return { kind: "skill", skill: published, draft: publicManifest(room.manifest, room.doc, actor) };
  }

  async function finalizeAutomation(actor, id, input = {}) {
    const room = await openRoom(validDraftId(id));
    assertCanPublish(room.manifest, actor);
    if (room.manifest.kind !== "automation") throw new BuilderError(400, "invalid_draft_kind", "This is not an automation draft");
    room.manifest.publishedAt = new Date().toISOString();
    room.manifest.publishedKey = text(input.jobId, 160) || room.manifest.targetKey;
    room.manifest.targetKey = room.manifest.publishedKey;
    room.manifest.baseRevision = text(input.configRevision, 160) || room.manifest.baseRevision;
    await persist(room);
    return publicManifest(room.manifest, room.doc, actor);
  }

  async function testSnapshot(actor, id, input = {}) {
    const room = await openRoom(validDraftId(id));
    assertCanAccess(room.manifest, actor);
    if (room.manifest.kind !== "skill") throw new BuilderError(400, "invalid_draft_kind", "Only skill drafts can be tested in Neura");
    const issues = validateSkill(room);
    const revision = createHash("sha256").update(Y.encodeStateAsUpdate(room.doc)).digest("hex");
    const packageText = collectSkillPackage(room).map((file) => `## ${file.path}\n\n${file.content}`).join("\n\n").slice(0, 256 * 1024);
    const prompt = text(input.prompt, 16_000);
    if (!prompt) throw new BuilderError(400, "invalid_test", "Write a prompt for the Neura test");
    return {
      id: randomUUID(),
      revision,
      prompt,
      harness: `Test the unpublished skill snapshot below. Follow its instructions for the test request, but do not install or modify the live skill catalog.\n\n${packageText}\n\n# Test request\n\n${prompt}`,
      createdAt: new Date().toISOString(),
    };
  }

  function broadcast(room, payload, except) {
    const value = JSON.stringify(payload);
    for (const socket of room.clients) if (socket !== except && socket.readyState === socket.OPEN) socket.send(value);
  }

  async function connect(actor, id, socket) {
    const room = await openRoom(validDraftId(id));
    assertCanAccess(room.manifest, actor);
    socket.builderActor = actor;
    room.clients.add(socket);
    socket.send(JSON.stringify({ type: "sync", update: Buffer.from(Y.encodeStateAsUpdate(room.doc)).toString("base64"), draft: publicManifest(room.manifest, room.doc, actor) }));
    const awarenessClients = [...room.awareness.getStates().keys()];
    if (awarenessClients.length) socket.send(JSON.stringify({ type: "awareness", update: Buffer.from(encodeAwarenessUpdate(room.awareness, awarenessClients)).toString("base64") }));
    socket.on("message", (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        if (message.type === "update" && typeof message.update === "string") {
          const update = Buffer.from(message.update, "base64");
          Y.applyUpdate(room.doc, update, socket);
          return;
        }
        if (message.type === "awareness" && typeof message.update === "string") {
          if (Number.isSafeInteger(message.clientId)) socket.builderClientId = message.clientId;
          applyAwarenessUpdate(room.awareness, Buffer.from(message.update, "base64"), socket);
          broadcast(room, { type: "awareness", update: message.update }, socket);
          return;
        }
        if (message.type === "test" && message.test && typeof message.test === "object") {
          broadcast(room, { type: "test", test: message.test }, undefined);
        }
      } catch {
        socket.send(JSON.stringify({ type: "error", message: "Invalid builder message" }));
      }
    });
    socket.once("close", () => {
      room.clients.delete(socket);
      if (Number.isSafeInteger(socket.builderClientId)) {
        removeAwarenessStates(room.awareness, [socket.builderClientId], socket);
        broadcast(room, { type: "awareness", update: Buffer.from(encodeAwarenessUpdate(room.awareness, [socket.builderClientId])).toString("base64") });
      }
    });
  }

  async function close() {
    if (closed) return;
    closed = true;
    for (const room of rooms.values()) {
      clearTimeout(room.persistTimer);
      for (const socket of room.clients) socket.close(1001, "Workspace stopping");
      await persist(room);
      room.awareness.destroy();
      room.doc.destroy();
    }
    rooms.clear();
  }

  return { list, create, get, collaborators, discard, saveAsset, removeAsset, validate, publish, finalizeAutomation, testSnapshot, connect, close };
}

export function attachBuilderWebSocket(server, { manager, publicOrigin }) {
  const sockets = new Set();
  const socketServer = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
  const onUpgrade = (request, socket, head) => {
    let url;
    try { url = new URL(request.url ?? "/", "http://workspace.local"); } catch { return; }
    if (url.pathname !== BUILDER_SOCKET_PATH) return;
    const actor = workspaceSkillActor(request.headers);
    const protocols = String(request.headers["sec-websocket-protocol"] ?? "").split(",").map((value) => value.trim());
    if (!actor || request.headers.origin !== publicOrigin || !protocols.includes(BUILDER_SOCKET_PROTOCOL)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const draftId = url.searchParams.get("draftId") ?? "";
    void manager.get(actor, draftId).then(() => {
      socketServer.handleUpgrade(request, socket, head, (webSocket) => {
        sockets.add(webSocket);
        webSocket.once("close", () => sockets.delete(webSocket));
        void manager.connect(actor, draftId, webSocket).catch((error) => webSocket.close(4003, error instanceof Error ? error.message.slice(0, 120) : "Builder access denied"));
      });
    }).catch(() => {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
    });
  };
  server.on("upgrade", onUpgrade);
  return {
    close() {
      server.off("upgrade", onUpgrade);
      for (const socket of sockets) socket.close(1001, "Workspace stopping");
      sockets.clear();
      socketServer.close();
    },
  };
}
