import { randomBytes, randomUUID, createHash, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response, RequestHandler } from "express";
import { z } from "zod";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import type { Database } from "./database.js";
import type { ControlPlaneConfig } from "./config.js";
import type { SessionActor, UserRecord } from "./types.js";
import { portalExchange } from "./managed.js";
import { ProjectError, ProjectStore, internalAccess, type ProjectActor, createProjectItem, updateProjectItem, projectAction } from "./projects.js";
import { ProjectGraph, edgeInput } from "./projectGraph.js";
import { ProjectStatuses } from "./projectStatuses.js";

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const scopesSchema = z.array(z.enum(["project:read", "project:write", "project:sync"])).min(1).max(3);
const syncAuthority = (actor: ProjectActor) => internalAccess(actor) && (actor.projectPlan ?? actor.role === "admin");
export async function authorizeProjectMember(database: Database, config: ControlPlaneConfig, userId: string, external = true): Promise<ProjectActor & { authorizationGeneration?: number }> {
  const user = await database.getUser(userId);
  if (!user || user.status !== "active") throw new ProjectError(403, "member_inactive", "Active membership is required.");
  if (config.managed) {
    const identity = (await database.pool.query("SELECT subject FROM managed_identities WHERE user_id=$1", [user.id])).rows[0];
    if (!identity) throw new ProjectError(403, "member_inactive", "Managed membership is required.");
    const result = z.object({ generation: z.number().int().positive(), members: z.array(z.object({ subject: z.string(), role: z.enum(["admin", "user"]), project_internal: z.boolean().default(false), project_plan: z.boolean().default(false) })) }).parse(
      await portalExchange(config, external ? "project-members" : "project-ui-members", { subjects: [identity.subject] }));
    const member = result.members.find(entry => entry.subject === identity.subject);
    if (!member) throw new ProjectError(403, "member_inactive", "Managed membership has ended.");
    user.role = member.role;
    return { ...user, authorizationGeneration: result.generation, projectInternal: member.project_internal, projectPlan: member.project_plan };
  }
  return user;
}
export function registerProjectRoutes(app: Express, database: Database, config: ControlPlaneConfig, options: {
  active: (req: Request, res: Response) => Promise<SessionActor | undefined>;
  csrf: (req: Request, res: Response, actor: SessionActor) => boolean;
  sameOrigin: RequestHandler;
}) {
  const store = new ProjectStore(database.pool);
  const graph = new ProjectGraph(database.pool, store);
  const statuses = new ProjectStatuses(database.pool);
  const wrap = (callback: (req: Request, res: Response) => Promise<void>): RequestHandler => async (req, res) => {
    try { await callback(req, res); }
    catch (error) {
      const known = error instanceof ProjectError;
      res.status(known ? error.status : error instanceof z.ZodError ? 422 : 503).json({ error: {
        code: known ? error.code : error instanceof z.ZodError ? "invalid_arguments" : "project_unavailable",
        message: known ? error.message : error instanceof z.ZodError ? "Check the project fields." : "Project service is temporarily unavailable.",
      } });
    }
  };
  const authenticate = async (req: Request, res: Response, scope: string): Promise<ProjectActor | undefined> => {
    const token = req.get("authorization")?.replace(/^Bearer /, "");
    if (token) {
      if (!/^nlp_[A-Za-z0-9_-]{43}$/.test(token)) throw new ProjectError(401, "invalid_key", "Invalid environment credential.");
      const key = (await database.pool.query("SELECT * FROM project_api_keys WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now()", [hash(token)])).rows[0];
      if (!key) throw new ProjectError(401, "invalid_key", "Invalid environment credential.");
      if (!(key.scopes as string[]).includes(scope)) throw new ProjectError(403, "scope_required", "This credential does not permit this operation.");
      const actor = await authorizeProjectMember(database, config, key.user_id);
      if (key.authority_generation !== (actor.authorizationGeneration ?? 0)) throw new ProjectError(401, "generation_changed", "Reconnect after the environment generation changed.");
      if ((key.scopes as string[]).includes("project:sync") && !syncAuthority(actor))
        throw new ProjectError(403, "sync_admin_required", "Workspace project management is required.");
      return { ...actor, projectSync: (key.scopes as string[]).includes("project:sync") };
    }
    const actor = await options.active(req, res);
    if (!actor) return;
    if (!["GET", "HEAD"].includes(req.method) && !options.csrf(req, res, actor)) return;
    return config.managed ? authorizeProjectMember(database, config, actor.user.id, false) : actor.user;
  };
  app.use("/api/projects", (req, res, next) => {
    if (req.get("origin") && req.get("origin") !== `${req.protocol}://${req.get("host")}`) { res.sendStatus(403); return; }
    next();
  });
  app.get("/api/projects", wrap(async (req, res) => {
    const actor = await authenticate(req, res, "project:read"); if (!actor) return;
    res.json({ version: 1, revision: await store.revision(), api: "/api/projects", mcp: "/api/projects/mcp", storage: "environment" });
  }));
  app.get("/api/projects/items", wrap(async (req, res) => {
    const actor = await authenticate(req, res, "project:read"); if (!actor) return;
    const after = z.string().max(36).parse(req.query.after ?? "");
    const items = await store.list(actor, after);
    res.json({ items, next: items.length === 100 ? items.at(-1)!.id : null });
  }));
  app.get("/api/projects/members", wrap(async (req, res) => {
    const actor = await authenticate(req, res, "project:read"); if (!actor) return;
    res.json({ members: (await database.pool.query("SELECT id,display_name FROM users WHERE status='active' ORDER BY display_name")).rows });
  }));
  // Trusted runtime transport: provider processes never receive the service token.
  app.post("/internal/projects/read", wrap(async (req, res) => {
    const supplied = Buffer.from(req.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
    const expected = Buffer.from(config.workspace.controlToken);
    if (!supplied.length || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      res.status(401).end(); return;
    }
    const input = z.object({ actorId: z.string().uuid(), after: z.string().uuid().optional() }).strict().parse(req.body);
    const actor = await authorizeProjectMember(database, config, input.actorId, false);
    const revision = await store.revision();
    const items = await store.list(actor, input.after ?? "", 100);
    const edges = input.after ? [] : await graph.list(actor);
    if (revision !== await store.revision()) throw new ProjectError(409, "snapshot_changed", "The graph changed. Read it again.");
    res.json({ revision, items, edges, statuses: input.after ? [] : await statuses.list(actor), next: items.length === 100 ? items.at(-1)!.id : null });
  }));
  app.get("/api/projects/boards", wrap(async (req, res) => {
    const actor = await authenticate(req, res, "project:read"); if (!actor) return;
    await store.list(actor, "", 1);
    const boards = (await database.pool.query(`SELECT * FROM project_items WHERE kind='board'
      AND ($1 OR data->>'archived'<>'true') AND ($2 OR data->>'visibility'='shared') ORDER BY created_at,id`, [syncAuthority(actor), internalAccess(actor)])).rows;
    res.json({ boards });
  }));
  app.get("/api/projects/edges", wrap(async (req, res) => {
    const actor = await authenticate(req, res, "project:read"); if (actor) res.json({ edges: await graph.list(actor) });
  }));
  app.get("/api/projects/statuses", wrap(async (req, res) => {
    const actor = await authenticate(req, res, "project:read");
    if (actor) res.json({ statuses: await statuses.list(actor), can_manage: syncAuthority(actor) });
  }));
  app.post("/api/projects/statuses", wrap(async (req, res) => {
    const actor = await authenticate(req, res, "project:write");
    if (actor) res.json(await statuses.save(actor, req.body));
  }));
  app.get("/api/projects/sync/snapshot", wrap(async (req, res) => {
    const actor = await authenticate(req, res, "project:sync"); if (!actor) return;
    if (!syncAuthority(actor)) throw new ProjectError(403, "sync_admin_required", "Workspace project management is required.");
    const revision = await store.revision();
    const after = z.string().max(36).parse(req.query.after ?? "");
    const items = await store.list(actor, after);
    const extras = after ? {} : { edges: await graph.list(actor, true), statuses: await statuses.list(actor),
        principals: config.managed ? (await database.pool.query(`SELECT u.id,m.subject FROM users u
          JOIN managed_identities m ON m.user_id=u.id
          WHERE m.issuer=$1 AND m.workspace=$2`,
          [config.managed.portalOrigin, config.managed.workspace])).rows : [] };
    if (revision !== await store.revision()) throw new ProjectError(409, "snapshot_changed", "The graph changed during the snapshot. Retry.");
    res.json({ version: 2, capabilities: { project_boards: true }, revision, items, next: items.length === 100 ? items.at(-1)!.id : null, ...extras });
  }));
  app.post("/api/projects/edges", wrap(async (req, res) => {
    const actor = await authenticate(req, res, "project:write"); if (actor) res.status(201).json(await graph.create(actor, req.body));
  }));
  app.delete("/api/projects/edges/:id", wrap(async (req, res) => {
    const actor = await authenticate(req, res, "project:write");
    if (actor) { await graph.remove(actor, z.string().uuid().parse(req.params.id), z.number().int().positive().optional().parse(req.body?.revision)); res.sendStatus(204); }
  }));
  app.get("/api/projects/items/:id/history", wrap(async (req, res) => {
    const actor = await authenticate(req, res, "project:read"); if (actor) res.json({ events: await store.history(actor, z.string().uuid().parse(req.params.id)) });
  }));
  app.get("/api/projects/items/:id", wrap(async (req, res) => {
    const actor = await authenticate(req, res, "project:read"); if (actor) res.json(await store.get(actor, z.string().uuid().parse(req.params.id)));
  }));
  app.post("/api/projects/items", wrap(async (req, res) => {
    const actor = await authenticate(req, res, "project:write"); if (actor) res.json(await store.mutate(actor, "create", null, req.body));
  }));
  app.patch("/api/projects/items/:id", wrap(async (req, res) => {
    const actor = await authenticate(req, res, "project:write"); if (actor) res.json(await store.mutate(actor, "update", z.string().uuid().parse(req.params.id), req.body));
  }));
  app.post("/api/projects/items/:id/actions", wrap(async (req, res) => {
    const actor = await authenticate(req, res, "project:write"); if (actor) res.json(await store.mutate(actor, "action", z.string().uuid().parse(req.params.id), req.body));
  }));
  app.get("/api/projects/keys", wrap(async (req, res) => {
    const actor = await options.active(req, res); if (!actor) return;
    res.json({ keys: (await database.pool.query("SELECT id,name,scopes,expires_at,revoked_at FROM project_api_keys WHERE user_id=$1 ORDER BY created_at DESC", [actor.user.id])).rows });
  }));
  app.post("/api/projects/keys", options.sameOrigin, wrap(async (req, res) => {
    const actor = await options.active(req, res); if (!actor || !options.csrf(req, res, actor)) return;
    const input = z.object({ name: z.string().trim().min(1).max(100), scopes: scopesSchema, days: z.number().int().min(1).max(90).default(30) }).strict().parse(req.body);
    const current = await authorizeProjectMember(database, config, actor.user.id);
    if (input.scopes.includes("project:sync") && !syncAuthority(current))
      throw new ProjectError(403, "sync_admin_required", "Workspace project management is required to create a sync credential.");
    const token = `nlp_${randomBytes(32).toString("base64url")}`;
    const id = randomUUID();
    await database.pool.query("INSERT INTO project_api_keys(id,token_hash,user_id,name,scopes,expires_at,authority_generation) VALUES($1,$2,$3,$4,$5,now()+($6 * interval '1 day'),$7)", [id, hash(token), actor.user.id, input.name, JSON.stringify(input.scopes), input.days, current.authorizationGeneration ?? 0]);
    res.status(201).json({ id, token });
  }));
  app.delete("/api/projects/keys/:id", options.sameOrigin, wrap(async (req, res) => {
    const actor = await options.active(req, res); if (!actor || !options.csrf(req, res, actor)) return;
    await database.pool.query("UPDATE project_api_keys SET revoked_at=now() WHERE id=$1 AND user_id=$2", [z.string().uuid().parse(req.params.id), actor.user.id]);
    res.sendStatus(204);
  }));
  app.all("/api/projects/mcp", wrap(async (req, res) => {
    // The public MCP transport accepts environment credentials, never ambient browser cookies.
    if (!req.get("authorization")) throw new ProjectError(401, "credential_required", "An environment credential is required.");
    const actor = await authenticate(req, res, "project:read"); if (!actor) return;
    const handler = createMcpHandler(() => {
      const server = new McpServer({ name: "neural-labs-projects", version: "1.0.0" });
      const result = async (fn: () => Promise<unknown>) => {
        try { return { content: [{ type: "text" as const, text: JSON.stringify(await fn()) }] }; }
        catch (error) { return { isError: true, content: [{ type: "text" as const, text: error instanceof ProjectError ? error.message : "Project operation failed." }] }; }
      };
      server.registerTool("project_list", { description: "List this environment's authorized project items. Follow the cursor until next is null.", inputSchema: z.object({ after: z.string().max(36).default("") }) }, args => result(async () => { const items = await store.list(actor, args.after); return { items, next: items.length === 100 ? items.at(-1)!.id : null }; }));
      server.registerTool("project_get", { description: "Read a project item.", inputSchema: z.object({ id: z.string().uuid() }) }, args => result(() => store.get(actor, args.id)));
      server.registerTool("project_edges", { description: "List authorized task dependencies and related links.", inputSchema: z.object({}) }, () => result(() => graph.list(actor)));
      const write = async (operation: "create" | "update" | "action", id: string | null, data: unknown) => {
        const writer = await authenticate(req, res, "project:write");
        if (!writer) throw new ProjectError(403, "scope_required", "Write access required.");
        return store.mutate(writer, operation, id, data);
      };
      server.registerTool("project_create", { description: "Create a task, note, resource, deliverable, ticket or comment.", inputSchema: createProjectItem }, args => result(() => write("create", null, args)));
      server.registerTool("project_update", { description: "Update an item using its current revision and a unique request ID.", inputSchema: updateProjectItem.extend({ id: z.string().uuid() }) }, ({ id, ...args }) => result(() => write("update", id, args)));
      server.registerTool("project_action", { description: "Accept reviewed work, request changes or reopen an item.", inputSchema: projectAction.extend({ id: z.string().uuid() }) }, ({ id, ...args }) => result(() => write("action", id, args)));
      server.registerTool("project_link", { description: "Connect two tasks with a dependency or related link.", inputSchema: edgeInput }, args => result(async () => {
        const writer = await authenticate(req, res, "project:write");
        if (!writer) throw new ProjectError(403, "scope_required", "Write access required.");
        return graph.create(writer, args);
      }));
      return server;
    }, { legacy: "stateless", onerror: () => {} });
    await toNodeHandler(handler, { onerror: () => {} })(req, res, req.body);
  }));
}
