import { z } from "zod";
import type { Database } from "./database.js";
import type { ControlPlaneConfig } from "./config.js";
import { portalExchange } from "./managed.js";
import { NativeAccessError } from "./nativeErrors.js";

export const nativeBackgroundSchema = z.object({
  job: z.string().min(1).max(200), actor: z.string().uuid(), connection: z.string().uuid(),
  generation: z.number().int().positive(), provider: z.enum(["codex", "claude"]), method: z.enum(["subscription", "api-key"]),
  model: z.string().trim().min(1).max(160),
  policy: z.object({ sandbox: z.enum(["read-only", "workspace-write"]), approval: z.literal("on-request") }).strict(),
}).strict();

// Called only by the trusted runtime for a saved job, never by a browser's
// connection picker. It issues no user session or integration credential.
export async function authorizeNativeBackground(database: Database, config: ControlPlaneConfig,
  input: z.infer<typeof nativeBackgroundSchema>, exchange = portalExchange) {
  const member = (await database.pool.query("SELECT id,role,status FROM users WHERE id=$1", [input.actor])).rows[0];
  const connection = (await database.pool.query("SELECT * FROM native_connections WHERE id=$1", [input.connection])).rows[0];
  if (!member || member.status !== "active" || !connection?.enabled
      || connection.provider !== input.provider || connection.method !== input.method || connection.generation !== input.generation
      || (connection.scope === "personal" ? connection.user_id !== input.actor : member.role !== "admin")) {
    throw new NativeAccessError(403, "The saved automation account is unavailable");
  }
  let authorityGeneration = 0;
  if (config.managed) {
    const identity = (await database.pool.query("SELECT subject FROM managed_identities WHERE user_id=$1 AND issuer=$2 AND workspace=$3",
      [input.actor, config.managed.portalOrigin, config.managed.workspace])).rows[0];
    if (!identity) throw new NativeAccessError(403, "The automation owner is unavailable");
    const response = z.object({ authorized: z.literal(true), workspace: z.string().uuid(), instance: z.string().uuid(), generation: z.number().int().positive() })
      .parse(await exchange(config, "background-authorize", { subject: identity.subject }));
    if (response.workspace !== config.managed.workspace || response.instance !== config.managed.instance)
      throw new NativeAccessError(403, "The automation workspace binding changed");
    authorityGeneration = response.generation;
  }
  return { actor: input.actor, actorRole: member.role, connection: input.connection,
    binding: { owner: input.connection, provider: input.provider, generation: input.generation, method: input.method },
    scope: connection.scope, model: input.model, policy: input.policy, background: true, authorityGeneration, purpose: "scheduled-run" };
}
