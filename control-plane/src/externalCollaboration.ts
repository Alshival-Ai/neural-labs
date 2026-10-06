/** Optional external participants share the native private-turn engine, not Team Chat. */
import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database } from "./database.js";
import type { ControlPlaneConfig } from "./config.js";
import { hashToken, randomToken } from "./crypto.js";
import { NativeAccessError } from "./nativeErrors.js";
import { portalExchange, syncManagedUser } from "./managed.js";

export const collaborationScopes = z.array(z.enum(["read", "run", "cancel", "approve"])).min(1).max(4);
export const credentialInput = z.object({ name: z.string().trim().min(1).max(120),
  connection: z.string().uuid(), model: z.string().trim().min(1).max(160),
  scopes: collaborationScopes.default(["read", "run", "cancel"]), days: z.number().int().min(1).max(90).default(30) }).strict();
export const collaborationInput = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("create"), requestId: z.string().uuid() }).strict(),
  z.object({ operation: z.literal("send"), session: z.string().uuid(), requestId: z.string().uuid(), text: z.string().min(1).max(128000) }).strict(),
  z.object({ operation: z.literal("follow"), session: z.string().uuid(), after: z.number().int().nonnegative().default(0), waitMs: z.number().int().min(0).max(15000).default(0) }).strict(),
  z.object({ operation: z.literal("cancel"), session: z.string().uuid(), turn: z.string().uuid() }).strict(),
  z.object({ operation: z.literal("approve"), session: z.string().uuid(), approval: z.string().uuid(), decision: z.record(z.string(), z.unknown()) }).strict(),
]);
const purposes: Record<string, string> = { create: "conversations.create", send: "turns.start", follow: "events.read", cancel: "turns.cancel", approve: "approvals.resolve" };
const scopes: Record<string, string> = { "conversations.create": "run", "turns.start": "run", "events.read": "read", "turns.cancel": "cancel", "approvals.resolve": "approve" };

