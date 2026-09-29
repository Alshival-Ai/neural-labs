import { NativeAccessError } from "./nativeErrors.js";
export { NativeAccessError } from "./nativeErrors.js";
import { authorizeNativeBackground, nativeBackgroundSchema } from "./nativeBackground.js";
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response, RequestHandler } from "express";
import { z } from "zod";
import type { Database } from "./database.js";
import type { SessionService } from "./sessions.js";
import type { SessionActor } from "./types.js";
import type { ControlPlaneConfig } from "./config.js";

const selectionSchema = z.object({ connection: z.string().uuid(), model: z.string().trim().min(1).max(160) }).strict();
const operationSchema = z.object({
  operation: z.enum(["conversations.list", "conversations.create", "conversations.update", "conversations.delete",
    "jobs.snapshot", "jobs.create", "jobs.update", "jobs.remove", "jobs.review", "jobs.run", "turns.start", "turns.cancel", "events.read", "approvals.resolve", "models.list", "account.status", "account.login", "account.refresh", "account.cancel"]),
  selection: selectionSchema,
  params: z.record(z.string(), z.unknown()).default({}),
}).strict();
interface Connection {
  id: string; scope: "personal" | "shared" | "team" | "background"; user_id: string | null;
  provider: "codex" | "claude"; method: "subscription" | "api-key"; label: string; enabled: boolean; generation: number;
}

export class NativeExecutionAuthority {
  constructor(readonly database: Database, readonly sessions: SessionService) {}
  async connection(actor: SessionActor, id: string, purpose: string): Promise<Connection> {
    const row = (await this.database.pool.query<Connection>("SELECT * FROM native_connections WHERE id=$1", [id])).rows[0];
    const own = row?.scope === "personal" && row.user_id === actor.user.id;
    const shared = row?.scope === "shared";
    const configuration = (purpose.startsWith("account.") || ["models.list", "jobs.create", "jobs.update", "jobs.remove", "jobs.review", "jobs.snapshot"].includes(purpose))
      && actor.user.role === "admin" && row?.scope !== "personal";
    if (actor.user.status !== "active" || !row || !(own || shared || configuration)
        || purpose === "account.login" && !own && actor.user.role !== "admin") {
      throw new NativeAccessError(403, "The selected connection is unavailable to this account");
    }
    if (!row.enabled) throw new NativeAccessError(409, "The selected connection is paused");
    return row;
  }
  async issue(actor: SessionActor, selection: z.infer<typeof selectionSchema>, purpose: string) {
    const connection = await this.connection(actor, selection.connection, purpose);
    const id = randomUUID();
    await this.database.pool.query("DELETE FROM native_execution_leases WHERE expires_at < now()-interval '1 hour'");
    // Short durable leases survive control-plane process restarts. Renewal must
    // validate current membership, session, owner, provider and generation.
    await this.database.pool.query(`INSERT INTO native_execution_leases
      (id,actor_id,session_hash,connection_id,generation,model,purpose,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '30 seconds')`,
      [id, actor.user.id, actor.session.tokenHash, connection.id, connection.generation, selection.model, purpose]);
    return id;
  }
  async verify(id: string) {
    const lease = (await this.database.pool.query(`SELECT * FROM native_execution_leases WHERE id=$1 AND expires_at>now()`, [id])).rows[0];
    if (!lease) throw new NativeAccessError(403, "Execution lease expired");
    const actor = await this.sessions.actorByTokenHash(lease.session_hash);
    if (!actor || actor.user.id !== lease.actor_id || actor.user.status !== "active") throw new NativeAccessError(403, "Execution membership was revoked");
    const connection = await this.connection(actor, lease.connection_id, lease.purpose);
    if (connection.generation !== lease.generation) throw new NativeAccessError(403, "The selected credential generation changed");
    const updated = await this.database.pool.query(`UPDATE native_execution_leases SET expires_at=now()+interval '30 seconds'
      WHERE id=$1 AND expires_at>now() RETURNING id`, [id]);
    if (!updated.rowCount) throw new NativeAccessError(403, "Execution lease expired during authorization");
    return { actor: actor.user.id, actorRole: actor.user.role, lease: id, connection: connection.id,
      binding: { owner: connection.id, provider: connection.provider, generation: connection.generation, method: connection.method },
      scope: connection.scope, purpose: lease.purpose, model: lease.model, background: false,
      policy: { sandbox: "workspace-write", approval: "on-request" } };
  }
}

