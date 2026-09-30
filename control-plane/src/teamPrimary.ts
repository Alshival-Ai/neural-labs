import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

/** The workspace channel is local to this installation and needs no portal. */
export async function ensurePrimaryChannel(client: Pool | PoolClient, actorId: string): Promise<string> {
  await client.query(`INSERT INTO team_channels(id,name,audience,owner_user_id,import_source)
    VALUES($1,'Team channel','everyone',$2,'workspace:primary') ON CONFLICT(import_source) DO NOTHING`,
  [randomUUID(), actorId]);
  return (await client.query<{ id: string }>("SELECT id FROM team_channels WHERE import_source='workspace:primary'")).rows[0]!.id;
}
