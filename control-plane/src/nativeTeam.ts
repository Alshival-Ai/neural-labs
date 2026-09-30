import { z } from "zod";
import type { Database } from "./database.js";
import type { ControlPlaneConfig } from "./config.js";
import { hashToken } from "./crypto.js";
import { portalExchange } from "./managed.js";
import { NativeAccessError } from "./nativeErrors.js";

export const nativeTeamSchema = z.object({
  run: z.string().uuid(), channel: z.string().uuid(), actor: z.string().uuid(),
  capability: z.string().min(32).max(256),
}).strict();

export async function authorizeNativeTeam(database: Database, config: ControlPlaneConfig,
  input: z.infer<typeof nativeTeamSchema>, exchange = portalExchange) {
  const result = await database.pool.query(`SELECT r.id,r.channel_id,r.requested_by,u.role,u.status,
      c.audience,c.owner_user_id,d.connection_id,d.connection_generation,d.model,d.revision,
      n.scope,n.provider,n.method,n.generation,n.enabled
    FROM team_agent_runs r
    JOIN users u ON u.id=r.requested_by
    JOIN team_channels c ON c.id=r.channel_id
    LEFT JOIN native_chat_defaults d ON d.selection_key='workspace:team'
    LEFT JOIN native_connections n ON n.id=d.connection_id
    WHERE r.id=$1 AND r.channel_id=$2 AND r.requested_by=$3 AND r.capability_hash=$4
      AND r.status='running' AND r.expires_at>now()`,
  [input.run, input.channel, input.actor, hashToken(input.capability)]);
  const row = result.rows[0];
  if (!row || row.status !== "active" || !row.enabled || row.scope !== "team"
      || row.generation !== row.connection_generation
      || !(row.audience === "everyone" || row.owner_user_id === input.actor
        || (await database.pool.query(`SELECT 1 FROM team_channel_members WHERE channel_id=$1 AND user_id=$2`,
          [input.channel, input.actor])).rowCount)) {
    throw new NativeAccessError(403, "The Team Chat run or selected connection is unavailable");
  }
  let authorityGeneration = 0;
  if (config.managed) {
    const identity = (await database.pool.query(`SELECT subject FROM managed_identities
      WHERE user_id=$1 AND issuer=$2 AND workspace=$3`,
    [input.actor, config.managed.portalOrigin, config.managed.workspace])).rows[0];
    if (!identity) throw new NativeAccessError(403, "Team Chat membership is unavailable");
    const members = z.object({ generation: z.number().int().positive(),
      members: z.array(z.object({ subject: z.string(), role: z.enum(["admin", "user"]) })) })
      .parse(await exchange(config, "members", { subjects: [identity.subject] }));
    if (!members.members.some(member => member.subject === identity.subject))
      throw new NativeAccessError(403, "Team Chat membership was revoked");
    authorityGeneration = members.generation;
  }
  return { actor: input.actor, actorRole: row.role, connection: row.connection_id,
    binding: { owner: row.connection_id, provider: row.provider, generation: row.generation, method: row.method },
    scope: "team", model: row.model, policy: { sandbox: "workspace-write", approval: "on-request" },
    background: false, authorityGeneration, purpose: "team-run", team: { run: input.run, channel: input.channel,
      capability: input.capability, revision: Number(row.revision) } };
}
