/** Versioned task tools; every transport delegates to these domain operations. */
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { Database } from "./database.js";
import type { ControlPlaneConfig } from "./config.js";
import { ProjectStore, ProjectError, internalAccess, type ProjectActor, type ProjectItem } from "./projects.js";
import { ProjectGraph } from "./projectGraph.js";
import { ProjectStatuses } from "./projectStatuses.js";
import { parseProjectTool, projectTools } from "./projectToolContract.js";

const fields = ["title", "body", "acceptance", "state", "priority", "visibility", "assignee", "reviewer", "starts_on", "due_on", "parent_id", "board_id", "status_id", "color", "archived", "deleted", "checklist", "resource"];
export const projectRecord = (item: ProjectItem) => ({ id: item.id, kind: item.kind, revision: item.revision,
  data: Object.fromEntries(fields.filter(key => key in item.data).map(key => [key, item.data[key as keyof typeof item.data]])),
  created_at: item.created_at, updated_at: item.updated_at });
const edgeRecord = (edge: Record<string, unknown>) => ({ id: edge.id, source_id: edge.source_id, target_id: edge.target_id,
  kind: edge.kind, revision: edge.revision, deleted: Boolean(edge.deleted_at), created_at: edge.created_at });
const stable = (input: unknown): string => JSON.stringify(input, (_key, value) =>
  value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
const digest = (input: unknown) => createHash("sha256").update(stable(input)).digest("hex");
const manager = (actor: ProjectActor) => internalAccess(actor) && (actor.projectPlan ?? actor.role === "admin");

export class ProjectTools {
  readonly store: ProjectStore;
  readonly graph: ProjectGraph;
  readonly statuses: ProjectStatuses;
  constructor(private readonly database: Database, private readonly config: ControlPlaneConfig) {
    this.store = new ProjectStore(database.pool);
    this.graph = new ProjectGraph(database.pool, this.store);
    this.statuses = new ProjectStatuses(database.pool);
  }
  async call(actor: ProjectActor, name: string, input: unknown): Promise<Record<string, unknown>> {
    if (actor.status !== 'active') throw new ProjectError(403, 'member_inactive', 'Active membership is required.');
    const args = parseProjectTool(name, input);
    if (args.workspace_id && args.workspace_id !== this.config.managed?.workspace)
      throw new ProjectError(403, "workspace_mismatch", "This connection belongs to a different workspace.");
    delete args.workspace_id;
    if (projectTools.find(tool => tool.name === name)!.readOnly) return this.read(actor, name, args);
    const client = await this.database.pool.connect();
    try {
      await client.query("BEGIN");
      const storage = (await client.query("SELECT state FROM project_storage WHERE singleton FOR UPDATE")).rows[0];
      if (storage?.state !== "active") throw new ProjectError(423, "project_paused", "Project changes are paused.");
      if (name === "project_status_write" && !manager(actor)) throw new ProjectError(403, "board_manager_required", "Board management permission is required.");
      const fingerprint = digest([name, args]);
      const previous = (await client.query("SELECT fingerprint,result FROM project_tool_receipts WHERE actor_id=$1 AND request_id=$2", [actor.id, args.idempotency_key])).rows[0];
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new ProjectError(409, "idempotency_conflict", "Request identifier was reused.");
        const saved = previous.result;
        for (const id of saved.source_id ? [saved.source_id, saved.target_id] : saved.kind ? [saved.id] : []) {
          const item = await this.store.get(actor, id, client);
          if (["note", "comment"].includes(item.kind) && item.author_id !== actor.id && !internalAccess(actor))
            throw new ProjectError(403, "author_required", "Author or administrator access is required.");
        }
        await client.query("COMMIT"); return saved;
      }
      const result = await this.write(actor, name, args, client);
      await client.query("INSERT INTO project_tool_receipts(actor_id,request_id,fingerprint,result) VALUES($1,$2,$3,$4)", [actor.id, args.idempotency_key, fingerprint, JSON.stringify(result)]);
      await client.query("COMMIT"); return result;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  async read(actor: ProjectActor, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.store.list(actor, '', 1);
    if (name === "project_get") return projectRecord(await this.store.get(actor, String(args.id)));
    if (name === "project_edges") return { edges: (await this.graph.list(actor)).map(edge => edgeRecord(edge)) };
    if (name === "project_statuses") return this.catalog(actor, undefined, args.board_id as string | undefined);
    if (name === "project_members") {
      await this.store.list(actor, "", 1);
      const limit = Number(args.limit ?? 100);
      const rows = (await this.database.pool.query("SELECT id,display_name AS name FROM users WHERE status='active' AND id::text>$1 ORDER BY id LIMIT $2", [args.after ?? "", limit + 1])).rows;
      return { items: rows.slice(0, limit), next: rows.length > limit ? rows[limit - 1].id : null };
    }
    if (name === "project_comments") {
      const parent = await this.store.get(actor, String(args.id));
      if (!["task", "note"].includes(parent.kind)) throw new ProjectError(422, "invalid_parent", "Comments require a task or note.");
    }
    const limit = name === "project_boards" ? Number.MAX_SAFE_INTEGER : Number(args.limit ?? 100);
    let cursor = String(args.after ?? "");
    const items: ProjectItem[] = [];
    for (;;) {
      const page = await this.store.list(actor, cursor);
      for (const item of page) {
        if (name === "project_boards" ? item.kind !== "board" : name === "project_comments" ? item.kind !== "comment" || item.data.parent_id !== args.id : args.kind && item.kind !== args.kind) continue;
        items.push(item);
        if (items.length > limit) break;
      }
      if (items.length > limit || page.length < 100) break;
      cursor = page.at(-1)!.id;
    }
    if (name === "project_boards") return { items: items.map(projectRecord), multiple_boards: actor.projectMultipleBoards !== false };
    return { items: items.slice(0, limit).map(projectRecord), next: items.length > limit ? items[limit - 1]!.id : null };
  }
  async catalog(actor: ProjectActor, client?: PoolClient, boardId?: string) {
    const board = boardId ?? actor.projectDefaultBoard ?? null;
    if (board) {
      const item = await this.store.get(actor,board,client);
      if (item.kind !== 'board') throw new ProjectError(422,'invalid_board','Choose a board.');
    }
    if (actor.projectMultipleBoards === false && board !== (actor.projectDefaultBoard ?? null))
      throw new ProjectError(403,'board_policy','This connection is limited to its configured board.');
    const rows = (await (client ?? this.database.pool).query('SELECT * FROM project_statuses WHERE board_id IS NOT DISTINCT FROM $1::uuid ORDER BY position,id',[board])).rows;
    const statuses = rows.map(row => Object.fromEntries(["id", "name", "category", "color", "position", "is_default", "retired", "legacy_state", "revision"].map(key => [key, row[key]])));
    return { statuses: statuses.filter(row => !row.retired), revision: digest(statuses) };
  }
  async write(actor: ProjectActor, name: string, args: Record<string, unknown>, client: PoolClient): Promise<Record<string, unknown>> {
    if (name === "project_link") return edgeRecord(await this.graph.create(actor, args, client));
    if (name === "project_unlink") {
      await this.graph.remove(actor, String(args.id), Number(args.revision), undefined, client);
      return edgeRecord((await client.query("SELECT * FROM project_edges WHERE id=$1", [args.id])).rows[0]);
    }
    if (name === "project_status_write") return this.configure(actor, args, client);
    const { id, ...data } = args;
    let existing: ProjectItem | undefined;
    if (id) {
      const old=await this.store.get(actor,String(id),client); existing=old;
      const fields=args.data as Record<string,unknown> | undefined;
      if (fields && 'deleted' in fields && !['task','comment'].includes(old.kind))
        throw new ProjectError(422,'invalid_lifecycle','Archive this item instead of deleting it.');
      if (old.kind==='resource' && fields && 'archived' in fields)
        throw new ProjectError(422,'invalid_lifecycle','Set resource status to retired.');
      if (old.kind==='comment' && old.data.parent_id && (await this.store.get(actor,old.data.parent_id,client)).kind==='note')
        throw new ProjectError(403,'immutable_reply','Note replies are immutable.');
    }
    if (name==='project_action' && !['task','deliverable'].includes(existing?.kind ?? ''))
      throw new ProjectError(422,'invalid_action','Review actions require a task or deliverable.');
    if (args.kind==='resource' || existing?.kind==='resource') {
      const fields={...data.data as Record<string,unknown>};
      if (fields.resource) fields.resource={kind:'other',status:'active',provider:'',environment:'',public_url:'',external_id:null,sticker:'auto',tags:[],
        ...existing?.data.resource,...fields.resource as object};
      data.data=fields;
    }
    if (name === "project_create" && args.kind === "board" && actor.projectMultipleBoards === false)
      throw new ProjectError(403, "board_policy", "This managed workspace uses its existing board.");
    if (name === "project_create" && args.kind === "comment") data.data = { title: "Comment", ...(args.data as object) };
    if (name === 'project_create' && actor.projectMultipleBoards === false) {
      const fields = {...data.data as Record<string,unknown>};
      if (fields.board_id !== undefined && fields.board_id !== actor.projectDefaultBoard)
        throw new ProjectError(403,'board_policy','This connection is limited to its configured board.');
      fields.board_id = actor.projectDefaultBoard ?? null;
      data.data = fields;
    }
    const operation = name === "project_create" ? "create" : name === "project_update" ? "update" : "action";
    return projectRecord(await this.store.mutate(actor, operation, id ? String(id) : null, data, client));
  }
  async configure(actor: ProjectActor, args: Record<string, unknown>, client: PoolClient) {
    const boardId=args.board_id as string | undefined;
    const catalog = await this.catalog(actor, client, boardId);
    if (catalog.revision !== args.revision) throw new ProjectError(409, "revision_conflict", "Board settings changed. Read them again.");
    const board=boardId ?? actor.projectDefaultBoard ?? null;
    const rows = (await client.query("SELECT * FROM project_statuses WHERE NOT retired AND board_id IS NOT DISTINCT FROM $1::uuid ORDER BY position,id",[board])).rows;
    if (args.operation === "reorder") {
      const order = args.order as string[];
      if (!order || order.length !== rows.length || new Set(order).size !== rows.length || rows.some(row => !order.includes(row.id)))
        throw new ProjectError(422, "invalid_order", "Provide every active status exactly once.");
      for (const [position, id] of order.entries()) await client.query("UPDATE project_statuses SET position=$1,revision=revision+1 WHERE id=$2", [position, id]);
      await client.query("UPDATE project_storage SET revision=revision+1 WHERE singleton");
    } else {
      const old = rows.find(row => row.id === args.id);
      if (args.operation !== "create" && !old) throw new ProjectError(404, "status_not_found", "Choose an active status.");
      const data = old ? Object.fromEntries(["name", "color", "category", "legacy_state", "position", "is_default", "retired", "replacement_id", "board_id"].map(key => [key, old[key]])) :
        { name: args.name, color: args.color ?? "blue", category: args.category, legacy_state: "", position: rows.length, is_default: false, retired: false, replacement_id: null, board_id: board };
      if (args.operation === "update") { if (args.name !== undefined) data.name = args.name; if (args.color !== undefined) data.color = args.color; }
      if (args.operation === "default") data.is_default = true;
      if (args.operation === "retire") { data.retired = true; data.is_default = false; data.replacement_id = args.replacement_id; }
      if (rows.some(row => row.id !== old?.id && row.name.toLowerCase() === String(data.name).trim().toLowerCase()))
        throw new ProjectError(422, "duplicate_status", "Choose a unique status name.");
      await this.statuses.save(actor, { id: old?.id ?? randomUUID(), revision: old?.revision ?? 0, data }, client);
    }
    return this.catalog(actor, client, boardId);
  }
}
