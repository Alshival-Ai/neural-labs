/** Environment-local project domain shared by browser, automation and external transports. */
import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import type { UserRecord } from "./types.js";

export class ProjectError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
export const projectFields = z.object({
  title: z.string().trim().min(1).max(200), body: z.string().max(20000).default(""),
  acceptance: z.string().max(6000).default(""),
  state: z.enum(["todo", "doing", "waiting", "review", "done"]).default("todo"),
  visibility: z.enum(["shared", "internal"]).default("shared"),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  assignee: z.string().uuid().nullable().default(null), reviewer: z.string().uuid().nullable().default(null),
  starts_on: z.iso.date().nullable().default(null), due_on: z.iso.date().nullable().default(null),
  parent_id: z.string().uuid().nullable().default(null),
  color: z.enum(["yellow", "blue", "pink", "green", "orange", "purple", "teal", "gray"]).default("gray"),
  details: z.record(z.string().max(120), z.string().max(2000)).default({}),
  archived: z.boolean().default(false),
}).strict();
export const createProjectItem = z.object({
  idempotency_key: z.string().uuid(), kind: z.enum(["task", "deliverable", "note", "resource", "ticket", "comment"]),
  data: projectFields,
}).strict();
const patchFields = z.object(Object.fromEntries(Object.entries(projectFields.shape).map(([key, field]) =>
  [key, (field instanceof z.ZodDefault ? field.removeDefault() : field).optional()])) as unknown as {
    [K in keyof z.infer<typeof projectFields>]: z.ZodOptional<z.ZodType<z.infer<typeof projectFields>[K]>>
  }).strict();
