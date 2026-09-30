import express from 'express';
import request from 'supertest';
import {describe,it,expect,vi} from 'vitest';
import {registerConnectorRoutes} from '../src/connectorRoutes.js';
import type {Connectors} from '../src/connectors.js';
import type {SessionActor} from '../src/types.js';
function fixture(role='user',csrf=true){
 const service={history:vi.fn(async()=>({messages:[]})),saveSelection:vi.fn(),twilioWebhook:vi.fn(async()=>{}),memberAuthority:vi.fn(),status:vi.fn(async()=>({})),preferences:vi.fn(async()=>({}))};
 const app=express();app.use(express.json());app.use(express.urlencoded({extended:false}));
 const actor={user:{id:'00000000-0000-4000-8000-000000000001',role}} as SessionActor;
 registerConnectorRoutes(app,service as unknown as Connectors,{token:'fixture-secret',sameOrigin:(r,s,n)=>{if(r.get('origin')!=='https://fixture.example')s.sendStatus(403);else n();},active:async()=>actor,admin:async(r,s)=>{if(role!=='admin'){s.sendStatus(403);return;}return actor;},csrf:(r,s)=>{if(!csrf)s.sendStatus(403);return csrf;}});return {app,service,actor};
}
describe('connector route authority',()=>{
 it('binds private history to the session, ignoring another member query',async()=>{const f=fixture();expect((await request(f.app).get('/api/connectors/messages?user=other')).status).toBe(200);expect(f.service.history).toHaveBeenCalledWith(f.actor.user.id);});
 it('rejects member administration and missing CSRF without mutation',async()=>{for(const [role,csrf] of [['user',true],['admin',false]] as const){const f=fixture(role,csrf);expect((await request(f.app).put('/api/admin/connectors/model').set('origin','https://fixture.example').send({})).status).toBe(403);expect(f.service.saveSelection).not.toHaveBeenCalled();}});
 it('rejects cross-origin mutation and unauthenticated broker access',async()=>{const f=fixture('admin');expect((await request(f.app).put('/api/admin/connectors/model').send({})).status).toBe(403);expect((await request(f.app).post('/internal/connectors/tool').send({action:'history'})).status).toBe(401);expect(f.service.memberAuthority).not.toHaveBeenCalled();});
 it('passes public webhook form and signature to the verifier without a browser session',async()=>{const f=fixture();const r=await request(f.app).post('/webhooks/twilio/sms').set('x-twilio-signature','fixture').type('form').send({Body:'hello'});expect(r.status).toBe(200);expect(f.service.twilioWebhook).toHaveBeenCalledWith({Body:'hello'},'fixture',false);});
});
