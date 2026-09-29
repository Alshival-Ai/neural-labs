/** Optional portal client of the existing Team Chat store and execution queue. */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Express } from "express";
import { z } from "zod";
import type { ControlPlaneConfig } from "./config.js";
import type { Database } from "./database.js";
import { CollaborationError, type CollaborationStore, type TeamAgentInvocation } from "./collaboration.js";
import type { CollaborationEvent } from "./server.js";
import { portalCall, portalExchange, resolveManagedUserId, syncManagedUser } from "./managed.js";
import type { UserRecord } from "./types.js";

export const MANAGED_CHAT_PROTOCOL = 1;

const inputSchema = z.object({
  token: z.string().min(32).max(256),
  operation: z.enum(["list", "create", "history", "send", "cancel", "import"]),
  channel: z.string().uuid().optional(),
  sourceConversation: z.string().uuid().optional(),
  requestId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(160).optional(),
  body: z.string().max(128 * 1024).optional(),
  before: z.number().int().positive().optional(),
  attachments: z.array(z.object({ path: z.string().max(4096), name: z.string().max(255),
    type: z.string().max(255).optional(), size: z.number().int().nonnegative().optional() })).max(100).default([]),
}).strict();

export function validBridgeSignature(secret: string, stamp: string, payload: string, signature: string): boolean {
  if (!/^\d{10}$/.test(stamp) || Math.abs(Date.now() / 1000 - Number(stamp)) > 30 || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(`chat\n${stamp}\n${payload}`).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

export function registerManagedChat(app: Express, config: ControlPlaneConfig, database: Database,
  store: CollaborationStore, publish: (event: CollaborationEvent) => void,
  enqueue: (run: TeamAgentInvocation) => void, cancel: (id: string) => void): void {
  if (!config.managed) return;
  const managed = config.managed;
  app.post("/api/alshival/chat-bridge", async (request, response) => {
    response.set("Cache-Control", "no-store");
    const payload = request.body?.payload;
    if (typeof payload !== "string" || Buffer.byteLength(payload) > 256 * 1024
        || !validBridgeSignature(managed.secret, request.get("X-Neural-Labs-Time") ?? "", payload,
          request.get("X-Neural-Labs-Signature") ?? "")) {
      response.status(403).json({ error: "access_denied" }); return;
    }
    let input: z.infer<typeof inputSchema>;
    try { input = inputSchema.parse(JSON.parse(payload)); }
    catch { response.status(400).json({ error: "invalid_request" }); return; }
    try {
      // The signature authenticates the instance, never a member. Revalidate
      // the portal session, workspace membership and generation on every poll.
      const identity = (await portalCall(config, "authorize", input.token))!;
      const id = await syncManagedUser(database, managed, identity);
      const row = (await database.pool.query("SELECT * FROM users WHERE id=$1 AND status='active'", [id])).rows[0];
      if (!row) { response.status(403).end(); return; }
      const actor: UserRecord = { id, email: row.email, handle: row.handle, displayName: row.display_name,
        role: row.role, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at };
      if (input.operation === "import") {
        if (!input.sourceConversation) { response.status(400).end(); return; }
        const imported = z.object({ workspace: z.string().uuid(), instance: z.string().uuid(), generation: z.number().int(),
          id: z.string().uuid(), name: z.string().max(300),
          users: z.array(z.object({ subject: z.string().max(128), email: z.string().email(), display_name: z.string().max(512) })).max(2000),
          messages: z.array(z.object({ role: z.enum(["user", "assistant"]), subject: z.string().optional(),
            body: z.string().max(128 * 1024), createdAt: z.string().datetime({ offset: true }),
            attachments: z.array(z.object({ path: z.string(), name: z.string(), size: z.number().int().nonnegative() })).max(100) })).max(2000),
        }).parse(await portalExchange(config, "shared-history", { token: input.token, conversation: input.sourceConversation }));
        if (imported.workspace !== managed.workspace || imported.instance !== managed.instance
            || imported.generation !== identity.generation || imported.id !== input.sourceConversation)
          throw new Error("Shared history binding mismatch");
        const authorIds = new Map<string, string>();
        for (const user of imported.users) {
          const historicalId = await resolveManagedUserId(database, managed, user.subject);
          authorIds.set(user.subject, historicalId);
          // Preserve historical authors without giving former members a login
          // or enrolling them into currently active workspace membership.
          await database.pool.query(`INSERT INTO users(id,email,normalized_email,display_name,handle,role,status)
            VALUES($1,$2,lower($2),$3,$4,'user','disabled') ON CONFLICT(id) DO NOTHING`,
            [historicalId, user.email, user.display_name, `p-${historicalId.replaceAll("-", "").slice(0,28)}`]);
        }
        for (const message of imported.messages) {
          if (message.subject && !authorIds.has(message.subject))
            authorIds.set(message.subject, await resolveManagedUserId(database, managed, message.subject));
        }
        const result = await store.createChannel(actor, { name: imported.name || "Alshival · Workspace-shared",
          audience: "everyone", memberIds: [], importSource: `portal:${managed.workspace}:${imported.id}`,
          importedMessages: imported.messages.map(message => ({ ...message,
            ...(message.subject ? { authorUserId: authorIds.get(message.subject)! } : {}) })),
        });
        publish({ type: "channels.changed", channelId: result.channel.id });
        response.json(result); return;
      }
      if (input.operation === "list") {
        response.json({ channels: await store.listChannels(actor) }); return;
      }
      if (input.operation === "create") {
        if (!input.requestId) { response.status(400).end(); return; }
        const result = await store.createChannel(actor, { name: input.name ?? "Alshival · Workspace-shared",
          audience: "everyone", memberIds: [], sourceSessionKey: `portal:${input.requestId}` });
        publish({ type: "channels.changed", channelId: result.channel.id });
        response.json(result); return;
      }
      if (!input.channel) { response.status(400).end(); return; }
      if (input.operation === "cancel") {
        for (const run of await store.cancelRun(actor, input.channel)) {
          cancel(run.id);
          publish({ type: "agent.status", channelId: input.channel, run });
        }
      }
      if (input.operation === "send") {
        if (!input.requestId) { response.status(400).end(); return; }
        const result = await store.postMessage(actor, { channelId: input.channel, body: input.body ?? "",
          attachments: input.attachments, clientRequestId: input.requestId });
        publish({ type: "message.created", channelId: input.channel, message: result.message });
        publish({ type: "channels.changed", channelId: input.channel });
        if (result.run) {
          const { capability: _capability, ...run } = result.run;
          publish({ type: "agent.status", channelId: input.channel, run });
          enqueue(result.run);
        }
      }
      response.json({ channel: (await store.listChannels(actor)).find(channel => channel.id === input.channel),
        messages: await store.listMessages(actor, input.channel, input.before),
        run: await store.latestRun(actor, input.channel) });
    } catch (error) {
      if (error instanceof CollaborationError) response.status(error.status).json({ error: error.code });
      else response.status(503).json({ error: "shared_chat_unavailable" });
    }
  });
}
