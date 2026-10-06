import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import type { Express, Request, Response, RequestHandler } from "express";
import type { SessionActor } from "./types.js";
import { ExternalCollaboration, collaborationInput, credentialInput } from "./externalCollaboration.js";
import { portalExchange } from "./managed.js";
import { NativeAccessError } from "./nativeErrors.js";

export function registerCollaborationRoutes(app: Express, service: ExternalCollaboration, options: {
  active: (req: Request, res: Response) => Promise<SessionActor | undefined>;
  csrf: (req: Request, res: Response, actor: SessionActor) => boolean; sameOrigin: RequestHandler;
}) {
  const wrap = (fn: (req: Request, res: Response) => Promise<void>): RequestHandler => async (req, res) => {
    res.set("Cache-Control", "no-store");
    try { await fn(req,res); }
    catch (error) {
      if (res.headersSent) { res.end(); return; }
      res.status(error instanceof NativeAccessError ? error.status : error instanceof z.ZodError ? 400 : 503)
        .json({ error: error instanceof NativeAccessError ? error.message : error instanceof z.ZodError ? "Invalid collaboration request" : "Collaboration is unavailable; reconcile accepted work before retrying" });
    }
  };
  const token = (req: Request) => /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(req.get("authorization") || "")?.[1] || "";
  app.get("/api/collaboration/credentials", wrap(async (req,res) => {
    const actor = await options.active(req,res); if (!actor) return;
    res.json({ credentials: (await service.database.pool.query(`SELECT id,name,connection_id,model,scopes,expires_at,revoked_at FROM collaboration_credentials WHERE user_id=$1 ORDER BY created_at DESC`, [actor.user.id])).rows });
  }));
  app.post("/api/collaboration/credentials", options.sameOrigin, wrap(async (req,res) => {
    const actor = await options.active(req,res); if (!actor || !options.csrf(req,res,actor)) return;
    res.status(201).json(await service.mint(actor.user.id, credentialInput.parse(req.body)));
  }));
  app.delete("/api/collaboration/credentials/:id", options.sameOrigin, wrap(async (req,res) => {
    const actor = await options.active(req,res); if (!actor || !options.csrf(req,res,actor)) return;
    const id = z.string().uuid().parse(req.params.id);
    const result = await service.database.pool.query("UPDATE collaboration_credentials SET revoked_at=now() WHERE id=$1 AND user_id=$2 RETURNING id", [id,actor.user.id]);
    if (!result.rowCount) throw new NativeAccessError(404,"Credential not found");
    await service.database.audit(actor.user.id,"collaboration.credential.revoked",actor.user.id,{ id });
    res.sendStatus(204);
  }));
  app.post("/api/collaboration/v1", wrap(async (req,res) => { res.json(await service.call(token(req),collaborationInput.parse(req.body))); }));
  app.get("/api/collaboration/v1/sessions/:id/events", wrap(async (req,res) => {
    // One bounded SSE batch. Last-Event-ID provides lossless reconnect without
    // holding a control-plane process or an authorization snapshot indefinitely.
    const input = collaborationInput.parse({ operation: "follow", session: req.params.id,
      after: Number(req.get("last-event-id") || req.query.after || 0), waitMs: 15000 });
    const result = await service.call(token(req),input);
    res.set({ "Content-Type": "text/event-stream", "X-Accel-Buffering": "no" });
    for (const event of result.events || []) res.write(`id: ${event.id}\nevent: activity\ndata: ${JSON.stringify(event)}\n\n`);
    res.end(": reconnect with Last-Event-ID\n\n");
  }));
  app.all("/api/collaboration/mcp", wrap(async (req,res) => {
    const bearer = token(req); await service.credential(bearer);
    const handler = createMcpHandler(() => {
      const server = new McpServer({ name: "neural-labs-collaboration", version: "1.0.0" });
      server.registerTool("collaborate", { description: "Create a private session, submit or follow an Alshival task, cancel it, or resolve an explicitly granted approval. Reuse request IDs; reconcile uncertain outcomes before retrying.", inputSchema: z.object({ request: collaborationInput }) }, async ({ request }) => {
        try { return { content: [{ type: "text" as const, text: JSON.stringify(await service.call(bearer,request)) }] }; }
        catch (error) { return { isError: true, content: [{ type: "text" as const, text: error instanceof NativeAccessError ? error.message : "Collaboration outcome is uncertain; follow the session" }] }; }
      });
      return server;
    }, { legacy: "stateless", onerror: () => {} });
    await toNodeHandler(handler, { onerror: () => {} })(req,res,req.body);
  }));
  if (service.config.managed) app.post("/api/alshival/collaboration", wrap(async (req,res) => {
    const stamp = req.get("X-Neural-Labs-Time") || "", payload = req.body?.payload;
    const signature = req.get("X-Neural-Labs-Signature") || "";
    if (typeof payload !== "string" || Buffer.byteLength(payload)>256*1024 || !/^\d{10}$/.test(stamp)
        || Math.abs(Date.now()/1000-Number(stamp))>30 || !/^[a-f0-9]{64}$/.test(signature)) throw new NativeAccessError(403,"Invalid portal delegation");
    const expected=createHmac("sha256",service.config.managed!.secret).update(`collaboration\n${stamp}\n${payload}`).digest();
    if (!timingSafeEqual(expected,Buffer.from(signature,"hex"))) throw new NativeAccessError(403,"Invalid portal delegation");
    const input=z.object({turn:z.string().uuid(),attempt:z.string().uuid(),generation:z.number().int().positive(),
      request:z.union([collaborationInput,z.object({operation:z.literal("status")}).strict()])}).strict().parse(JSON.parse(payload));
    res.json(await service.managedCall(input));
  }));
  app.post("/internal/collaboration/portal-tools", wrap(async (req,res) => {
    // Only a short execution lease, not a user-selected ID, can select a portal turn.
    const grant=await service.authorize(z.string().uuid().parse(req.get("authorization")?.replace(/^Bearer\s+/i,"")));
    const portal=grant.collaboration.portal;
    if (!portal || grant.purpose !== "turns.start") throw new NativeAccessError(403,"Portal delegation is unavailable");
    const rpc=z.object({jsonrpc:z.literal("2.0"),id:z.union([z.string(),z.number(),z.null()]).optional(),
      method:z.string(),params:z.record(z.string(),z.unknown()).optional()}).strict().parse(req.body);
    if (rpc.method.startsWith("notifications/")) {res.sendStatus(202);return;}
    let result: unknown;
    if (rpc.method === "initialize") result={protocolVersion:typeof rpc.params?.protocolVersion === "string" ? rpc.params.protocolVersion : "2025-06-18",
      capabilities:{tools:{listChanged:false}},serverInfo:{name:"alshival-portal",version:"1.0.0"}};
    else if(rpc.method === "ping") result={};
    else if(["tools/list","tools/call"].includes(rpc.method)) result=await portalExchange(service.config,"agent-tools",{...portal,method:rpc.method,params:rpc.params || {}});
    else {res.json({jsonrpc:"2.0",id:rpc.id??null,error:{code:-32601,message:"Method not found"}});return;}
    await service.authorize(grant.collaboration.lease);
    res.json({jsonrpc:"2.0",id:rpc.id??null,result});
  }));
  app.post("/internal/native/collaboration", wrap(async (req,res) => {
    const supplied = Buffer.from(req.get("authorization")?.replace(/^Bearer\s+/i, "") || ""), expected = Buffer.from(service.config.workspace.controlToken);
    if (!expected.length || supplied.length !== expected.length || !timingSafeEqual(supplied,expected)) throw new NativeAccessError(401,"Unauthorized");
    if ((await service.database.pool.query("SELECT gate FROM update_runtime WHERE singleton")).rows[0]?.gate !== false) throw new NativeAccessError(503,"Workspace maintenance is in progress");
    res.json(await service.authorize(z.object({ collaboration: z.literal(true), grant: z.string().uuid() }).strict().parse(req.body).grant));
  }));
}
