/** Generic, resumable project transfer. No billing or hosting-provider policy. */
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { z } from "zod";
import { ProjectError, projectFields } from "./projects.js";

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
export const checksum = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const uuid = z.string().uuid();
const importedItem = z.object({ id: uuid, kind: z.enum(["task", "deliverable", "note", "resource", "ticket", "comment"]),
  revision: z.number().int().positive(), data: z.record(z.string(), z.unknown()).superRefine((value, ctx) => {
    const parsed = projectFields.safeParse(value);
    if (!parsed.success) ctx.addIssue({ code: "custom", message: "Invalid project fields" });
  }), author_id: uuid,
  created_at: z.iso.datetime({ offset: true }), updated_at: z.iso.datetime({ offset: true }) }).strict();
export const transferRecord = z.object({
  key: z.string().min(1).max(256), source: z.record(z.string(), z.unknown()),
  item: importedItem.optional(),
  principal: z.object({ id: uuid, display_name: z.string().max(512) }).strict().optional(),
}).strict();
export const transferInput = z.object({
  id: uuid, generation: z.number().int().positive(),
  operation: z.enum(["begin", "batch", "verify", "activate", "status", "freeze", "export", "retire", "resume"]),
  count: z.number().int().min(0).max(100000).optional(),
  manifest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  records: z.array(transferRecord).max(100).optional(),
  after: z.string().max(256).optional(),
}).strict();
type Input = z.infer<typeof transferInput>;
export class ProjectTransferStore {
  constructor(private readonly pool: Pool) {}
  async execute(input: Input) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const storage = (await client.query("SELECT * FROM project_storage WHERE singleton FOR UPDATE")).rows[0];
      let transfer = (await client.query("SELECT * FROM project_transfers WHERE id=$1 FOR UPDATE", [input.id])).rows[0];
      if (input.operation === "begin") {
        if (input.count === undefined || !input.manifest) throw new ProjectError(422, "manifest_required", "A complete manifest is required.");
        if (transfer) {
          if (transfer.manifest !== input.manifest || transfer.expected_count !== input.count || transfer.generation !== input.generation)
            throw new ProjectError(409, "transfer_conflict", "This transfer is already bound to another manifest.");
        } else {
          const newest = (await client.query("SELECT max(generation) AS generation FROM project_transfers")).rows[0];
          if (newest.generation && input.generation < newest.generation)
            throw new ProjectError(409, "stale_generation", "An older authority cannot replace this project.");
          if (storage.state !== 'exported' && ((await client.query("SELECT id FROM project_items LIMIT 1")).rowCount || storage.migration_id))
            throw new ProjectError(409, "destination_not_empty", "Existing project content must be reconciled before import.");
          if (storage.state === 'exported') {
            await client.query("DELETE FROM project_requests");
            await client.query("DELETE FROM project_events");
            await client.query("DELETE FROM project_items");
            await client.query("DELETE FROM project_archive");
          }
          await client.query("INSERT INTO project_transfers(id,generation,manifest,expected_count,state) VALUES($1,$2,$3,$4,'receiving')", [input.id, input.generation, input.manifest, input.count]);
          await client.query("UPDATE project_storage SET state='importing',migration_id=$1 WHERE singleton", [input.id]);
          transfer = { id: input.id, generation: input.generation, state: "receiving", manifest: input.manifest, expected_count: input.count };
        }
      }
      if (input.operation === "freeze" && !transfer) {
        const newest = (await client.query("SELECT max(generation) AS generation FROM project_transfers")).rows[0];
        if (newest.generation && input.generation < newest.generation)
          throw new ProjectError(409, "stale_generation", "An older authority cannot freeze this project.");
        if (storage.state !== "active") throw new ProjectError(409, "not_active", "Resolve the existing transfer before export.");
        await client.query("INSERT INTO project_transfers(id,generation,manifest,expected_count,state) VALUES($1,$2,'',0,'frozen')", [input.id, input.generation]);
        await client.query("UPDATE project_storage SET state='frozen',migration_id=$1 WHERE singleton", [input.id]);
        storage.migration_id = input.id;
        // Materialize the latest items beside the original adapter records. The
        // adapter merges these on return; no raw history is discarded.
        await client.query(`INSERT INTO project_transfer_records(transfer_id,key,payload,digest)
          SELECT $1,'item:'||id::text,jsonb_build_object('key','item:'||id::text,'source',COALESCE((SELECT payload->'source' FROM project_archive WHERE key='item:'||project_items.id::text),'{}'::jsonb),'item',jsonb_build_object(
            'id',id,'kind',kind,'revision',revision,'data',data,'author_id',author_id,
            'created_at',to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
            'updated_at',to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))),'' FROM project_items`, [input.id]);
        await client.query(`INSERT INTO project_transfer_records(transfer_id,key,payload,digest)
          SELECT $1,key,payload,digest FROM project_archive ON CONFLICT DO NOTHING`, [input.id]);
        await client.query(`INSERT INTO project_transfer_records(transfer_id,key,payload,digest)
          SELECT $1,'principal:'||id::text,jsonb_build_object('key','principal:'||id::text,'source','{}'::jsonb,
            'principal',jsonb_build_object('id',id,'display_name',display_name)),'' FROM users
          WHERE id IN (SELECT author_id FROM project_items UNION SELECT actor_id FROM project_events
            UNION SELECT (data->>'assignee')::uuid FROM project_items WHERE data->>'assignee' IS NOT NULL
            UNION SELECT (data->>'reviewer')::uuid FROM project_items WHERE data->>'reviewer' IS NOT NULL)
          ON CONFLICT DO NOTHING`, [input.id]);
        await client.query(`INSERT INTO project_transfer_records(transfer_id,key,payload,digest)
          SELECT $1,'event:'||sequence::text,jsonb_build_object('key','event:'||sequence::text,
            'source',jsonb_build_object('event',to_jsonb(project_events))),'' FROM project_events`, [input.id]);
        const records = (await client.query("SELECT key,payload FROM project_transfer_records WHERE transfer_id=$1 ORDER BY key COLLATE \"C\"", [input.id])).rows;
        const manifest = [];
        for (const record of records) {
          const digest = checksum(record.payload);
          await client.query("UPDATE project_transfer_records SET digest=$3 WHERE transfer_id=$1 AND key=$2", [input.id, record.key, digest]);
          manifest.push([record.key, digest]);
        }
        await client.query("UPDATE project_transfers SET manifest=$2,expected_count=$3 WHERE id=$1", [input.id, checksum(manifest), records.length]);
        transfer = (await client.query("SELECT * FROM project_transfers WHERE id=$1", [input.id])).rows[0];
      }
      if (!transfer || transfer.generation !== input.generation) throw new ProjectError(409, "transfer_binding", "Transfer identity or generation does not match.");
      if (!['status','export'].includes(input.operation) && storage.migration_id && storage.migration_id !== input.id && input.operation !== 'begin')
        throw new ProjectError(409, "transfer_superseded", "A different transfer owns this project.");
      if (input.operation === "batch") {
        if (transfer.state !== "receiving") throw new ProjectError(409, "transfer_state", "This transfer is no longer accepting records.");
        for (const record of input.records ?? []) {
          const digest = checksum(record);
          const prior = (await client.query("SELECT digest FROM project_transfer_records WHERE transfer_id=$1 AND key=$2", [input.id, record.key])).rows[0];
          if (prior && prior.digest !== digest) throw new ProjectError(409, "record_conflict", "A retried record differs from its original content.");
          await client.query("INSERT INTO project_transfer_records(transfer_id,key,payload,digest) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [input.id, record.key, record, digest]);
        }
      }
      if (input.operation === "batch") {
        const count = (await client.query("SELECT count(*)::int AS count, coalesce(sum(octet_length(payload::text)),0)::bigint AS bytes FROM project_transfer_records WHERE transfer_id=$1", [input.id])).rows[0];
        if (Number(count.bytes) > 64 * 1024 * 1024) throw new ProjectError(413, "transfer_too_large", "This transfer exceeds the supported content limit.");
        if (count.count > transfer.expected_count) throw new ProjectError(409, "record_count_exceeded", "The batch exceeds the declared manifest.");
      }
      if (input.operation === "verify" && transfer.state === "receiving") {
        const records = (await client.query("SELECT key,payload,digest FROM project_transfer_records WHERE transfer_id=$1 ORDER BY key COLLATE \"C\"", [input.id])).rows;
        if (records.length !== transfer.expected_count || checksum(records.map(row => [row.key, row.digest])) !== transfer.manifest)
          throw new ProjectError(409, "manifest_mismatch", "Transferred records do not match the complete source manifest.");
        const items = records.filter(row => row.payload.item).map(row => row.payload.item);
        const principals = new Set(records.filter(row => row.payload.principal).map(row => row.payload.principal.id));
        const itemIds = new Set(items.map(row => row.id));
        const byId = new Map(items.map(row => [row.id, row]));
        if (itemIds.size !== items.length) throw new ProjectError(409, "duplicate_item", "Items must have unique identifiers.");
        for (const item of items) {
          let parent = item.data.parent_id;
          const seen = new Set([item.id]);
          while (parent) {
            if (seen.has(parent) || seen.size > 32) throw new ProjectError(409, "invalid_hierarchy", "The manifest contains a cyclic or excessively deep hierarchy.");
            seen.add(parent); parent = byId.get(parent)?.data.parent_id;
          }
          if (!principals.has(item.author_id) || item.data.parent_id && !itemIds.has(item.data.parent_id))
            throw new ProjectError(409, "missing_reference", "An item references an absent author or parent.");
          for (const id of [item.data.assignee, item.data.reviewer]) if (id && !principals.has(id))
            throw new ProjectError(409, "missing_reference", "An assigned member is absent from the manifest.");
        }
        await client.query("UPDATE project_transfers SET state='verified' WHERE id=$1", [input.id]);
      }
      if (input.operation === "activate" && transfer.state !== "active") {
        if (transfer.state !== "verified") throw new ProjectError(409, "verification_required", "Verify the complete transfer before activation.");
        const records = (await client.query("SELECT payload FROM project_transfer_records WHERE transfer_id=$1 ORDER BY key COLLATE \"C\"", [input.id])).rows;
        for (const { payload } of records) if (payload.principal) {
          const user = payload.principal;
          // Imported authors are historical identities, not new login grants.
          await client.query(`INSERT INTO users(id,email,normalized_email,display_name,handle,role,status)
            VALUES($1,$2,$2,$3,$4,'user','disabled') ON CONFLICT(id) DO NOTHING`,
          [user.id, `${user.id}@history.invalid`, user.display_name, `p-${user.id.replaceAll('-', '').slice(0, 28)}`]);
        }
        for (const { payload } of records) if (payload.item) {
          const item = payload.item;
          await client.query("INSERT INTO project_items(id,kind,revision,data,author_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [item.id, item.kind, item.revision, projectFields.parse(item.data), item.author_id, item.created_at, item.updated_at]);
        }
        await client.query("INSERT INTO project_archive(key,payload,digest) SELECT key,payload,digest FROM project_transfer_records WHERE transfer_id=$1", [input.id]);
        await client.query("UPDATE project_transfers SET state='active' WHERE id=$1", [input.id]);
        await client.query("UPDATE project_storage SET state='active',manifest_hash=$1,revision=revision+1 WHERE singleton", [transfer.manifest]);
      }
      if (input.operation === "retire") {
        if (!["frozen", "retired"].includes(transfer.state)) throw new ProjectError(409, "export_not_frozen", "Freeze and verify export before retirement.");
        if (input.manifest !== transfer.manifest) throw new ProjectError(409, "manifest_mismatch", "The receiver must confirm this export manifest.");
        await client.query("UPDATE project_storage SET state='exported' WHERE singleton");
        await client.query("UPDATE project_transfers SET state='retired' WHERE id=$1", [input.id]);
      }
      if (input.operation === "resume") {
        if (transfer.state !== "frozen") throw new ProjectError(409, "cannot_resume", "A committed export cannot be automatically resumed.");
        await client.query("UPDATE project_storage SET state='active',revision=revision+1 WHERE singleton");
        await client.query("UPDATE project_transfers SET state='aborted' WHERE id=$1", [input.id]);
      }
      const result = (await client.query("SELECT id,generation,state,manifest,expected_count FROM project_transfers WHERE id=$1", [input.id])).rows[0];
      if (input.operation === "export") {
        if (transfer.state !== "frozen") throw new ProjectError(409, "export_not_frozen", "Freeze the project before exporting.");
        const rows = (await client.query('SELECT key,payload,digest FROM project_transfer_records WHERE transfer_id=$1 AND key COLLATE "C">$2 ORDER BY key COLLATE "C" LIMIT 5', [input.id, input.after ?? ""])).rows;
        result.records = rows.map(row => row.payload);
        result.next = rows.length === 5 ? rows.at(-1)!.key : null;
      }
      await client.query("COMMIT"); return result;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
}
