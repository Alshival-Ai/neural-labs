/** Personal OAuth connection; managed workspaces reuse portal sign-in instead. */
import { createHash, randomBytes } from "node:crypto";
import type { Express, Request, Response, RequestHandler } from "express";
import type { Database } from "./database.js";
import type { ControlPlaneConfig } from "./config.js";
import type { SessionActor } from "./types.js";
import { CredentialCipher } from "./crypto.js";
const ORIGIN = "https://alshival.ai", RESOURCE = "https://mcp.alshival.ai/workspace/mcp/";
function tokenExpiry(value: unknown) {
  const seconds = Number(value ?? 3600);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("Invalid token expiry");
  return Date.now() + seconds * 1000;
}
interface Credential { client: string; access?: string; refresh?: string; expires?: number;
  pending?: { state: string; verifier: string; expires: number; redirect: string }; }
const key = (user: string) => `alshival:${user}`;
async function post(url: string, body: Record<string, unknown>, form = false) {
  const response = await fetch(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": form ? "application/x-www-form-urlencoded" : "application/json" },
    body: form ? new URLSearchParams(body as Record<string, string>) : JSON.stringify(body) });
  if (!response.ok) throw new Error("Alshival.Ai connection unavailable");
  return await response.json() as Record<string, any>;
}
export class AlshivalConnection {
  private cipher: CredentialCipher;
  constructor(private database: Database, private config: ControlPlaneConfig) { this.cipher = new CredentialCipher(config.masterKey); }
  async load(user: string) {
    const row = (await this.database.pool.query("SELECT * FROM plugin_connections WHERE plugin_id=$1 AND enabled=true", [key(user)])).rows[0];
    return row?.encrypted_credentials ? { credential: this.cipher.decrypt<Credential>(row.encrypted_credentials), revision: Number(row.revision) } : undefined;
  }
  async save(user: string, credential: Credential, revision?: number) {
    const encrypted = this.cipher.encrypt(credential);
    if (revision !== undefined) {
      const result = await this.database.pool.query(`UPDATE plugin_connections SET encrypted_credentials=$2,
        revision=revision+1,updated_at=now() WHERE plugin_id=$1 AND revision=$3 AND enabled=true`, [key(user), encrypted, revision]);
      if (!result.rowCount) throw new Error("Connection changed; reconnect");
    } else await this.database.pool.query(`INSERT INTO plugin_connections(plugin_id,enabled,public_config,encrypted_credentials,source)
      VALUES($1,true,'{}',$2,'settings') ON CONFLICT(plugin_id) DO UPDATE SET enabled=true,
      encrypted_credentials=EXCLUDED.encrypted_credentials,revision=plugin_connections.revision+1,updated_at=now()`, [key(user), encrypted]);
  }
  async status(user: string) {
    const connected = Boolean(this.config.managed || (await this.load(user))?.credential.access);
    return { id: "alshival-ai", name: "Alshival.Ai", type: "alshival" as const, scope: "private" as const,
      ownership: this.config.managed ? "system" as const : "user" as const, editable: !this.config.managed,
      configured: connected, ready: connected, managed: Boolean(this.config.managed),
      description: "Portal tasks, notes, resources and attachments using your account permissions." };
  }
  async connect(user: string) {
    if (this.config.managed) throw new Error("Managed by portal sign-in");
    const redirect = new URL("/api/plugins/alshival/callback", this.config.publicOrigin).href;
    if (!redirect.startsWith("https://")) throw new Error("HTTPS required");
    const registration = await post(ORIGIN + "/oauth/register/", { client_name: "Neural Labs — Alshival.Ai",
      application_type: "web", redirect_uris: [redirect], token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] });
    if (typeof registration.client_id !== "string") throw new Error("Invalid registration");
    const state = randomBytes(32).toString("base64url"), verifier = randomBytes(32).toString("base64url");
    const previous = await this.load(user);
    await this.save(user, { client: registration.client_id, pending: {
      state: createHash("sha256").update(state).digest("hex"), verifier, redirect, expires: Date.now() + 300000 } }, previous?.revision);
    return { url: ORIGIN + "/oauth/authorize/?" + new URLSearchParams({ client_id: registration.client_id,
      redirect_uri: redirect, response_type: "code", scope: "project:read tasks:write tasks:manage board:write project:write project:comment notes:write resources:read resources:write offline_access",
      resource: RESOURCE, state, code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url") }) };
  }
  async complete(user: string, state: string, code: string) {
    const row = await this.load(user), pending = row?.credential.pending;
    if (!row || !pending || pending.expires < Date.now() || pending.state !== createHash("sha256").update(state).digest("hex")) throw new Error("Sign-in expired");
    const token = await post(ORIGIN + "/oauth/token/", { grant_type: "authorization_code", client_id: row.credential.client,
      redirect_uri: pending.redirect, code, code_verifier: pending.verifier, resource: RESOURCE }, true);
    if (typeof token.access_token !== "string") throw new Error("Invalid token response");
    await this.save(user, { client: row.credential.client, access: token.access_token, refresh: token.refresh_token,
      expires: tokenExpiry(token.expires_in) }, row.revision);
  }
  async disconnect(user: string) {
    if (this.config.managed) throw new Error("Managed by portal sign-in");
    await this.database.pool.query(`UPDATE plugin_connections SET enabled=false,encrypted_credentials=NULL,
      revision=revision+1,updated_at=now() WHERE plugin_id=$1`, [key(user)]);
  }
  async invoke(user: string, method: string, params: unknown) {
    let row = await this.load(user);
    if (!row?.credential.access) throw new Error("Connect your Alshival.Ai account first");
    if ((row.credential.expires || 0) < Date.now() + 60000) {
      if (!row.credential.refresh) throw new Error("Reconnect your account");
      const token = await post(ORIGIN + "/oauth/token/", { grant_type: "refresh_token", client_id: row.credential.client,
        refresh_token: row.credential.refresh, resource: RESOURCE }, true);
      if (typeof token.access_token !== "string") throw new Error("Invalid token response");
      await this.save(user, { ...row.credential, access: token.access_token, refresh: token.refresh_token || row.credential.refresh,
        expires: tokenExpiry(token.expires_in) }, row.revision);
      row = (await this.load(user))!;
    }
    const connectedRevision = row.revision;
    let session: string | null = null;
    const send = async (body: unknown) => {
      const response = await fetch(RESOURCE, { method: "POST", redirect: "error", signal: AbortSignal.timeout(65000),
        headers: { Authorization: `Bearer ${row.credential.access}`, "Content-Type": "application/json",
          Accept: "application/json, text/event-stream", ...(session ? { "Mcp-Session-Id": session } : {}) }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(response.status === 429 ? "Portal rate limit reached; retry later" : "Portal MCP request failed");
      session = response.headers.get("mcp-session-id") || session;
      const chunks: Uint8Array[] = []; let length = 0;
      for await (const chunk of response.body || []) { length += chunk.length; if (length > 4 * 1024 * 1024) throw new Error("Portal response exceeds limit"); chunks.push(chunk); }
      const text = Buffer.concat(chunks).toString(); if (!text.trim()) return {};
      if (response.headers.get("content-type")?.includes("text/event-stream")) {
        const result = text.split(/\r?\n\r?\n/).map(event => event.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n"))
          .filter(Boolean).map(data => JSON.parse(data)).find(message => message.id !== undefined);
        if (!result) throw new Error("Portal returned no result"); return result;
      }
      return JSON.parse(text);
    };
    try {
      const initialized = await send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "neural-labs", version: "1" } } });
      if (initialized.error || !initialized.result) throw new Error("Portal MCP initialization failed");
      await send({ jsonrpc: "2.0", method: "notifications/initialized" });
      const result = await send({ jsonrpc: "2.0", id: 2, method, params });
      if ((await this.load(user))?.revision !== connectedRevision) throw new Error("Connection revoked or changed");
      if (result.error) throw new Error("Portal tool request failed"); return result.result;
    } finally {
      if (session) {
        // Each invocation owns its remote session; do not accumulate live sessions.
        await fetch(RESOURCE, { method: "DELETE", redirect: "error", signal: AbortSignal.timeout(5000),
          headers: { Authorization: `Bearer ${row.credential.access}`, "Mcp-Session-Id": session,
            "MCP-Protocol-Version": "2025-03-26" } }).catch(() => undefined);
      }
    }
  }
}
export function registerAlshivalConnection(app: Express, database: Database, config: ControlPlaneConfig,
  options: { active: (req: Request, res: Response) => Promise<SessionActor | undefined>; sameOrigin: RequestHandler;
    csrf: (req: Request, res: Response, actor: SessionActor) => boolean }) {
  const connection = new AlshivalConnection(database, config);
  app.post("/api/plugins/alshival/connect", options.sameOrigin, async (req, res) => {
    const actor = await options.active(req, res); if (!actor || !options.csrf(req, res, actor)) return;
    try { res.json(await connection.connect(actor.user.id)); } catch { res.status(409).json({ error: "Account connection could not start" }); }
  });
  app.delete("/api/plugins/alshival", options.sameOrigin, async (req, res) => {
    const actor = await options.active(req, res); if (!actor || !options.csrf(req, res, actor)) return;
    try { await connection.disconnect(actor.user.id); res.json({ disconnected: true }); } catch { res.status(409).json({ error: "Managed by portal sign-in" }); }
  });
  app.get("/api/plugins/alshival/callback", async (req, res) => {
    const actor = await options.active(req, res); if (!actor) return;
    try { if (typeof req.query.state !== "string" || typeof req.query.code !== "string") throw new Error();
      await connection.complete(actor.user.id, req.query.state, req.query.code); res.redirect(303, "/workspace?app=settings");
    } catch { res.status(400).send("Alshival.Ai sign-in could not complete. Return to Plugins and reconnect."); }
  });
  return connection;
}
