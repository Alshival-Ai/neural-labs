import { randomUUID,createHmac } from 'node:crypto';
import { Pool } from 'pg';
import { beforeAll,afterAll,beforeEach,describe,it,expect,vi } from 'vitest';
import { Database } from '../src/database.js';
import { CredentialCipher } from '../src/crypto.js';
import { Connectors } from '../src/connectors.js';
import type { ControlPlaneConfig } from '../src/config.js';
import type { TwilioPluginService } from '../src/twilioPlugin.js';
import type { SessionActor } from '../src/types.js';
import type { SessionService } from '../src/sessions.js';
const url=process.env.TEST_DATABASE_URL;
(url?describe:describe.skip)('workspace connector persistence',()=>{
 const schema=`connectors_${randomUUID().replaceAll('-','')}`;let root:Pool,pool:Pool,db:Database,service:Connectors,member:string,other:string;const transport=vi.fn();const sms={accountSid:'AC'+'1'.repeat(32),authToken:'fixture-only',fromNumber:'+15555550100'};
 beforeAll(async()=>{root=new Pool({connectionString:url});await root.query(`CREATE SCHEMA ${schema}`);pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});db=new Database(pool);await db.migrate();
   service=new Connectors(db,{publicOrigin:new URL('https://fixture.example'),workspace:{controlUrl:new URL('http://runtime.fixture'),controlToken:'fixture-only'}} as ControlPlaneConfig,new CredentialCipher(Buffer.alloc(32,5)),{effectiveConfig:async()=>({config:sms})} as TwilioPluginService,{} as SessionService,transport);
   async function user(){const u=await db.createLocalUser({email:`${randomUUID()}@example.org`,displayName:'Fixture',passwordHash:'fixture'});await pool.query("UPDATE users SET status='active' WHERE id=$1",[u.id]);await pool.query('INSERT INTO connector_members(user_id,verified_email,email_enabled,sms_enabled) VALUES($1,$2,true,true)',[u.id,u.email]);return u.id;}member=await user();other=await user();
   await pool.query("INSERT INTO user_phones(user_id,phone_number,verified_at,notifications_enabled) VALUES($1,'+15555550101',now(),true)",[member]);
 });
 afterAll(async()=>{await db?.close();await root?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await root?.end();});
 beforeEach(async()=>{transport.mockReset();transport.mockImplementation(async()=>Response.json({sid:'SM'+'2'.repeat(32)}));await pool.query('DELETE FROM connector_sms_status');await pool.query('DELETE FROM connector_webhook_receipts');await pool.query('DELETE FROM connector_runtime_grants');await pool.query('DELETE FROM connector_deliveries');await pool.query('DELETE FROM connector_messages');await pool.query("UPDATE connector_settings SET sms_enabled=true,revision=1,connection_id=NULL,configured_by=NULL");await pool.query("UPDATE connector_members SET sms_opted_out=false,email_enabled=true,sms_enabled=true");await pool.query("UPDATE users SET status='active'");});
 it('deduplicates incoming provider messages and isolates member history',async()=>{await service.receive('sms',member,'sms-fixture','thread','hello');await service.receive('sms',member,'sms-fixture','thread','hello');expect((await service.history(member)).messages).toHaveLength(1);expect((await service.history(other)).messages).toHaveLength(0);});
 it('queues a send once and never repeats provider acceptance',async()=>{const data={channel:'sms' as const,member,subject:'',message:'hello',requestId:randomUUID()};await Promise.all([service.enqueue(member,data),service.enqueue(member,data)]);await service.deliver();await service.deliver();expect(transport).toHaveBeenCalledOnce();expect((await service.history(member)).messages[0].status).toBe('accepted');});
 it('holds queued delivery after membership revocation',async()=>{await service.enqueue(member,{channel:'sms',member,subject:'',message:'hello',requestId:randomUUID()});await pool.query("UPDATE users SET status='disabled' WHERE id=$1",[member]);await service.deliver();expect(transport).not.toHaveBeenCalled();expect((await pool.query('SELECT status FROM connector_deliveries')).rows[0].status).toBe('held');});
 it('records uncertain acceptance without resending',async()=>{await service.enqueue(member,{channel:'sms',member,subject:'',message:'hello',requestId:randomUUID()});transport.mockRejectedValue(new Error('connection lost'));await service.deliver();await service.deliver();expect(transport).toHaveBeenCalledOnce();expect((await service.history(member)).messages[0].status).toBe('unknown');});
 it('honors signed STOP before the inbox allowlist and does not invoke an agent',async()=>{const fields={AccountSid:sms.accountSid,To:sms.fromNumber,From:'+15555550101',Body:'STOP',MessageSid:'SM'+'3'.repeat(32)};const url=await service.smsUrl();const signature=createHmac('sha1',sms.authToken).update(url+Object.keys(fields).sort().map(k=>k+fields[k as keyof typeof fields]).join('')).digest('base64');await service.twilioWebhook(fields,signature,false);expect((await service.preferences(member)).smsOptedOut).toBe(true);expect((await service.history(member)).messages).toHaveLength(0);await expect(service.enqueue(member,{channel:'sms',member,subject:'',message:'hello',requestId:randomUUID()})).rejects.toThrow('not enabled');});
 it('rejects unsigned callbacks and wrong recipients',async()=>{await expect(service.twilioWebhook({AccountSid:sms.accountSid},'forged',false)).rejects.toThrow('signature');});
 it('retains incoming messages when no workspace account is configured',async()=>{await service.receive('sms',member,'waiting','thread','hello');await service.dispatch();expect((await service.history(member)).messages[0].status).toBe('held');expect(transport).not.toHaveBeenCalled();});
 async function webhook(fields:Record<string,string>,status=false){const signature=createHmac('sha1',sms.authToken).update(await service.smsUrl(status)+Object.keys(fields).sort().map(k=>k+fields[k]).join('')).digest('base64');await service.twilioWebhook(fields,signature,status);}
 it('keeps early delivery callbacks and ignores late status regressions',async()=>{
   const fields={AccountSid:sms.accountSid,From:sms.fromNumber,To:'+15555550101',MessageSid:'SM'+'2'.repeat(32),MessageStatus:'delivered'};
   await webhook(fields,true);
   await service.enqueue(member,{channel:'sms',member,subject:'',message:'hello',requestId:randomUUID()});await service.deliver();
   expect((await service.history(member)).messages[0].status).toBe('delivered');
   await webhook({...fields,MessageStatus:'sent'},true);await webhook({...fields,MessageStatus:'failed'},true);
   expect((await service.history(member)).messages[0].status).toBe('delivered');
 });
 it('does not replay an old STOP after a newer START',async()=>{
   const stop={AccountSid:sms.accountSid,To:sms.fromNumber,From:'+15555550101',Body:'STOP',MessageSid:'SM'+'4'.repeat(32)};
   await webhook(stop);await webhook({...stop,Body:'START',MessageSid:'SM'+'5'.repeat(32)});await webhook(stop);
   expect((await service.preferences(member)).smsOptedOut).toBe(false);
 });
 it('holds a proactive send when its initiating member loses access',async()=>{
   await service.enqueue(other,{channel:'sms',member,subject:'',message:'hello',requestId:randomUUID()});
   await pool.query("UPDATE users SET status='disabled' WHERE id=$1",[other]);await service.deliver();expect(transport).not.toHaveBeenCalled();
   expect((await service.history(member)).messages[0].status).toBe('held');
 });
 it('rejects oversized SMS without silently dropping content',async()=>{
   await expect(service.enqueue(member,{channel:'sms',member,subject:'',message:'a'.repeat(1601),requestId:randomUUID()})).rejects.toThrow('1600');expect(transport).not.toHaveBeenCalled();
 });

 it('consumes OAuth state once and rechecks the initiating administrator',async()=>{
   await service.saveApp('gmail',{clientId:'fixture-client',clientSecret:'fixture-secret'});
   const actor={user:{id:member,role:'admin'},session:{tokenHash:'fixture-session'}} as SessionActor;
   const start=await service.startOAuth('gmail',actor,false);const state=new URL(start.url).searchParams.get('state')!;
   service.sessions.actorByTokenHash=vi.fn(async()=>undefined);
   await expect(service.finishOAuth('gmail',state,'fixture-code')).rejects.toThrow('Administrator');
   await expect(service.finishOAuth('gmail',state,'fixture-code')).rejects.toThrow('expired');
   expect(transport).not.toHaveBeenCalled();
 });

});
