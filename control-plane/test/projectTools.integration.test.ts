import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { Database } from '../src/database.js';
import { ProjectTools } from '../src/projectTools.js';
import type { ControlPlaneConfig } from '../src/config.js';
import type { UserRecord } from '../src/types.js';

const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)('shared task tool contract', () => {
  const schema = 'task_tools_' + randomUUID().replaceAll('-','');
  let root: Pool, pool: Pool, database: Database, tools: ProjectTools, actor: UserRecord;
  beforeAll(async () => {
    root = new Pool({ connectionString:url }); await root.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString:url, options:`-c search_path=${schema}` });
    database = new Database(pool); await database.migrate(); tools = new ProjectTools(database, {} as ControlPlaneConfig);
    actor = await database.createLocalUser({ email:'tools@example.test', displayName:'Tools', passwordHash:'fixture' });
    await pool.query("UPDATE users SET status='active',role='admin' WHERE id=$1",[actor.id]);
    actor.status='active'; actor.role='admin';
  });
  afterAll(async () => { await database?.close(); if (root) { await root.query(`DROP SCHEMA ${schema} CASCADE`); await root.end(); } });
  const invoke = (name:string,args:Record<string,unknown>) => tools.call(actor,name,args);
  it('keeps retries stable and rejects conflicting edits and cycles', async () => {
    const payload={kind:'task',data:{title:'Task A'},idempotency_key:randomUUID()};
    const first=await invoke('project_create',payload);
    expect(await invoke('project_create',payload)).toEqual(JSON.parse(JSON.stringify(first)));
    await expect(invoke('project_create',{...payload,data:{title:'Changed'}})).rejects.toMatchObject({code:'idempotency_conflict'});
    const second=await invoke('project_create',{...payload,idempotency_key:randomUUID(),data:{title:'Task B'}});
    const link=await invoke('project_link',{source_id:first.id,target_id:second.id,kind:'depends_on',expected_revision:0,idempotency_key:randomUUID()});
    await expect(invoke('project_link',{source_id:second.id,target_id:first.id,kind:'depends_on',expected_revision:0,idempotency_key:randomUUID()})).rejects.toMatchObject({code:'dependency_cycle'});
    const unlink={id:link.id,revision:link.revision,idempotency_key:randomUUID()};
    const tombstone=await invoke('project_unlink',unlink);
    expect(tombstone.deleted).toBe(true);
    expect(await invoke('project_unlink',unlink)).toEqual(JSON.parse(JSON.stringify(tombstone)));
    const updated=await invoke('project_update',{id:first.id,revision:first.revision,data:{title:'Edited'},idempotency_key:randomUUID()});
    expect(updated.revision).toBe(Number(first.revision)+1);
    await expect(invoke('project_update',{id:first.id,revision:first.revision,data:{title:'Stale'},idempotency_key:randomUUID()})).rejects.toMatchObject({code:'revision_conflict'});
    await expect(tools.call({...actor,status:'disabled'},'project_create',payload)).rejects.toMatchObject({code:'member_inactive'});
  });
  it('supports note/resource relations and retains deleted edges for upgraded sync peers',async () => {
    const create=(kind:string) => invoke('project_create',{kind,data:{title:kind},idempotency_key:randomUUID()});
    const note=await create('note'),resource=await create('resource');
    const edge=await invoke('project_link',{source_id:note.id,target_id:resource.id,kind:'related',expected_revision:0,idempotency_key:randomUUID()});
    await invoke('project_unlink',{id:edge.id,revision:edge.revision,idempotency_key:randomUUID()});
    expect((await tools.graph.list({...actor,projectSync:true},true,true)).some(row=>row.id===edge.id)).toBe(true);
    expect((await tools.graph.list({...actor,projectSync:true},true)).some(row=>row.id===edge.id)).toBe(false);
  });
  it('atomically checks catalog revisions and applies status changes',async () => {
    const before=await invoke('project_statuses',{});
    const after=await invoke('project_status_write',{operation:'create',revision:before.revision,name:'Testing',category:'doing',color:'blue',idempotency_key:randomUUID()});
    expect(after.revision).not.toBe(before.revision);
    await expect(invoke('project_status_write',{operation:'create',revision:before.revision,name:'Stale',category:'doing',idempotency_key:randomUUID()})).rejects.toMatchObject({code:'revision_conflict'});
  });
});