export function registerNativeRuntime(app: Express, database: Database, sessions: SessionService, config: ControlPlaneConfig,
  options: { sameOrigin: RequestHandler; active: (req: Request, res: Response) => Promise<SessionActor | undefined>;
    csrf: (req: Request, res: Response, actor: SessionActor) => boolean; fetch?: typeof fetch }) {
  const authority = new NativeExecutionAuthority(database, sessions);
  const wrap = (callback: (req: Request, res: Response) => Promise<void>): RequestHandler => async (req, res) => {
    res.set("Cache-Control", "no-store");
    try { await callback(req, res); }
    catch (error) { res.status(error instanceof NativeAccessError ? error.status : 503).json({ error: {
      message: error instanceof NativeAccessError ? error.message : "Native execution is temporarily unavailable" } }); }
  };
  app.get("/api/runtime/connections", wrap(async (req, res) => {
    const actor = await options.active(req, res); if (!actor) return;
    const result = await database.pool.query(`SELECT id,scope,provider,method,label,enabled,generation FROM native_connections
      WHERE user_id=$1 OR scope='shared' OR ($2 AND scope IN ('team','background')) ORDER BY scope,provider`,
      [actor.user.id, actor.user.role === "admin"]);
    res.json({ connections: result.rows });
  }));
  app.post("/api/runtime/connections", options.sameOrigin, wrap(async (req, res) => {
    const actor = await options.active(req, res); if (!actor || !options.csrf(req, res, actor)) return;
    const parsed = z.object({ scope: z.enum(["personal", "shared", "team", "background"]),
      provider: z.enum(["codex", "claude"]), label: z.string().trim().min(1).max(120) }).strict().safeParse(req.body);
    if (!parsed.success) throw new NativeAccessError(400, "Choose a connection owner, provider and label");
    if (parsed.data.scope !== "personal" && actor.user.role !== "admin") throw new NativeAccessError(403, "Administrator access is required");
    const result = await database.pool.query(`INSERT INTO native_connections(id,scope,user_id,provider,method,label)
      VALUES($1,$2,$3,$4,'subscription',$5) ON CONFLICT DO NOTHING RETURNING id`,
      [randomUUID(), parsed.data.scope, parsed.data.scope === "personal" ? actor.user.id : null, parsed.data.provider, parsed.data.label]);
    if (!result.rowCount) throw new NativeAccessError(409, "This connection already exists");
    res.status(201).json({ id: result.rows[0].id });
  }));
  app.patch("/api/runtime/connections/:id", options.sameOrigin, wrap(async (req, res) => {
    const actor = await options.active(req, res); if (!actor || !options.csrf(req, res, actor)) return;
    const parsed = z.object({ generation: z.number().int().positive(), enabled: z.boolean() }).strict().safeParse(req.body);
    if (!z.string().uuid().safeParse(req.params.id).success || !parsed.success) throw new NativeAccessError(400, "Invalid connection change");
    const changed = await database.pool.query(`UPDATE native_connections SET enabled=$4,generation=generation+1
      WHERE id=$1 AND generation=$2 AND (user_id=$3 OR (scope!='personal' AND $5)) RETURNING generation`,
      [req.params.id, parsed.data.generation, actor.user.id, parsed.data.enabled, actor.user.role === "admin"]);
    if (!changed.rowCount) throw new NativeAccessError(409, "The connection changed or is unavailable");
    res.json(changed.rows[0]);
  }));
  app.post("/api/runtime/request", options.sameOrigin, wrap(async (req, res) => {
    const actor = await options.active(req, res); if (!actor || !options.csrf(req, res, actor)) return;
    const input = operationSchema.safeParse(req.body);
    if (!input.success) throw new NativeAccessError(400, "Invalid native runtime request");
    const lease = await authority.issue(actor, input.data.selection, input.data.operation);
    const response = await (options.fetch ?? fetch)(new URL("/internal/native/request", config.workspace.controlUrl), {
      method: "POST", redirect: "error", headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.workspace.controlToken}` },
      body: JSON.stringify({ actor: actor.user.id, lease, operation: input.data.operation, params: input.data.params }),
      signal: AbortSignal.timeout(20000),
    });
    // The runtime exposes a small JSON result, never process stderr or native
    // credential files. Unknown HTTP outcomes are not retried here.
    const body = await response.text();
    if (Buffer.byteLength(body) > 4 * 1024 * 1024) throw new Error("Runtime response exceeds limit");
    res.status(response.status).json(JSON.parse(body));
  }));
  app.post("/internal/native/background", wrap(async (req, res) => {
    const supplied = Buffer.from(req.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
    const expected = Buffer.from(config.workspace.controlToken);
    if (!expected.length || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new NativeAccessError(401, "Unauthorized");
    const parsed = nativeBackgroundSchema.safeParse(req.body);
    if (!parsed.success) throw new NativeAccessError(400, "A saved native automation policy is required");
    const gate = (await database.pool.query("SELECT gate FROM update_runtime WHERE singleton")).rows[0];
    if (!gate || gate.gate !== false) throw new NativeAccessError(503, "Workspace maintenance is in progress");
    res.json(await authorizeNativeBackground(database, config, parsed.data));
  }));
  app.post("/internal/native/interactive", wrap(async (req, res) => {
    const supplied = Buffer.from(req.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
    const expected = Buffer.from(config.workspace.controlToken);
    if (!expected.length || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new NativeAccessError(401, "Unauthorized");
    const parsed = z.object({ actor: z.string().uuid(), session: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      purpose: z.enum(["terminal.open", "editor.open"]), selection: selectionSchema.optional() }).strict().safeParse(req.body);
    if (!parsed.success) throw new NativeAccessError(400, "An authenticated interactive session is required");
    const actor = await sessions.actorByTokenHash(parsed.data.session);
    if (!actor || actor.user.id !== parsed.data.actor || actor.user.status !== "active") throw new NativeAccessError(403, "Interactive membership was revoked");
    if ((await database.pool.query("SELECT gate FROM update_runtime WHERE singleton")).rows[0]?.gate !== false)
      throw new NativeAccessError(503, "Workspace maintenance is in progress");
    const lease = parsed.data.selection ? await authority.issue(actor, parsed.data.selection, parsed.data.purpose) : undefined;
    res.json({ actor: actor.user.id, role: actor.user.role, ...(lease ? { lease } : {}) });
  }));
  app.post("/internal/native/lease", wrap(async (req, res) => {
    const supplied = Buffer.from(req.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
    const expected = Buffer.from(config.workspace.controlToken);
    if (!expected.length || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new NativeAccessError(401, "Unauthorized");
    const parsed = z.object({ lease: z.string().uuid() }).strict().safeParse(req.body);
    if (!parsed.success) throw new NativeAccessError(400, "An execution lease is required");
    if ((await database.pool.query("SELECT gate FROM update_runtime WHERE singleton")).rows[0]?.gate !== false)
      throw new NativeAccessError(503, "Workspace maintenance is in progress");
    res.json(await authority.verify(parsed.data.lease));
  }));
}
