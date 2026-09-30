/** Workspace-local task relationships. ProjectStore remains the visibility authority. */
import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { z } from "zod";
import { internalAccess, ProjectError, ProjectStore, type ProjectActor } from "./projects.js";

export const edgeInput = z.object({
  idempotency_key: z.string().uuid(), source_id: z.string().uuid(), target_id: z.string().uuid(),
  kind: z.enum(["depends_on", "related"]),
}).strict();
export type ProjectEdge = { id: string; source_id: string; target_id: string; kind: "depends_on" | "related";
  actor_id: string; created_at: string };

export class ProjectGraph {
  constructor(private readonly pool: Pool, private readonly items = new ProjectStore(pool)) {}

  async list(actor: ProjectActor): Promise<ProjectEdge[]> {
    // The same recursive projection used by ProjectStore.list hides children of
    // private parents. An edge is visible only when both endpoints are visible.
    await this.items.list(actor, "", 1);
    return (await this.pool.query(`WITH RECURSIVE hidden(id) AS (
      SELECT id FROM project_items WHERE NOT $1 AND (data->>'visibility'='internal'
        OR (data->'publication' IS NOT NULL AND data->'publication'<>'null'::jsonb
          AND data->'publication'->>'published'<>'true'))
      UNION SELECT child.id FROM project_items child JOIN hidden parent ON child.data->>'parent_id'=parent.id::text
    ) SELECT edge.* FROM project_edges edge
      JOIN project_items source ON source.id=edge.source_id AND source.kind='task'
      JOIN project_items target ON target.id=edge.target_id AND target.kind='task'
      WHERE source.id NOT IN (SELECT id FROM hidden) AND target.id NOT IN (SELECT id FROM hidden)
      ORDER BY edge.created_at,edge.id`, [internalAccess(actor)])).rows;
  }

  async create(actor: ProjectActor, input: unknown): Promise<ProjectEdge> {
    const parsed = edgeInput.parse(input);
    if (parsed.source_id === parsed.target_id) throw new ProjectError(422, "self_link", "A task cannot link to itself.");
    const [source, target] = parsed.kind === "related" && parsed.source_id > parsed.target_id
      ? [parsed.target_id, parsed.source_id] : [parsed.source_id, parsed.target_id];
    const fingerprint = createHash("sha256").update(JSON.stringify({ source, target, kind: parsed.kind })).digest("hex");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const storage = (await client.query("SELECT state FROM project_storage WHERE singleton FOR UPDATE")).rows[0];
      if (storage?.state !== "active") throw new ProjectError(423, "project_paused", "Project changes are paused.");
      const prior = (await client.query("SELECT fingerprint,edge_id FROM project_edge_requests WHERE actor_id=$1 AND request_id=$2",
        [actor.id, parsed.idempotency_key])).rows[0];
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new ProjectError(409, "idempotency_conflict", "Request identifier was reused.");
        const edge = (await client.query("SELECT * FROM project_edges WHERE id=$1", [prior.edge_id])).rows[0];
        if (!edge) throw new ProjectError(409, "link_removed", "This link has since been removed.");
        await client.query("COMMIT"); return edge;
      }
      const left = await this.items.get(actor, source, client);
      const right = await this.items.get(actor, target, client);
      if (left.kind !== "task" || right.kind !== "task" || left.data.deleted || right.data.deleted || left.data.archived || right.data.archived)
        throw new ProjectError(422, "tasks_required", "Choose two active tasks.");
      if (parsed.kind === "depends_on") {
        const cycle = await client.query(`WITH RECURSIVE reachable(id) AS (
          SELECT target_id FROM project_edges WHERE source_id=$1 AND kind='depends_on'
          UNION SELECT edge.target_id FROM project_edges edge JOIN reachable path ON edge.source_id=path.id
            WHERE edge.kind='depends_on'
        ) SELECT 1 FROM reachable WHERE id=$2 LIMIT 1`, [target, source]);
        if (cycle.rowCount) throw new ProjectError(422, "dependency_cycle", "This dependency would create a cycle.");
      }
      const existing = (await client.query("SELECT * FROM project_edges WHERE source_id=$1 AND target_id=$2 AND kind=$3",
        [source, target, parsed.kind])).rows[0];
      const edge = existing ?? (await client.query(`INSERT INTO project_edges(id,source_id,target_id,kind,actor_id)
        VALUES($1,$2,$3,$4,$5) RETURNING *`, [randomUUID(), source, target, parsed.kind, actor.id])).rows[0];
      await client.query("INSERT INTO project_edge_requests(actor_id,request_id,fingerprint,edge_id) VALUES($1,$2,$3,$4)",
        [actor.id, parsed.idempotency_key, fingerprint, edge.id]);
      if (!existing) await client.query("UPDATE project_storage SET revision=revision+1 WHERE singleton");
      await client.query("COMMIT"); return edge;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async remove(actor: ProjectActor, id: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const storage = (await client.query("SELECT state FROM project_storage WHERE singleton FOR UPDATE")).rows[0];
      if (storage?.state !== "active") throw new ProjectError(423, "project_paused", "Project changes are paused.");
      const edge = (await client.query("SELECT * FROM project_edges WHERE id=$1", [id])).rows[0] as ProjectEdge | undefined;
      if (!edge) throw new ProjectError(404, "link_not_found", "Task link not found.");
      await this.items.get(actor, edge.source_id, client);
      await this.items.get(actor, edge.target_id, client);
      await client.query("DELETE FROM project_edges WHERE id=$1", [id]);
      await client.query("UPDATE project_storage SET revision=revision+1 WHERE singleton");
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
}
