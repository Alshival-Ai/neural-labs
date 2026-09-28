/** Alshival identity adapter. No email-based account linking or local login fallback. */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Express } from "express";
import { z } from "zod";
import type { Database } from "./database.js";
import type { ControlPlaneConfig } from "./config.js";
import type { SessionService } from "./sessions.js";
import { CredentialCipher } from "./crypto.js";

function safeEqual(left: string, right: string): boolean {
  return Boolean(left && right && Buffer.byteLength(left) === Buffer.byteLength(right)
    && timingSafeEqual(Buffer.from(left), Buffer.from(right)));
}

export interface ManagedConfig {
  portalOrigin: string;
  workspace: string;
  instance: string;
  secret: string;
}

export function managedConfig(env: NodeJS.ProcessEnv): ManagedConfig | undefined {
  const mode = env.NEURAL_LABS_AUTH_MODE || "standalone";
  if (mode === "standalone") return undefined;
  if (mode !== "alshival") throw new Error("Unknown NEURAL_LABS_AUTH_MODE");
  const portal = new URL(env.NEURAL_LABS_PORTAL_ORIGIN || "https://alshival.ai");
  if (portal.protocol !== "https:" || portal.pathname !== "/" || portal.search || portal.hash || portal.username || portal.password)
    throw new Error("Managed portal must be an HTTPS origin");
  const id = z.string().uuid();
  return {
    portalOrigin: portal.origin,
    workspace: id.parse(env.NEURAL_LABS_PORTAL_WORKSPACE),
    instance: id.parse(env.NEURAL_LABS_PORTAL_INSTANCE),
    secret: z.string().min(43).max(256).parse(env.NEURAL_LABS_PORTAL_SECRET),
  };
}

const actorSchema = z.object({
  subject: z.string().min(1).max(128), email: z.string().email(), display_name: z.string().max(512),
  role: z.enum(["admin", "user"]), workspace: z.string().uuid(), instance: z.string().uuid(),
  generation: z.number().int().positive(), origin: z.string().url(), expires_at: z.string().datetime({ offset: true }),
  token: z.string().min(32).max(256).optional(),
});
export type ManagedActor = z.infer<typeof actorSchema>;

