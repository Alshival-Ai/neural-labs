/** Optional connection-authenticated graph replication. No browser or API-key authority. */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Express } from "express";
import { z } from "zod";
import type { Database } from "./database.js";
import type { ControlPlaneConfig } from "./config.js";
import { managedUserId, portalExchange, syncManagedUser } from "./managed.js";
import { ProjectError, ProjectStore, type ProjectActor } from "./projects.js";
import { ProjectGraph } from "./projectGraph.js";
import { ProjectStatuses } from "./projectStatuses.js";

const inputSchema = z.object({ workspace: z.string().uuid(), instance: z.string().uuid(),
  generation: z.number().int().positive(), method: z.enum(["GET", "POST", "PATCH", "DELETE"]),
  path: z.string().max(100), data: z.unknown() }).strict();
const authorizationSchema = z.object({ generation: z.number().int().positive(), members: z.array(z.object({
  subject: z.string().min(1).max(128), email: z.string().email(), display_name: z.string().max(512),
  role: z.enum(["user", "admin"]),
})).max(10000) });
export function validProjectSyncSignature(secret: string, stamp: string, payload: string, signature: string): boolean {
  if (!/^\d{10}$/.test(stamp) || Math.abs(Date.now() / 1000 - Number(stamp)) > 30 || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(`project-sync\n${stamp}\n${payload}`).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

export function registerProjectSyncBridge(app: Express, database: Database, config: ControlPlaneConfig): void {
  if (!config.managed) return;
  const managed = config.managed;
  const store = new ProjectStore(database.pool), graph = new ProjectGraph(database.pool), statuses = new ProjectStatuses(database.pool);
  app.post("/api/projects/sync/bridge", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const payload = req.body?.payload;
    if (typeof payload !== "string" || Buffer.byteLength(payload) > 256 * 1024
        || !validProjectSyncSignature(managed.secret, req.get("X-Neural-Labs-Time") ?? "", payload,
          req.get("X-Neural-Labs-Signature") ?? "")) { res.sendStatus(403); return; }
    try {
      const input = inputSchema.parse(JSON.parse(payload));
      if (input.workspace !== managed.workspace || input.instance !== managed.instance) { res.sendStatus(403); return; }
      const authorization = authorizationSchema.parse(await portalExchange(config, "graph-sync-authorize", { generation: input.generation, access: input.method === "GET" ? "read" : "write" }));
      if (authorization.generation !== input.generation) { res.sendStatus(403); return; }
      // Materialize verified members before snapshotting, including those who never signed in.
      if (input.method === "GET" && input.path === "sync/snapshot") {
        for (const member of authorization.members) await syncManagedUser(database, managed, { ...member,
          workspace: managed.workspace, instance: managed.instance, generation: input.generation,
          origin: config.publicOrigin?.origin ?? "https://invalid.example", expires_at: new Date(Date.now() + 30000).toISOString() });
      }
      // A non-login principal is used only inside this authenticated graph transport.
      const id = managedUserId(managed, "graph-sync-service");
      await database.pool.query(`INSERT INTO users(id,email,normalized_email,display_name,handle,role,status)
        VALUES($1,$2,$2,'Graph synchronization',$3,'user','disabled') ON CONFLICT(id) DO NOTHING`,
        [id, `graph-sync-${id}@invalid.example`, `sync-${id.replaceAll("-", "").slice(0, 24)}`]);
      const actor: ProjectActor = { id, email: "", handle: "", displayName: "Graph synchronization", role: "user",
        status: "active", createdAt: new Date(), updatedAt: new Date(), projectInternal: true, projectPlan: true, projectSync: true };
      const matched = /^sync\/snapshot(?:\?after=([0-9a-f-]{36}))?$/.exec(input.path);
      if (input.method === "GET" && matched) {
        const revision = await store.revision(), after = matched[1] ?? "";
        const items = await store.list(actor, after);
        const extras = after ? {} : { edges: await graph.list(actor, true), statuses: await statuses.list(actor),
          principals: [...(await database.pool.query(`SELECT user_id AS id,subject FROM managed_identities WHERE issuer=$1 AND workspace=$2`,
            [managed.portalOrigin, managed.workspace])).rows, { id, subject: null, system: true }] };
        if (revision !== await store.revision()) throw new ProjectError(409, "snapshot_changed", "Retry the graph snapshot.");
        res.json({ version: 2, capabilities: { project_boards: true, automatic_sync: true, source_edit_clocks: true },
          revision, items, next: items.length === 100 ? items.at(-1)!.id : null, ...extras }); return;
      }
      const fields = (input.data as { data?: { assignee?: string; reviewer?: string } } | null)?.data;
      for (const memberId of [fields?.assignee, fields?.reviewer]) {
        if (!memberId) continue;
        const subject = (await database.pool.query("SELECT subject FROM managed_identities WHERE user_id=$1 AND issuer=$2 AND workspace=$3",
          [memberId, managed.portalOrigin, managed.workspace])).rows[0]?.subject;
        if (!authorization.members.some(member => member.subject === subject)) { res.sendStatus(403); return; }
      }
      // No arbitrary route proxying, tool access, approval actions, or tenant-supplied origins.
      let result: unknown;
      if (input.method === "POST" && input.path === "items") result = await store.mutate(actor, "create", null, input.data);
      else if (input.method === "PATCH" && /^items\/[0-9a-f-]{36}$/.test(input.path))
        result = await store.mutate(actor, "update", z.string().uuid().parse(input.path.slice(6)), input.data);
      else if (input.method === "POST" && input.path === "statuses") result = await statuses.save(actor, input.data);
      else if (input.method === "POST" && input.path === "edges") result = await graph.create(actor, input.data);
      else if (input.method === "DELETE" && /^edges\/[0-9a-f-]{36}$/.test(input.path)) {
        const data = z.object({ revision: z.number().int().positive(), sync_edited_at: z.iso.datetime({ offset: true }) }).strict().parse(input.data);
        await graph.remove(actor, z.string().uuid().parse(input.path.slice(6)), data.revision, data.sync_edited_at); result = null;
      } else { res.sendStatus(400); return; }
      res.json(result);
    } catch (error) {
      res.status(error instanceof ProjectError ? error.status : error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 503)
        .json({ error: error instanceof ProjectError ? error.code : "graph_sync_unavailable" });
    }
  });
}
