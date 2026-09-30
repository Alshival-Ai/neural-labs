import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {beforeAll,afterAll,beforeEach,describe,it,expect,vi} from 'vitest';
import {Database} from '../src/database.js';
import {migrations} from '../src/migrations.js';
import {Connectors} from '../src/connectors.js';
import {Notifications,notificationSchema} from '../src/notifications.js';
import {CredentialCipher} from '../src/crypto.js';
import type {ControlPlaneConfig} from '../src/config.js';
import type {TwilioPluginService} from '../src/twilioPlugin.js';
import type {SessionService} from '../src/sessions.js';
import type {AuthConfigurationService} from '../src/authConfig.js';
const url=process.env.TEST_DATABASE_URL;
(url?describe:describe.skip)('notification connector handoff',()=>{
 const schema=`handoff_${randomUUID().replaceAll('-','')}`;let root:Pool,pool:Pool,db:Database,connectors:Connectors,notifications:Notifications,user:string;
 const send=vi.fn();let external=true;
 beforeAll(async()=>{
  root=new Pool({connectionString:url});await root.query(`CREATE SCHEMA ${schema}`);pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});db=new Database(pool);await db.migrate();
  const config={publicOrigin:new URL('https://fixture.example'),workspace:{controlUrl:new URL('http://fixture'),controlToken:'fixture'}} as ControlPlaneConfig;
  const twilio={effectiveConfig:async()=>({config:{accountSid:'AC'+'1'.repeat(32),authToken:'fixture',fromNumber:'+15555550100'}})} as TwilioPluginService;
  connectors=new Connectors(db,config,new CredentialCipher(Buffer.alloc(32,6)),twilio,{} as SessionService,send);
  notifications=new Notifications(pool,{} as AuthConfigurationService,twilio,config,async(input,init)=>{
   const body=JSON.parse(String(init?.body));return Response.json(String(input).endsWith('/job')?{job:{id:body.jobId}}:String(input).endsWith('/run')?{job:{id:body.jobId},run:{id:body.runId,outcome:'failure',external}}:{runs:[]});
  });notifications.connectors=connectors;connectors.notificationAllowed=(...args)=>notifications.canDeliver(...args);
  const u=await db.createLocalUser({email:'fixture@example.org',displayName:'Fixture',passwordHash:'fixture'});user=u.id;
  await pool.query("UPDATE users SET status='active' WHERE id=$1",[user]);await pool.query("INSERT INTO connector_members(user_id,sms_enabled) VALUES($1,true)",[user]);
  await pool.query("INSERT INTO user_phones(user_id,phone_number,verified_at,notifications_enabled) VALUES($1,'+15555550101',now(),true)",[user]);
  await pool.query("UPDATE connector_settings SET sms_enabled=true");
 });
 afterAll(async()=>{await db?.close();await root?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await root?.end();});
 beforeEach(async()=>{send.mockReset();send.mockImplementation(async()=>Response.json({sid:'SM'+randomUUID().replaceAll('-','')}));external=true;
  await pool.query('DELETE FROM connector_deliveries');await pool.query('DELETE FROM connector_messages');await pool.query('DELETE FROM notification_deliveries');await pool.query('DELETE FROM notification_events');
  await notifications.saveSettings(user,{neura:true,email:false,defaults:['neura','sms']});await notifications.subscribe(user,'job',{events:['failure'],channels:['neura','sms']});
 });
 async function enqueue(){return notifications.enqueue(notificationSchema.parse({automationId:'job',runId:'run',outcome:'failure',message:'Fixture failed'}),true);}
 it('PostgreSQL 24 to 25 preserves existing tables and user data',async()=>{
  const isolated=`migration_${randomUUID().replaceAll('-','')}`;await root.query(`CREATE SCHEMA ${isolated}`);
  const candidate=new Pool({connectionString:url,options:`-c search_path=${isolated}`});
  try {
   for(const migration of migrations.filter(m=>m.version<=24))await candidate.query(migration.sql);
   const before=(await candidate.query("SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename",[isolated])).rows;
   const retained = await new Database(candidate).createLocalUser({email:'preserved@example.org',displayName:'Preserved',passwordHash:'fixture'});
   const event=randomUUID();
   await candidate.query("INSERT INTO notification_events(id,event_key,outcome,title,message) VALUES($1,'retained','success','Fixture','Fixture')",[event]);
   await candidate.query("INSERT INTO notification_deliveries(event_id,user_id,channel,status) VALUES($1,$2,'email','sending')",[event,retained.id]);
   await candidate.query(migrations.find(m=>m.version===25)!.sql);
   expect((await candidate.query("SELECT status FROM notification_deliveries")).rows).toEqual([{status:'unknown'}]);
   expect((await candidate.query("SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename",[isolated])).rows).toEqual(before);
   expect((await candidate.query("SELECT email FROM users")).rows).toEqual([{email:'preserved@example.org'}]);
  } finally {await candidate.end();await root.query(`DROP SCHEMA ${isolated} CASCADE`);}
 });
 it('keeps in-app receipts while suppressing external failures below threshold',async()=>{external=false;await enqueue();await notifications.tick();await connectors.deliver();expect(send).not.toHaveBeenCalled();expect((await notifications.inbox(user)).entries).toHaveLength(1);});
 it('recovers handoff crash and projects connector acceptance without sending twice',async()=>{
  await enqueue();await notifications.tick();expect((await pool.query('SELECT count(*)::int n FROM connector_messages')).rows[0].n).toBe(1);
  await pool.query("UPDATE notification_deliveries SET status='sending',updated_at=now()-interval '10 minutes' WHERE channel='sms'");
  await notifications.tick();await connectors.deliver();await notifications.tick();await connectors.deliver();expect(send).toHaveBeenCalledOnce();
  expect((await pool.query("SELECT status FROM notification_deliveries WHERE channel='sms'")).rows[0].status).toBe('accepted');
 });
 it('rechecks unsubscribe after handoff and before provider send',async()=>{await enqueue();await notifications.tick();await notifications.subscribe(user,'job',{events:[],channels:[]});await connectors.deliver();await notifications.tick();expect(send).not.toHaveBeenCalled();expect((await pool.query("SELECT status FROM notification_deliveries WHERE channel='sms'")).rows[0].status).toBe('held');});
 it('never retries uncertain provider acceptance',async()=>{await enqueue();await notifications.tick();send.mockRejectedValue(Error('lost response'));await connectors.deliver();await notifications.tick();await connectors.deliver();await notifications.tick();expect(send).toHaveBeenCalledOnce();expect((await pool.query("SELECT status FROM notification_deliveries WHERE channel='sms'")).rows[0].status).toBe('unknown');});
});
