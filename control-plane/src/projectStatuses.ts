import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { z } from "zod";
import { internalAccess, ProjectError, type ProjectActor } from "./projects.js";

export const statusFields = z.object({
  name: z.string().trim().min(1).max(60), color: z.enum(["yellow", "blue", "pink", "green", "orange", "purple", "teal", "gray"]),
  category: z.enum(["todo", "doing", "done"]), legacy_state: z.enum(["", "todo", "doing", "waiting", "review", "done"]).default(""),
  position: z.number().int().min(0).max(10000), is_default: z.boolean(), retired: z.boolean().default(false),
  replacement_id: z.string().uuid().nullable().default(null),
}).strict();
export class ProjectStatuses {
  constructor(private readonly pool: Pool) {}
  async list() { return (await this.pool.query("SELECT * FROM project_statuses ORDER BY position,id")).rows; }
  async save(actor: ProjectActor, input: unknown) {
    if (!internalAccess(actor) || !(actor.projectPlan ?? actor.role === "admin"))
      throw new ProjectError(403, "board_manager_required", "Workspace board management is required.");
    const parsed = z.object({ id: z.string().uuid().optional(), revision: z.number().int().nonnegative(), data: statusFields }).strict().parse(input);
    const data = parsed.data;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const storage = (await client.query("SELECT state FROM project_storage WHERE singleton FOR UPDATE")).rows[0];
      if (storage.state !== "active") throw new ProjectError(423, "project_paused", "The board is paused.");
      const id = parsed.id ?? randomUUID();
      const old = (await client.query("SELECT * FROM project_statuses WHERE id=$1", [id])).rows[0];
      if ((old?.revision ?? 0) !== parsed.revision) throw new ProjectError(409, "revision_conflict", "The status changed. Reload before saving.");
      if (old && (old.category !== data.category || old.legacy_state !== data.legacy_state))
        throw new ProjectError(422, "immutable_status_category", "Create a new status to change its reporting category.");
      if (data.is_default && (data.category !== "todo" || data.retired))
        throw new ProjectError(422, "default_status_required", "The default must be an active Not started status.");
      if (old?.is_default && !data.is_default && !data.retired)
        throw new ProjectError(422, "default_status_required", "Choose another default before clearing this one.");
      if (data.retired) {
        const replacement = (await client.query("SELECT * FROM project_statuses WHERE id=$1 AND NOT retired", [data.replacement_id])).rows[0];
        if (!replacement || replacement.id === id || replacement.category !== data.category)
          throw new ProjectError(422, "replacement_required", "Choose an active replacement in the same category.");
        await client.query(`UPDATE project_items SET data=jsonb_set(jsonb_set(data,'{status_id}',to_jsonb($2::text)),'{state}',to_jsonb($3::text)),
          revision=revision+1,updated_at=now() WHERE kind='task' AND data->>'status_id'=$1`, [id, replacement.id, replacement.legacy_state || replacement.category]);
        if (old?.is_default) await client.query("UPDATE project_statuses SET is_default=true,revision=revision+1 WHERE id=$1", [replacement.id]);
      }
      if (data.is_default) await client.query("UPDATE project_statuses SET is_default=false,revision=revision+1 WHERE is_default AND id<>$1", [id]);
      const values = [id,data.name,data.color,data.category,data.legacy_state,data.position,data.is_default,data.retired,data.replacement_id];
      const result = await client.query(`INSERT INTO project_statuses(id,name,color,category,legacy_state,position,is_default,retired,replacement_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO UPDATE SET
        name=$2,color=$3,position=$6,is_default=$7,retired=$8,replacement_id=$9,revision=project_statuses.revision+1 RETURNING *`, values);
      await client.query("UPDATE project_storage SET revision=revision+1");
      await client.query("COMMIT"); return result.rows[0];
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
}
