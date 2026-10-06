import type { PoolClient } from "pg";
import { ProjectError, type ProjectActor } from "./projects.js";

export async function preserveSourceClock(client: PoolClient, actor: ProjectActor, stamp?: string): Promise<void> {
  if (!stamp) return;
  if (!actor.projectSync) throw new ProjectError(403, "sync_scope_required", "Only graph replication preserves source edit clocks.");
  await client.query("SELECT set_config('neural_labs.sync_edited_at',$1,true)", [stamp]);
}
