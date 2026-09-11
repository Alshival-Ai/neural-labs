import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import {Database} from '../src/database.js';
import {Notifications,notificationSchema} from '../src/notifications.js';
import type {AuthConfigurationService} from '../src/authConfig.js';
import type {TwilioPluginService} from '../src/twilioPlugin.js';
import type {ControlPlaneConfig} from '../src/config.js';
const url=process.env.TEST_DATABASE_URL;
(url?describe:describe.skip)('notification persistence and delivery',()=>{
 const schema=`notifications_${randomUUID().replaceAll('-','')}`;let admin:Pool,pool:Pool,db:Database,service:Notifications;const sms=vi.fn();let outcome='success';
 beforeAll(async()=>{admin=new Pool({connectionString:url});await admin.query(`CREATE SCHEMA ${schema}`);pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});db=new Database(pool);await db.migrate();service=new Notifications(pool,{getStored:async()=>({}),effectiveEntra:()=>undefined} as unknown as AuthConfigurationService,{sendNotification:sms} as unknown as TwilioPluginService,{workspace:{controlUrl:new URL('http://workspace.test'),controlToken:'test-only'}} as unknown as ControlPlaneConfig,async(input,init)=>{const action=new URL(String(input)).pathname.split('/').at(-1);const body=JSON.parse(String(init?.body));return Response.json(action==='job'?{job:{id:body.jobId,name:'Example'}}:action==='run'?{job:{name:'Example'},run:{id:body.runId,outcome}}:{runs:[]});});});
 afterAll(async()=>{await db?.close();await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin?.end();});
 async function user(){const u=await db.createLocalUser({email:`${randomUUID()}@example.org`,displayName:'Notification test',passwordHash:'test-only'});await pool.query("UPDATE users SET status='active' WHERE id=$1",[u.id]);return u.id;}
 it('stores one event under concurrent repeated callbacks and delivers only the recipient inbox',async()=>{const a=await user(),b=await user();const data=notificationSchema.parse({userId:a,message:'Verified result',idempotencyKey:randomUUID()});await Promise.all([service.enqueue(data),service.enqueue(data)]);await service.tick();expect((await service.inbox(a)).entries).toHaveLength(1);expect((await service.inbox(b)).entries).toHaveLength(0);await service.markRead(a);expect((await service.inbox(a)).entries[0].unread).toBe(false);});
 it('suppresses queued delivery after unsubscribe and channel opt-out',async()=>{const a=await user();await service.subscribe(a,'job',{events:['success'],channels:['neura']});await service.enqueue(notificationSchema.parse({automationId:'job',runId:'unsubscribe',message:'Result'}),true);await service.subscribe(a,'job',{events:[],channels:[]});await service.tick();expect((await service.inbox(a)).entries).toHaveLength(0);await service.enqueue(notificationSchema.parse({userId:a,message:'Direct',idempotencyKey:randomUUID()}));await service.saveSettings(a,{neura:false,email:false,defaults:['neura']});await service.tick();expect((await service.inbox(a)).entries).toHaveLength(0);});
 it('stages agent results without sending and rejects outcome spoofing',async()=>{const a=await user();await service.subscribe(a,'staged',{events:['success'],channels:['neura']});const data=notificationSchema.parse({automationId:'staged',runId:'one',message:'Ready'});expect((await service.enqueue(data)).status).toBe('staged');await service.tick();expect((await service.inbox(a)).entries).toHaveLength(0);outcome='failure';await expect(service.enqueue(data)).rejects.toThrow('does not match');outcome='success';});
 it('never sends SMS without the verified-phone permission',async()=>{const a=await user();await service.saveSettings(a,{neura:true,email:false,defaults:['sms']});await service.enqueue(notificationSchema.parse({userId:a,message:'Test'}));await service.tick();expect(sms).not.toHaveBeenCalled();});
 it('preserves existing verified SMS opt-in until the user chooses new defaults',async()=>{
  sms.mockClear();const a=await user();
  await pool.query("INSERT INTO user_phones(user_id,phone_number,verified_at,notifications_enabled) VALUES($1,'+12025550123',now(),true)",[a]);
  expect((await service.settings(a)).defaults).toEqual(['sms']);
  await service.markRead(a);
  expect((await service.settings(a)).defaults).toEqual(['sms']);
  await service.enqueue(notificationSchema.parse({userId:a,message:'Existing opt-in',mediaUrls:['https://example.org/photo.jpg']}));await service.tick();
  expect(sms).toHaveBeenCalledOnce();expect(sms.mock.calls[0]![0].mediaUrls).toEqual(['https://example.org/photo.jpg']);
  await service.saveSettings(a,{neura:true,email:false,defaults:['neura']});
  await service.enqueue(notificationSchema.parse({userId:a,message:'New preference'}));await service.tick();
  expect(sms).toHaveBeenCalledOnce();expect((await service.inbox(a)).entries).toHaveLength(1);
 });
 it('sends email from the configured stable mailbox ID and does not repeat an accepted send',async()=>{
  const a=await user();const senderId=randomUUID();
  const auth={getStored:async()=>({}),effectiveEntra:()=>({source:'onboarding',tenantId:'tenant',clientId:'app',authorityHost:'https://login.microsoftonline.com',credential:{type:'secret',clientSecret:'test-only'}})} as unknown as AuthConfigurationService;
  const send=vi.fn();const transport=async(input:string|URL|Request,init?:RequestInit)=>{
   const target=String(input);
   if(target.includes('/internal/'))return Response.json({runs:[]});
   if(target.includes('.well-known'))return Response.json({issuer:'https://login.microsoftonline.com/tenant/v2.0',authorization_endpoint:'https://login.microsoftonline.com/auth',token_endpoint:'https://login.microsoftonline.com/token',jwks_uri:'https://login.microsoftonline.com/keys'});
   if(target.endsWith('/token'))return Response.json({access_token:'test-token'});
   expect(target).toBe(`https://graph.microsoft.com/v1.0/users/${senderId}/sendMail`);
   send(JSON.parse(String(init?.body)));return new Response(null,{status:202});
  };
  const mailer=new Notifications(pool,auth,{sendNotification:sms} as unknown as TwilioPluginService,{workspace:{controlUrl:new URL('http://workspace.test'),controlToken:'test-only'}} as unknown as ControlPlaneConfig,transport);
  await mailer.saveEmailConfig({senderId,senderAddress:'notices@example.org',enabled:true});
  await mailer.saveSettings(a,{neura:true,email:true,defaults:['neura','email']});
  await mailer.enqueue(notificationSchema.parse({userId:a,message:'Verified link',idempotencyKey:randomUUID()}));await mailer.tick();await mailer.tick();
  expect(send).toHaveBeenCalledOnce();expect(send.mock.calls[0]![0].saveToSentItems).toBe(true);
  expect((await pool.query('SELECT channel,status FROM notification_deliveries WHERE user_id=$1 ORDER BY channel',[a])).rows).toEqual([{channel:'email',status:'accepted'},{channel:'neura',status:'delivered'}]);
 });
 it('does not retry a process-interrupted send',async()=>{const a=await user();await service.enqueue(notificationSchema.parse({userId:a,message:'Test'}));await pool.query("UPDATE notification_deliveries SET status='sending',updated_at=now()-interval '10 minutes' WHERE user_id=$1",[a]);await service.tick();expect((await pool.query('SELECT status FROM notification_deliveries WHERE user_id=$1',[a])).rows[0].status).toBe('unknown');});
});