/** Refuse changing identity authorities on a database that already belongs to another deployment. */
export async function bindAuthenticationMode(database: Database, config: ControlPlaneConfig): Promise<void> {
  const client = await database.pool.connect();
  const binding = config.managed ? { mode: "alshival", issuer: config.managed.portalOrigin,
    workspace: config.managed.workspace, instance: config.managed.instance } : { mode: "standalone" };
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(67209381)");
    const row = await client.query("SELECT binding FROM deployment_identity WHERE singleton");
    if (row.rows[0]) {
      const stored = row.rows[0].binding;
      if (Object.keys(stored).length !== Object.keys(binding).length
          || Object.entries(binding).some(([key, value]) => stored[key] !== value))
        throw new Error("Authentication authority cannot be changed on an existing instance");
    } else {
      if (config.managed && (await client.query("SELECT id FROM users LIMIT 1")).rowCount)
        throw new Error("Managed mode requires a fresh identity database; standalone accounts cannot be imported");
      await client.query("INSERT INTO deployment_identity(binding) VALUES($1)", [binding]);
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export function portalEntry(config: ManagedConfig): string {
  return `${config.portalOrigin}/workspaces/${config.workspace}/neural-labs/`;
}

export async function portalCall(config: ControlPlaneConfig, operation: "redeem" | "authorize" | "revoke", token: string,
  transport: typeof fetch = fetch): Promise<ManagedActor | undefined> {
  const response = await portalExchange(config, operation, { token }, transport);
  if (operation === "revoke") return undefined;
  const actor = actorSchema.parse(response);
  const managed = config.managed!;
  if (actor.workspace !== managed.workspace || actor.instance !== managed.instance
      || actor.origin !== config.publicOrigin?.origin || Date.parse(actor.expires_at) <= Date.now())
    throw new Error("Portal identity binding mismatch");
  return actor;
}

export async function portalExchange(config: ControlPlaneConfig, operation: string, data: unknown, transport: typeof fetch = fetch): Promise<unknown> {
  const managed = config.managed!;
  const body = JSON.stringify(data);
  const stamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", managed.secret)
    .update(`${managed.instance}\n${operation}\n${stamp}\n${body}`).digest("hex");
  const response = await transport(`${managed.portalOrigin}/workspaces/neural-labs/instances/${managed.instance}/${operation}/`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(operation.endsWith("tools") ? 65000 : 5000),
    headers: { "Content-Type": "application/json", "X-Neural-Labs-Time": stamp, "X-Neural-Labs-Signature": signature }, body,
  });
  if (!response.ok) throw new Error("Portal authorization unavailable");
  return response.json();
}

export function managedUserId(config: ManagedConfig, subject: string): string {
  const hex = createHash("sha256").update(JSON.stringify([config.portalOrigin, config.workspace, subject])).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function syncManagedUser(database: Database, config: ManagedConfig, actor: ManagedActor): Promise<string> {
  const id = managedUserId(config, actor.subject);
  // Serialized identity updates cannot attach an existing local identity by matching email.
  await database.pool.query(
    `INSERT INTO users(id, email, normalized_email, display_name, handle, role, status)
     VALUES ($1,$2,lower($2),$3,$4,$5,'active')
     ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email, normalized_email=EXCLUDED.normalized_email,
       display_name=EXCLUDED.display_name, role=EXCLUDED.role, status='active', updated_at=now()`,
    [id, actor.email, actor.display_name, `p-${id.replaceAll("-", "").slice(0, 28)}`, actor.role]);
  await database.pool.query(`INSERT INTO managed_identities(user_id,issuer,workspace,subject) VALUES($1,$2,$3,$4)
    ON CONFLICT(user_id) DO NOTHING`, [id, config.portalOrigin, config.workspace, actor.subject]);
  return id;
}

export function registerManagedRoutes(app: Express, config: ControlPlaneConfig, database: Database, sessions: SessionService): void {
  if (!config.managed) return;
  const managed = config.managed;
  app.post("/api/alshival/tools", async (request, response) => {
    response.set("Cache-Control", "no-store");
    if (request.get("origin") !== config.publicOrigin?.origin || request.get("host") !== config.publicOrigin?.host) {
      response.status(403).end(); return;
    }
    const actor = await sessions.actor(request);
    if (!actor || !sessions.validateCsrf(request, actor)) { response.status(403).end(); return; }
    const input = z.object({ method: z.enum(["tools/list", "tools/call"]),
      params: z.record(z.string(), z.unknown()).default({}) }).strict().safeParse(request.body);
    if (!input.success) { response.status(400).end(); return; }
    try {
      const row = await database.pool.query("SELECT portal_grant FROM sessions WHERE token_hash=$1", [actor.session.tokenHash]);
      const grant = new CredentialCipher(config.masterKey).decrypt<{ token: string }>(row.rows[0]?.portal_grant);
      response.json(await portalExchange(config, "tools", { token: grant.token, ...input.data }));
    } catch { response.status(403).json({ error: "Personal Alshival tools are unavailable." }); }
  });
  app.post("/internal/alshival/tools", async (request, response) => {
    const authorization = request.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!safeEqual(authorization, config.workspace.controlToken)) { response.status(401).end(); return; }
    const parsed = z.object({ agentId: z.string().regex(/^(main|nl-[a-f0-9]{32})$/), method: z.enum(["tools/list", "tools/call"]),
      params: z.record(z.string(), z.unknown()).default({}) }).safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: "Invalid agent tool request" }); return; }
    // The workspace control token identifies a runtime, never a human. Tenant
    // processes can choose agentId, so it must not select another user's grant.
    try {
      response.json(await portalExchange(config, "background-tools", {
        method: parsed.data.method, params: parsed.data.params,
      }));
    } catch { response.status(403).json({ error: "Workspace background tools are not authorized." }); }
  });
  app.get("/", (_request, response) => response.redirect(303, "/workspace"));
  app.get("/api/auth/providers", (_request, response) => {
    response.json({ setupComplete: true, managed: { portalUrl: portalEntry(managed) },
      local: { available: false, enabled: false }, passkey: { available: false, enabled: false },
      microsoft: { available: false, enabled: false } });
  });
  app.post("/auth/alshival/handoff", async (request, response) => {
    response.set("Cache-Control", "no-store").set("Referrer-Policy", "no-referrer");
    if (request.get("origin") !== managed.portalOrigin || request.get("host") !== config.publicOrigin?.host
        || typeof request.body?.handoff !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(request.body.handoff)) {
      response.status(403).json({ error: "Invalid portal handoff" }); return;
    }
    try {
      const actor = (await portalCall(config, "redeem", request.body.handoff))!;
      if (!actor.token) throw new Error("Missing session grant");
      const userId = await syncManagedUser(database, managed, actor);
      await sessions.create(response, userId, { token: actor.token, expiresAt: new Date(actor.expires_at) });
      response.redirect(303, request.body.app === "projects" ? "/workspace?app=projects" : "/workspace");
    } catch {
      response.status(403).json({ error: "Launch Neural Labs again from your Alshival workspace." });
    }
  });
  app.use((request, response, next) => {
    const path = request.path.toLowerCase();
    if (/^\/admin(\/|$)/.test(path)) { response.redirect(303, "/workspace"); return; }
    if (/^\/(login|signup|setup|auth)(\/|$)/.test(path)) {
      if (request.method === "GET" || request.method === "HEAD") response.redirect(303, portalEntry(managed));
      else response.status(403).json({ error: "Authentication is managed by Alshival." });
      return;
    }
    if (/^\/api\/(setup|account\/(identities|passkeys)|admin\/(users|authentication|updates))(\/|$)/.test(path)
        || path.startsWith("/api/auth/") && path !== "/api/auth/logout") {
      response.status(403).json({ error: "Managed by Alshival", redirectTo: portalEntry(managed) }); return;
    }
    next();
  });
}

