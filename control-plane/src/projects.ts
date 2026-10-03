/** Environment-local project domain shared by browser, automation and external transports. */
import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import type { UserRecord } from "./types.js";
import { ensurePrimaryChannel } from "./teamPrimary.js";

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
  board_id: z.string().uuid().nullable().optional(),
  color: z.enum(["yellow", "blue", "pink", "green", "orange", "purple", "teal", "gray"]).default("gray"),
  details: z.record(z.string().max(120), z.string().max(2000)).default({}),
  archived: z.boolean().default(false),
  deleted: z.boolean().default(false),
  status_id: z.string().uuid().nullable().default(null),
  position: z.object({ x: z.number().min(0).max(100000), y: z.number().min(0).max(100000) }).strict().nullable().default(null),
  resource: z.object({ kind: z.enum(["website", "server", "database", "api", "repository", "domain", "storage", "other"]),
    status: z.enum(["planned", "active", "retired"]), provider: z.string().max(120), environment: z.string().max(80),
    public_url: z.string().max(2048), external_id: z.string().max(200).nullable() }).strict().nullable().default(null),
  publication: z.object({ published: z.boolean(), title: z.string().max(200), body: z.string().max(20000) }).strict().nullable().default(null),
  references: z.record(z.string().max(80), z.string().max(512)).default({}),
  checklist: z.array(z.object({ id: z.string().uuid(), text: z.string().trim().min(1).max(500),
    done: z.boolean() }).strict()).max(100).default([]),

}).strict();
export const createProjectItem = z.object({
  idempotency_key: z.string().uuid(), kind: z.enum(["task", "deliverable", "note", "resource", "ticket", "comment", "board"]),
  sync_id: z.string().uuid().optional(),
  sync_author_id: z.string().uuid().optional(),
  sync_created_at: z.iso.datetime({ offset: true }).optional(),
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
export type ProjectActor = UserRecord & { projectInternal?: boolean; projectPlan?: boolean; projectSync?: boolean };
export const internalAccess = (actor: ProjectActor) => actor.projectInternal ?? actor.role === "admin";
export type ProjectItem = { id: string; kind: string; revision: number; data: z.infer<typeof projectFields>; author_id: string; created_at: string; updated_at: string };
function requireActive(actor: ProjectActor) {
  if (actor.status !== "active") throw new ProjectError(403, "account_inactive", "This account is not active.");
}
export function canReadProjectItem(actor: ProjectActor, item: ProjectItem): boolean {
  return actor.status === "active" && (internalAccess(actor) || (item.data.visibility === "shared" && (!item.data.publication || item.data.publication.published)));
}
export function projectProjection(actor: ProjectActor, item: ProjectItem): ProjectItem {
  if (internalAccess(actor) || !item.data.publication) return item;
  return { ...item, data: { ...item.data, title: item.data.publication.title, body: item.data.publication.body,
    acceptance: "", reviewer: null, publication: null, details: {}, references: {} } };
}
function readable(actor: ProjectActor, item: ProjectItem | undefined): asserts item is ProjectItem {
  if (!item || !canReadProjectItem(actor, item)) throw new ProjectError(404, "item_not_found", "Project item not found.");
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export class ProjectStore {
  constructor(readonly pool: Pool) {}
  private async requireReadable(client: Pool | PoolClient = this.pool) {
    const state = (await client.query("SELECT state FROM project_storage WHERE singleton")).rows[0]?.state;
    if (state !== "active" && state !== "frozen") throw new ProjectError(423, "project_paused", "Project content is unavailable during transfer.");
  }
  async list(actor: ProjectActor, after = "", limit = 100): Promise<ProjectItem[]> {
    requireActive(actor);
    await this.requireReadable();
    return (await this.pool.query(`WITH RECURSIVE hidden(id) AS (
      SELECT id FROM project_items WHERE (kind='board' AND data->>'archived'='true' AND NOT $4) OR NOT $1 AND (data->>'visibility'='internal'
        OR (data->'publication' IS NOT NULL AND data->'publication'<>'null'::jsonb AND data->'publication'->>'published'<>'true'))
      UNION SELECT child.id FROM project_items child JOIN hidden parent ON child.data->>'parent_id'=parent.id::text OR child.data->>'board_id'=parent.id::text
    ) SELECT * FROM project_items WHERE id NOT IN (SELECT id FROM hidden)
      AND id::text > $2 ORDER BY id::text LIMIT $3`, [internalAccess(actor), after, Math.min(100, Math.max(1, limit)), actor.projectSync === true])).rows.map(item => projectProjection(actor, item));
  }
  async get(actor: ProjectActor, id: string, client: Pool | PoolClient = this.pool): Promise<ProjectItem> {
    requireActive(actor);
    await this.requireReadable(client);
    const item = (await client.query("SELECT * FROM project_items WHERE id=$1", [id])).rows[0];
    readable(actor, item);
    if (item.data.board_id) {
      const board = (await client.query("SELECT * FROM project_items WHERE id=$1 AND kind='board'", [item.data.board_id])).rows[0];
      readable(actor, board);
      if (board.data.archived && !actor.projectSync) throw new ProjectError(403, "board_archived", "This project board is archived.");
    }
    let parent = item.data.parent_id;
    const visited = new Set([item.id]);
    while (parent) {
      if (visited.has(parent) || visited.size > 32) throw new ProjectError(409, "invalid_hierarchy", "Resolve the project hierarchy.");
      visited.add(parent);
      const ancestor = (await client.query("SELECT * FROM project_items WHERE id=$1", [parent])).rows[0];
      readable(actor, ancestor);
      if (ancestor.data.board_id && !actor.projectSync) {
        const board = (await client.query("SELECT * FROM project_items WHERE id=$1 AND kind='board'", [ancestor.data.board_id])).rows[0];
        readable(actor, board);
        if (board.data.archived) throw new ProjectError(403, "board_archived", "This project board is archived.");
      }
      parent = ancestor.data.parent_id;
    }
    return projectProjection(actor, item);
  }
  async history(actor: ProjectActor, id: string) {
    await this.get(actor, id);
    return (await this.pool.query(`SELECT sequence, item_id, actor_id, operation, created_at FROM project_events
      WHERE item_id=$1 ORDER BY sequence DESC LIMIT 100`, [id])).rows;
  }
  async revision(): Promise<string> {
    return String((await this.pool.query("SELECT revision FROM project_storage WHERE singleton")).rows[0].revision);
  }
  async mutate(actor: ProjectActor, operation: "create" | "update" | "action", id: string | null, input: unknown): Promise<ProjectItem> {
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
      const old: ProjectItem | undefined = operation === "create" ? undefined : (await client.query("SELECT * FROM project_items WHERE id=$1", [id])).rows[0];
      if (operation !== "create") { readable(actor, old); await this.get(actor, id!, client); }
      const submitted = "data" in parsed ? parsed.data : {};
      if ("sync_id" in parsed && parsed.sync_id && !actor.projectSync)
        throw new ProjectError(403, "sync_scope_required", "A sync credential is required to preserve item identity.");
      if ("sync_author_id" in parsed && parsed.sync_author_id && !actor.projectSync)
        throw new ProjectError(403, "sync_scope_required", "A sync credential is required to preserve item authorship.");
      if ("sync_created_at" in parsed && parsed.sync_created_at && !actor.projectSync)
        throw new ProjectError(403, "sync_scope_required", "A sync credential is required to preserve item history.");
      const kind = "kind" in parsed ? parsed.kind : old!.kind;
      if (["task", "note", "comment"].includes(kind) &&
          (submitted.visibility === "internal" || submitted.publication != null))
        throw new ProjectError(422, "shared_tasks_required", "Workspace tasks, notes, and comments are shared with all members.");
      if (!internalAccess(actor) && !["task", "note", "comment"].includes(kind) && (submitted.publication != null || old?.data.publication))
        throw new ProjectError(403, "planning_required", "Published work is managed by the project team.");
      if (old && "revision" in parsed && Number(old.revision) !== parsed.revision)
        throw new ProjectError(409, "revision_conflict", "This item changed. Reload before saving.");
      if (old && ["comment", "note"].includes(old.kind) && old.author_id !== actor.id && !internalAccess(actor))
        throw new ProjectError(403, "author_required", "Only the author or an administrator may edit this note or comment.");
      const data = projectFields.parse({ ...old?.data, ...("data" in parsed ? parsed.data : {}) });
      if (kind === "board" && !(actor.projectPlan ?? actor.role === "admin"))
        throw new ProjectError(403, "board_manager_required", "Board management permission is required.");
      if (kind === "board" && (data.board_id || data.parent_id))
        throw new ProjectError(422, "invalid_board", "A board cannot belong to another board or item.");
      if (data.board_id) {
        const board = await this.get(actor, data.board_id, client);
        if (board.kind !== "board" || (board.data.archived && !actor.projectSync))
          throw new ProjectError(422, "invalid_board", "Choose an active project board.");
      }
      if (data.visibility === "internal" && !internalAccess(actor)) throw new ProjectError(403, "internal_access_required", "Administrator access is required.");
      if (data.starts_on && data.due_on && data.starts_on > data.due_on) throw new ProjectError(422, "invalid_dates", "Start date must precede due date.");
      if (data.assignee && data.assignee === data.reviewer) throw new ProjectError(422, "separate_reviewer", "Choose a separate reviewer.");
      for (const userId of [data.assignee, data.reviewer]) {
        if (userId && !(await client.query("SELECT id FROM users WHERE id=$1 AND status='active'", [userId])).rowCount)
          throw new ProjectError(422, "invalid_member", "Select an active member of this environment.");
      }
      if (old && kind === "task" && (old.data.board_id ?? null) !== (data.board_id ?? null)) {
        data.parent_id = null;
        const nested = await client.query(`WITH RECURSIVE children AS (
          SELECT id,kind FROM project_items WHERE data->>'parent_id'=$1
          UNION SELECT i.id,i.kind FROM project_items i JOIN children c ON i.data->>'parent_id'=c.id::text
        ) SELECT id FROM children WHERE kind='task' LIMIT 1`, [old.id]);
        if (nested.rowCount) throw new ProjectError(422, "nested_task_move", "Move or detach nested tasks before moving their parent board.");
      }
      if (data.parent_id && submitted.board_id === undefined)
        data.board_id = (await this.get(actor, data.parent_id, client)).data.board_id;
      if (data.parent_id) {
        let ancestor: string | null = data.parent_id;
        const seen = new Set<string>();
        while (ancestor) {
          if (ancestor === id || seen.has(ancestor) || seen.size > 32) throw new ProjectError(422, "invalid_parent", "Project hierarchy cannot contain cycles.");
          seen.add(ancestor);
          const parent = await this.get(actor, ancestor, client);
          if ((parent.data.board_id ?? null) !== (data.board_id ?? null))
            throw new ProjectError(422, "different_board", "Parent and child must belong to the same board.");
          ancestor = parent.data.parent_id;
        }
        if (data.parent_id === id) throw new ProjectError(422, "invalid_parent", "An item cannot contain itself.");
        const parent = await this.get(actor, data.parent_id, client);
        if (parent.data.archived || parent.data.deleted || parent.kind === "comment")
          throw new ProjectError(422, "invalid_parent", "Select an open top-level item.");
        if ((parent.data.visibility === "internal" || parent.data.publication?.published === false) && data.visibility !== "internal")
          throw new ProjectError(422, "invalid_visibility", "Internal replies must remain internal.");
      } else if (kind === "comment") throw new ProjectError(422, "parent_required", "A comment requires a project item.");
      if (kind === "comment" && !data.body.trim()) throw new ProjectError(422, "comment_required", "Write a comment.");
      if (old && data.visibility !== old.data.visibility && (await client.query("SELECT id FROM project_items WHERE data->>'parent_id'=$1 LIMIT 1", [old.id])).rowCount)
        throw new ProjectError(409, "visibility_has_children", "Update child visibility before changing the parent visibility.");
      if ("action" in parsed) {
        if (parsed.action === "approve") {
          if (old!.data.state !== "review" || actor.id === old!.data.assignee || actor.id === old!.author_id || (!internalAccess(actor) && actor.id !== old!.data.reviewer))
            throw new ProjectError(403, "reviewer_required", "A separate assigned reviewer must accept this work.");
          data.state = "done";
        } else if (parsed.action === "changes") {
          if (!internalAccess(actor) && actor.id !== old!.data.reviewer) throw new ProjectError(403, "reviewer_required", "Reviewer access is required.");
          data.state = "doing";
        } else data.state = "todo";
      }
      if (kind === "task") {
        let status = (await client.query(
          submitted.status_id ? "SELECT * FROM project_statuses WHERE id=$1 AND board_id IS NOT DISTINCT FROM $2::uuid" :
          (submitted.state || "action" in parsed) ? "SELECT * FROM project_statuses WHERE legacy_state=$1 AND board_id IS NOT DISTINCT FROM $2::uuid" :
          old?.data.status_id ? "SELECT * FROM project_statuses WHERE id=$1 AND board_id IS NOT DISTINCT FROM $2::uuid" : "SELECT * FROM project_statuses WHERE is_default AND NOT retired AND board_id IS NOT DISTINCT FROM $1::uuid",
          submitted.status_id ? [submitted.status_id, data.board_id ?? null] : (submitted.state || "action" in parsed) ? [data.state, data.board_id ?? null] : old?.data.status_id ? [old.data.status_id, data.board_id ?? null] : [data.board_id ?? null]
        )).rows[0];
        const seen = new Set<string>();
        while (status?.retired && !submitted.status_id && !seen.has(status.id)) {
          seen.add(status.id);
          status = (await client.query("SELECT * FROM project_statuses WHERE id=$1", [status.replacement_id])).rows[0];
        }
        if (!status || status.retired) throw new ProjectError(422, "invalid_status", "Choose an active board status.");
        data.status_id = status.id;
        data.state = status.legacy_state || status.category;
      }
      const itemId = id ?? ("sync_id" in parsed ? parsed.sync_id : undefined) ?? randomUUID();
      const authorId = "sync_author_id" in parsed && parsed.sync_author_id ? parsed.sync_author_id : actor.id;
      if (authorId !== actor.id && !(await client.query("SELECT 1 FROM users WHERE id=$1 AND status='active'", [authorId])).rowCount)
        throw new ProjectError(422, "invalid_author", "The imported author must be an active workspace member.");
      if (!old && "sync_id" in parsed && parsed.sync_id
          && (await client.query("SELECT 1 FROM project_items WHERE id=$1", [itemId])).rowCount)
        throw new ProjectError(409, "sync_identity_conflict", "An item already uses this sync identity.");
      const result = old ? await client.query(`UPDATE project_items SET data=$2, revision=revision+1, updated_at=now() WHERE id=$1 RETURNING *`, [itemId, data])
        : await client.query(`INSERT INTO project_items(id,kind,data,author_id,created_at) VALUES($1,$2,$3,$4,COALESCE($5::timestamptz,now())) RETURNING *`,
          [itemId, kind, data, authorId, "sync_created_at" in parsed ? parsed.sync_created_at ?? null : null]);
      if (kind === "board" && !old && !actor.projectSync) {
        await client.query(`INSERT INTO project_statuses(id,name,color,category,legacy_state,position,is_default,board_id)
          SELECT gen_random_uuid(),name,color,category,legacy_state,position,legacy_state='todo',$1
          FROM (VALUES ('todo','To do','blue','todo',0),('doing','In progress','purple','doing',1),
            ('waiting','Waiting','orange','doing',2),('review','In review','teal','doing',3),
            ('done','Done','green','done',4)) AS defaults(legacy_state,name,color,category,position)`, [itemId]);
      }
      if (old && kind === "task" && (old.data.board_id ?? null) !== (data.board_id ?? null)) {
        await client.query(`WITH RECURSIVE children(id) AS (
          SELECT id FROM project_items WHERE data->>'parent_id'=$1
          UNION SELECT i.id FROM project_items i JOIN children c ON i.data->>'parent_id'=c.id::text
        ) UPDATE project_items SET data=jsonb_set(data,'{board_id}',COALESCE(to_jsonb($2::text),'null'::jsonb)),
          revision=revision+1,updated_at=now() WHERE id IN (SELECT id FROM children)`, [itemId, data.board_id ?? null]);
      }
      if (kind === "comment" && data.parent_id) {
        const parent = await this.get(actor, data.parent_id, client);
        if (parent.kind === "task" && data.visibility === "shared"
            && !data.deleted && parent.data.visibility === "shared" && !parent.data.deleted
            && (!parent.data.publication || parent.data.publication.published)
            && new Date(result.rows[0].created_at) >= new Date(storage.channel_history_started_at)) {
          const channelId = await ensurePrimaryChannel(client, actor.id);
          await client.query(`INSERT INTO team_messages(id,channel_id,author_kind,author_user_id,body,project_item_id)
            VALUES($1,$2,'user',$3,$4,$5) ON CONFLICT(project_item_id) DO UPDATE SET body=EXCLUDED.body`,
          [randomUUID(), channelId, old?.author_id ?? authorId, data.body, itemId]);
        } else await client.query("DELETE FROM team_messages WHERE project_item_id=$1", [itemId]);
      }
      if (kind === "task" && old && (data.visibility !== old.data.visibility
          || data.deleted !== old.data.deleted || JSON.stringify(data.publication) !== JSON.stringify(old.data.publication))) {
        const visible = data.visibility === "shared" && !data.deleted && (!data.publication || data.publication.published);
        if (!visible) {
          await client.query(`DELETE FROM team_messages WHERE project_item_id IN
            (SELECT id FROM project_items WHERE kind='comment' AND data->>'parent_id'=$1)`, [itemId]);
        } else {
          const channelId = await ensurePrimaryChannel(client, actor.id);
          await client.query(`INSERT INTO team_messages(id,channel_id,author_kind,author_user_id,body,project_item_id,created_at)
            SELECT gen_random_uuid(),$1,'user',author_id,data->>'body',id,created_at
            FROM project_items WHERE kind='comment' AND data->>'parent_id'=$2
              AND created_at >= (SELECT channel_history_started_at FROM project_storage WHERE singleton)
              AND data->>'visibility'='shared' AND data->>'deleted'!='true'
              AND char_length(data->>'body') BETWEEN 1 AND 32000
            ON CONFLICT(project_item_id) DO NOTHING`, [channelId, itemId]);
        }
      }
      await client.query(`INSERT INTO project_requests(actor_id,request_id,fingerprint,item_id) VALUES($1,$2,$3,$4)`, [actor.id, parsed.idempotency_key, fingerprint, itemId]);
      await client.query(`INSERT INTO project_events(item_id,actor_id,operation) VALUES($1,$2,$3)`, [itemId, actor.id, "action" in parsed ? parsed.action : operation]);
      await client.query("UPDATE project_storage SET revision=revision+1 WHERE singleton");
      await client.query("COMMIT"); return projectProjection(actor, result.rows[0]);
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
}
