/** Offline operator migration. Never called by a request or ordinary startup. */
import { z } from "zod";
import type { Database } from "./database.js";
import type { ManagedConfig } from "./managed.js";

export const adoptionSchema = z.object({
  users: z.array(z.object({
    userId: z.string().uuid(), subject: z.string().min(1).max(128),
    expectedEmail: z.string().email(),
  }).strict()).min(1).max(500),
}).strict();

/** Caller must stop ingress/control plane and retain a database recovery copy. */
export async function adoptManagedIdentity(database: Database, config: ManagedConfig,
  input: unknown, confirm = false): Promise<{ users: number; committed: boolean }> {
  const mapping = adoptionSchema.parse(input).users;
  if (new Set(mapping.map(row => row.userId)).size !== mapping.length
      || new Set(mapping.map(row => row.subject)).size !== mapping.length)
    throw new Error("Identity mappings must be one-to-one");
  const client = await database.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(67209381)");
    await client.query("LOCK TABLE users, managed_identities, deployment_identity, sessions IN EXCLUSIVE MODE");
    const binding = (await client.query("SELECT binding FROM deployment_identity WHERE singleton")).rows[0]?.binding;
    if (!binding || binding.mode !== "standalone" || Object.keys(binding).length !== 1)
      throw new Error("Only a bound standalone database can be adopted");
    if ((await client.query("SELECT user_id FROM managed_identities LIMIT 1")).rowCount)
      throw new Error("Database already has managed identities");
    const users = (await client.query("SELECT id, normalized_email FROM users")).rows;
    if (users.length !== mapping.length || users.some(user => !mapping.some(row =>
      row.userId === user.id && row.expectedEmail.trim().toLowerCase() === user.normalized_email)))
      throw new Error("Mapping must explicitly cover every existing user with its expected email");
    for (const row of mapping) await client.query(
      "INSERT INTO managed_identities(user_id,issuer,workspace,subject) VALUES($1,$2,$3,$4)",
      [row.userId, config.portalOrigin, config.workspace, row.subject]);
    await client.query("DELETE FROM sessions");
    await client.query("UPDATE deployment_identity SET binding=$1 WHERE singleton", [{
      mode: "alshival", issuer: config.portalOrigin, workspace: config.workspace, instance: config.instance,
    }]);
    await client.query(confirm ? "COMMIT" : "ROLLBACK");
    return { users: users.length, committed: confirm };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