/** Membership is independent of browser login. Removed members lose personal work,
 * while the workspace's separately authorized background agent keeps running. */
async function reconcileMembers(database: Database, config: ControlPlaneConfig): Promise<void> {
  if (!config.managed) return;
  const identities = (await database.pool.query("SELECT user_id, subject FROM managed_identities WHERE issuer=$1 AND workspace=$2",
    [config.managed.portalOrigin, config.managed.workspace])).rows as Array<{ user_id: string; subject: string }>;
  for (let offset = 0; offset < identities.length; offset += 500) {
    const batch = identities.slice(offset, offset + 500);
    let allowed: Array<{ subject: string; role: "admin" | "user" }> = [];
    try {
      const result = await portalExchange(config, "members", { subjects: batch.map(row => row.subject) });
      allowed = z.object({ members: z.array(z.object({ subject: z.string(), role: z.enum(["admin", "user"]) })),
        generation: z.number().int().positive() }).parse(result).members;
    } catch { /* Fail closed, and retry without deleting identity or history. */ }
    const revoked = batch.filter(row => !allowed.some(member => member.subject === row.subject));
    if (revoked.length) {
      const ids = revoked.map(row => row.user_id);
      await database.pool.query("UPDATE users SET status='disabled' WHERE id=ANY($1::uuid[])", [ids]);
      await database.pool.query("DELETE FROM sessions WHERE user_id=ANY($1::uuid[])", [ids]);
    }
    for (const row of batch) {
      const member = allowed.find(value => value.subject === row.subject);
      if (member) await database.pool.query("UPDATE users SET role=$2 WHERE id=$1", [row.user_id, member.role]);
    }
    let failed = false;
    for (let index = 0; index < revoked.length; index += 8) {
      const results = await Promise.allSettled(revoked.slice(index, index + 8).map(async row => {
        const response = await fetch(new URL("/internal/alshival/revoke-member", config.workspace.controlUrl), {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(30000),
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.workspace.controlToken}` },
          body: JSON.stringify({ userId: row.user_id }),
        });
        if (!response.ok) throw new Error("Managed member execution revocation is pending");
      }));
      failed ||= results.some(result => result.status === "rejected");
    }
    if (failed) throw new Error("Managed member execution revocation is pending");
  }
}

let membershipCheckedAt = 0;
export function managedMembersReady(): boolean { return Date.now() - membershipCheckedAt < 90000; }
export async function reconcileManagedMembers(database: Database, config: ControlPlaneConfig): Promise<void> {
  try { await reconcileMembers(database, config); membershipCheckedAt = Date.now(); }
  catch (error) { membershipCheckedAt = 0; throw error; }
}