export class ExternalCollaboration {
  constructor(readonly database: Database, readonly config: ControlPlaneConfig, readonly request: typeof fetch = fetch) {}
  async member(user: string) {
    const actor = await this.database.getUser(user);
    if (!actor || actor.status !== "active") throw new NativeAccessError(403, "Collaboration membership was revoked");
    let generation = 0;
    if (this.config.managed) {
      const managed = this.config.managed;
      const identity = (await this.database.pool.query(`SELECT subject FROM managed_identities WHERE user_id=$1 AND issuer=$2 AND workspace=$3`,
        [user, managed.portalOrigin, managed.workspace])).rows[0];
      if (!identity) throw new NativeAccessError(403, "Managed membership is unavailable");
      const members = z.object({ generation: z.number().int().positive(), members: z.array(z.object({ subject: z.string(), role: z.enum(["admin", "user"]) })) })
        .parse(await portalExchange(this.config, "members", { subjects: [identity.subject] }));
      const member = members.members.find(row => row.subject === identity.subject);
      if (!member) throw new NativeAccessError(403, "Managed membership was revoked");
      actor.role = member.role; generation = members.generation;
    }
    return { actor, generation };
  }
  async mint(user: string, input: z.infer<typeof credentialInput>) {
    await this.member(user);
    const connection = (await this.database.pool.query(`SELECT * FROM native_connections WHERE id=$1 AND enabled
      AND (scope='shared' OR scope='personal' AND user_id=$2)`, [input.connection, user])).rows[0];
    if (!connection) throw new NativeAccessError(403, "Choose your own or an explicitly shared model connection");
    const token = randomToken(), id = randomUUID();
    await this.database.pool.query(`INSERT INTO collaboration_credentials
      (id,user_id,name,token_hash,connection_id,generation,model,scopes,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+$9*interval '1 day')`,
      [id,user,input.name,hashToken(token),connection.id,connection.generation,input.model,JSON.stringify(input.scopes),input.days]);
    await this.database.audit(user, "collaboration.credential.created", user, { id, scopes: input.scopes });
    return { id, token, endpoint: "/api/collaboration/v1", mcp: "/api/collaboration/mcp" };
  }
  async credential(token: string) {
    if (!token || token.length > 256) throw new NativeAccessError(401, "Collaboration credential required");
    const row = (await this.database.pool.query(`SELECT * FROM collaboration_credentials
      WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now()`, [hashToken(token)])).rows[0];
    if (!row) throw new NativeAccessError(401, "Collaboration credential is expired or revoked");
    await this.member(row.user_id);
    return row;
  }
  async authorize(id: string) {
    const row = (await this.database.pool.query(`SELECT l.*,s.id AS session,c.id AS principal,c.user_id,c.name,c.connection_id,c.generation,c.model,c.scopes,c.managed_source,
      n.provider,n.method,n.scope,n.user_id AS connection_user,n.enabled,n.generation AS current_generation
      FROM collaboration_leases l JOIN collaboration_sessions s ON s.id=l.session_id
      JOIN collaboration_credentials c ON c.id=s.credential_id JOIN native_connections n ON n.id=c.connection_id
      WHERE l.id=$1 AND l.expires_at>now() AND c.revoked_at IS NULL AND c.expires_at>now()`, [id])).rows[0];
    if (!row || !row.enabled || row.generation !== row.current_generation
        || !(row.scope === "shared" || row.scope === "personal" && row.connection_user === row.user_id)
        || !Array.isArray(row.scopes) || !row.scopes.includes(scopes[row.purpose])) throw new NativeAccessError(403, "Collaboration execution was revoked");
    const { actor, generation } = await this.member(row.user_id);
    if (row.managed_turn) {
      const identity = await this.managedIdentity(row.managed_turn, row.managed_attempt, row.runtime_generation, row.purpose === "events.read");
      if (identity.user !== actor.id || identity.source !== row.managed_source) throw new NativeAccessError(403, "Portal turn binding changed");
    }
    const updated = await this.database.pool.query(`UPDATE collaboration_leases SET expires_at=now()+interval '30 seconds' WHERE id=$1 AND expires_at>now() RETURNING id`, [id]);
    if (!updated.rowCount) throw new NativeAccessError(403, "Collaboration lease expired");
    return { actor: actor.id, actorRole: actor.role, connection: row.connection_id,
      binding: { owner: row.connection_id, provider: row.provider, generation: row.generation, method: row.method },
      scope: row.scope, model: row.model, purpose: row.purpose, background: false, authorityGeneration: generation,
      policy: { sandbox: "workspace-write", approval: "on-request" },
      collaboration: { lease: id, principal: row.principal, name: row.name, session: row.session, kind: row.managed_turn ? "delegated-human" : "external-agent",
        ...(row.managed_turn ? { portal: { turn: row.managed_turn, attempt: row.managed_attempt, generation: row.runtime_generation } } : {}) } };
  }
  async managedIdentity(turn: string, attempt: string, generation: number, readOnly = false) {
    if (!this.config.managed) throw new NativeAccessError(404, "Managed collaboration is unavailable");
    const value = z.object({ subject: z.string(), email: z.string(), display_name: z.string(), role: z.enum(["admin", "user"]),
      workspace: z.string(), instance: z.string(), origin: z.string(), generation: z.number(), expires_at: z.string(), source: z.string().uuid() })
      .parse(await portalExchange(this.config, "agent-authorize", { turn, attempt, generation, read_only: readOnly }));
    if (value.workspace !== this.config.managed.workspace || value.instance !== this.config.managed.instance
        || value.origin !== this.config.publicOrigin?.origin || value.generation !== generation || Date.parse(value.expires_at) <= Date.now())
      throw new NativeAccessError(403, "Portal execution binding changed");
    return { ...value, user: await syncManagedUser(this.database,this.config.managed,value) };
  }
  async managedCall(input: { turn: string; attempt: string; generation: number; request: z.infer<typeof collaborationInput> | { operation: "status" } }) {
    const identity = await this.managedIdentity(input.turn,input.attempt,input.generation,input.request.operation === "follow");
    const token = createHmac("sha256",this.config.managed!.secret).update(`collaboration:${identity.user}:${identity.source}`).digest("base64url");
    if (input.request.operation === "follow") {
      const existing = await this.database.pool.query(`UPDATE collaboration_credentials SET expires_at=now()+interval '30 minutes'
        WHERE user_id=$1 AND managed_source=$2 AND token_hash=$3 AND revoked_at IS NULL RETURNING id`,
        [identity.user,identity.source,hashToken(token)]);
      if (existing.rowCount !== 1) throw new NativeAccessError(403,"Conversation access was revoked");
      return this.call(token,input.request,{turn:input.turn,attempt:input.attempt,generation:input.generation});
    }
    const selected = (await this.database.pool.query(`SELECT d.connection_id,d.model,n.generation FROM native_chat_defaults d
      JOIN native_connections n ON n.id=d.connection_id AND n.enabled AND n.generation=d.connection_generation
      WHERE d.selection_key=$1 AND (n.scope='shared' OR n.scope='personal' AND n.user_id=$2)`, [`user:${identity.user}`,identity.user])).rows[0];
    if (!selected) throw new NativeAccessError(409,"Choose a personal or shared model in Neural Labs first");
    if (input.request.operation === "status") return { version: 1, available: true };
    const binding = await this.database.pool.query(`INSERT INTO collaboration_credentials
      (id,user_id,name,token_hash,connection_id,generation,model,scopes,expires_at,managed_source)
      VALUES($1,$2,'Portal private conversation',$3,$4,$5,$6,'["read","run","cancel","approve"]',now()+interval '30 minutes',$7)
      ON CONFLICT(user_id,managed_source) WHERE managed_source IS NOT NULL DO UPDATE SET
      expires_at=excluded.expires_at
      WHERE collaboration_credentials.revoked_at IS NULL AND collaboration_credentials.connection_id=excluded.connection_id
        AND collaboration_credentials.generation=excluded.generation AND collaboration_credentials.model=excluded.model`,
      [randomUUID(),identity.user,hashToken(token),selected.connection_id,selected.generation,selected.model,identity.source]);
    if (binding.rowCount !== 1) throw new NativeAccessError(409,"Conversation provider changed or access was revoked; start a new conversation");
    return this.call(token,input.request,{turn:input.turn,attempt:input.attempt,generation:input.generation});
  }
  async call(token: string, input: z.infer<typeof collaborationInput>, portal?: {turn:string;attempt:string;generation:number}) {
    const credential = await this.credential(token), purpose = purposes[input.operation]!;
    if (!credential.scopes.includes(scopes[purpose])) throw new NativeAccessError(403, "Collaboration scope is not granted");
    let session: string;
    if (input.operation === "create") {
      const result = await this.database.pool.query(`INSERT INTO collaboration_sessions(id,credential_id,request_id)
        VALUES($1,$2,$3) ON CONFLICT(credential_id,request_id) DO UPDATE SET request_id=excluded.request_id RETURNING id`,
        [randomUUID(),credential.id,input.requestId]);
      session = result.rows[0].id;
    } else {
      const result = await this.database.pool.query("SELECT id FROM collaboration_sessions WHERE id=$1 AND credential_id=$2", [input.session,credential.id]);
      if (!result.rowCount) throw new NativeAccessError(404, "Collaboration session not found");
      session = input.session;
    }
    const lease = randomUUID();
    await this.database.pool.query(`INSERT INTO collaboration_leases(id,session_id,purpose,expires_at,managed_turn,managed_attempt,runtime_generation) VALUES($1,$2,$3,now()+interval '30 seconds',$4,$5,$6)`, [lease,session,purpose,portal?.turn??null,portal?.attempt??null,portal?.generation??null]);
    await this.authorize(lease);
    const params = input.operation === "send" ? { conversation: session, requestId: input.requestId, input: [{ type: "text", text: input.text }] }
      : input.operation === "follow" ? { conversation: session, after: input.after, waitMs: input.waitMs }
      : input.operation === "cancel" ? { turn: input.turn }
      : input.operation === "approve" ? { approval: input.approval, decision: input.decision } : {};
    const response = await this.request(new URL("/internal/native/request", this.config.workspace.controlUrl), {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.config.workspace.controlToken}` },
      body: JSON.stringify({ actor: credential.user_id, lease: { collaboration: true, grant: lease }, operation: purpose, params }) });
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    const reader = response.body?.getReader();
    if (!reader) throw new NativeAccessError(503,"Execution response is unavailable");
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 4 * 1024 * 1024) {
          await reader.cancel();
          throw new NativeAccessError(503,"Execution response exceeds limit");
        }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    const text = Buffer.concat(chunks).toString("utf8");
    // No automatic retry: a transport failure after dispatch has an uncertain outcome.
    if (!response.ok) throw new NativeAccessError(response.status >= 500 ? 503 : 409, "Execution could not be confirmed; follow this session before retrying");
    await this.credential(token);
    return { ...JSON.parse(text), session };
  }
}