export const updateProjectItem = z.object({
  idempotency_key: z.string().uuid(), revision: z.number().int().positive(), data: patchFields,
}).strict();
export const projectAction = z.object({
  idempotency_key: z.string().uuid(), revision: z.number().int().positive(),
  action: z.enum(["approve", "changes", "reopen"]),
}).strict();
export type ProjectItem = { id: string; kind: string; revision: number; data: z.infer<typeof projectFields>; author_id: string; created_at: string; updated_at: string };
function requireActive(actor: UserRecord) {
  if (actor.status !== "active") throw new ProjectError(403, "account_inactive", "This account is not active.");
}
export function canReadProjectItem(actor: UserRecord, item: ProjectItem): boolean {
  return actor.status === "active" && (item.data.visibility === "shared" || actor.role === "admin");
}
function readable(actor: UserRecord, item: ProjectItem | undefined): asserts item is ProjectItem {
  if (!item || !canReadProjectItem(actor, item)) throw new ProjectError(404, "item_not_found", "Project item not found.");
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export class ProjectStore {
  constructor(readonly pool: Pool) {}
  async list(actor: UserRecord, after = "", limit = 100): Promise<ProjectItem[]> {
    requireActive(actor);
    return (await this.pool.query(`SELECT * FROM project_items WHERE ($1 OR data->>'visibility'='shared')
      AND id::text > $2 ORDER BY id::text LIMIT $3`, [actor.role === "admin", after, Math.min(100, Math.max(1, limit))])).rows;
  }
  async get(actor: UserRecord, id: string, client: Pool | PoolClient = this.pool): Promise<ProjectItem> {
    requireActive(actor);
    const item = (await client.query("SELECT * FROM project_items WHERE id=$1", [id])).rows[0];
    readable(actor, item); return item;
  }
  async history(actor: UserRecord, id: string) {
    await this.get(actor, id);
    return (await this.pool.query(`SELECT sequence, item_id, actor_id, operation, created_at FROM project_events
      WHERE item_id=$1 ORDER BY sequence DESC LIMIT 100`, [id])).rows;
  }
  async revision(): Promise<string> {
    return String((await this.pool.query("SELECT revision FROM project_storage WHERE singleton")).rows[0].revision);
  }
  async mutate(actor: UserRecord, operation: "create" | "update" | "action", id: string | null, input: unknown): Promise<ProjectItem> {
    requireActive(actor);
    const parsed = operation === "create" ? createProjectItem.parse(input) : operation === "update" ? updateProjectItem.parse(input) : projectAction.parse(input);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const storage = (await client.query("SELECT * FROM project_storage WHERE singleton FOR UPDATE")).rows[0];
      if (storage.state !== "active") throw new ProjectError(423, "project_paused", "Project changes are paused for migration.");
      const fingerprint = digest({ operation, id, parsed });
      const prior = (await client.query("SELECT * FROM project_requests WHERE actor_id=$1 AND request_id=$2", [actor.id, parsed.idempotency_key])).rows[0];
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new ProjectError(409, "idempotency_conflict", "This request identifier was already used.");
        const current = await this.get(actor, prior.item_id, client);
        await client.query("COMMIT"); return current;
      }
      const old = operation === "create" ? undefined : await this.get(actor, id!, client);
      if (old && "revision" in parsed && Number(old.revision) !== parsed.revision)
        throw new ProjectError(409, "revision_conflict", "This item changed. Reload before saving.");
      if (old && ["comment", "note"].includes(old.kind) && old.author_id !== actor.id && actor.role !== "admin")
        throw new ProjectError(403, "author_required", "Only the author or an administrator may edit this note or comment.");
      const data = projectFields.parse({ ...old?.data, ...("data" in parsed ? parsed.data : {}) });
      const kind = "kind" in parsed ? parsed.kind : old!.kind;
      if (data.visibility === "internal" && actor.role !== "admin") throw new ProjectError(403, "internal_access_required", "Administrator access is required.");
      if (data.starts_on && data.due_on && data.starts_on > data.due_on) throw new ProjectError(422, "invalid_dates", "Start date must precede due date.");
      if (data.assignee && data.assignee === data.reviewer) throw new ProjectError(422, "separate_reviewer", "Choose a separate reviewer.");
      for (const userId of [data.assignee, data.reviewer]) {
        if (userId && !(await client.query("SELECT id FROM users WHERE id=$1 AND status='active'", [userId])).rowCount)
          throw new ProjectError(422, "invalid_member", "Select an active member of this environment.");
      }
      if (data.parent_id) {
        if (data.parent_id === id) throw new ProjectError(422, "invalid_parent", "An item cannot contain itself.");
        const parent = await this.get(actor, data.parent_id, client);
        if (parent.data.archived || parent.kind === "comment" || parent.data.parent_id)
          throw new ProjectError(422, "invalid_parent", "Select an open top-level item.");
        if (parent.data.visibility === "internal" && data.visibility !== "internal")
          throw new ProjectError(422, "invalid_visibility", "Internal replies must remain internal.");
      } else if (kind === "comment") throw new ProjectError(422, "parent_required", "A comment requires a project item.");
      if (old && data.visibility !== old.data.visibility && (await client.query("SELECT id FROM project_items WHERE data->>'parent_id'=$1 LIMIT 1", [old.id])).rowCount)
        throw new ProjectError(409, "visibility_has_children", "Update child visibility before changing the parent visibility.");
      if ("action" in parsed) {
        if (parsed.action === "approve") {
          if (old!.data.state !== "review" || actor.id === old!.data.assignee || actor.id === old!.author_id || (actor.role !== "admin" && actor.id !== old!.data.reviewer))
            throw new ProjectError(403, "reviewer_required", "A separate assigned reviewer must accept this work.");
          data.state = "done";
        } else if (parsed.action === "changes") {
          if (actor.role !== "admin" && actor.id !== old!.data.reviewer) throw new ProjectError(403, "reviewer_required", "Reviewer access is required.");
          data.state = "doing";
        } else data.state = "todo";
      }
      const itemId = id ?? randomUUID();
      const result = old ? await client.query(`UPDATE project_items SET data=$2, revision=revision+1, updated_at=now() WHERE id=$1 RETURNING *`, [itemId, data])
        : await client.query(`INSERT INTO project_items(id,kind,data,author_id) VALUES($1,$2,$3,$4) RETURNING *`, [itemId, kind, data, actor.id]);
      await client.query(`INSERT INTO project_requests(actor_id,request_id,fingerprint,item_id) VALUES($1,$2,$3,$4)`, [actor.id, parsed.idempotency_key, fingerprint, itemId]);
      await client.query(`INSERT INTO project_events(item_id,actor_id,operation) VALUES($1,$2,$3)`, [itemId, actor.id, "action" in parsed ? parsed.action : operation]);
      await client.query("UPDATE project_storage SET revision=revision+1 WHERE singleton");
      await client.query("COMMIT"); return result.rows[0];
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
}
