import { timingSafeEqual } from "node:crypto";
import type { Express, Request, Response, RequestHandler } from "express";
import { z } from "zod";
import { Connectors, ConnectorError, connectorSelection, connectorSend } from "./connectors.js";
import type { SessionActor } from "./types.js";
import { twilioSettingsSchema } from "./twilioPlugin.js";
import { MailError } from "./mailProviders.js";

export function registerConnectorRoutes(app:Express,service:Connectors,options:{sameOrigin:RequestHandler;active:(r:Request,s:Response)=>Promise<SessionActor|undefined>;admin:(r:Request,s:Response)=>Promise<SessionActor|undefined>;csrf:(r:Request,s:Response,a:SessionActor)=>boolean;token:string}) {
  const wrap=(fn:(r:Request,s:Response)=>Promise<void>):RequestHandler=>async(r,s)=>{try{await fn(r,s);}catch(e){s.status(e instanceof ConnectorError?e.status:e instanceof z.ZodError?422:503).json({error:{message:e instanceof ConnectorError?e.message:e instanceof MailError?e.code:e instanceof z.ZodError?"Check the connector fields.":"Connector temporarily unavailable."}});}};
  const admin=async(r:Request,s:Response)=>{const a=await options.admin(r,s);return a&&(r.method==="GET"||options.csrf(r,s,a))?a:undefined;};
  const active=async(r:Request,s:Response)=>{const a=await options.active(r,s);return a&&(r.method==="GET"||options.csrf(r,s,a))?a:undefined;};
  const trusted=(r:Request,s:Response)=>{const value=Buffer.from(r.get("authorization")?.replace(/^Bearer\s+/i,"")||""),expected=Buffer.from(options.token);if(!expected.length||value.length!==expected.length||!timingSafeEqual(value,expected)){s.sendStatus(401);return false;}return true;};
  app.get("/api/connectors",wrap(async(r,s)=>{const a=await active(r,s);if(a)s.json(await service.status(a.user.role==="admin"));}));
  app.get("/api/connectors/preferences",wrap(async(r,s)=>{const a=await active(r,s);if(a)s.json(await service.preferences(a.user.id));}));
  app.put("/api/connectors/preferences",options.sameOrigin,wrap(async(r,s)=>{const a=await active(r,s);if(!a)return;await service.savePreferences(a.user.id,z.object({email:z.boolean(),sms:z.boolean()}).strict().parse(r.body));s.json(await service.preferences(a.user.id));}));
  app.post("/api/connectors/email/verify/start",options.sameOrigin,wrap(async(r,s)=>{const a=await active(r,s);if(a){await service.verifyEmailStart(a.user.id);s.json({ok:true});}}));
  app.post("/api/connectors/email/verify/finish",options.sameOrigin,wrap(async(r,s)=>{const a=await active(r,s);if(a){await service.verifyEmail(a.user.id,z.object({code:z.string().regex(/^\d{6}$/)}).parse(r.body).code);s.json(await service.preferences(a.user.id));}}));
  app.get("/api/connectors/messages",wrap(async(r,s)=>{const a=await active(r,s);if(a)s.json(await service.history(a.user.id));}));
  app.post("/api/connectors/messages/:id/resume",options.sameOrigin,wrap(async(r,s)=>{const a=await active(r,s);if(!a)return;const id=z.string().uuid().parse(r.params.id);const current=await service.settings();
    const changed=await service.db.pool.query("UPDATE connector_messages SET status='pending',error=NULL,connector_revision=$3,updated_at=now() WHERE id=$1 AND user_id=$2 AND direction='in' AND status='held' AND native_turn IS NULL RETURNING id",[id,a.user.id,current.revision]);if(!changed.rowCount)throw new ConnectorError(409,"Only messages that were not started can resume.");s.json({ok:true});}));
  app.put("/api/admin/connectors/model",options.sameOrigin,wrap(async(r,s)=>{const a=await admin(r,s);if(!a)return;await service.saveSelection(a.user.id,connectorSelection.parse(r.body));s.json(await service.status(true));}));
  app.put("/api/admin/connectors/oauth/:provider",options.sameOrigin,wrap(async(r,s)=>{if(!await admin(r,s))return;const p=z.enum(["gmail","outlook"]).parse(r.params.provider);await service.saveApp(p,z.object({clientId:z.string().trim().min(1).max(500),clientSecret:z.string().min(1).max(2000)}).strict().parse(r.body));s.json(await service.status(true));}));
  app.post("/api/admin/connectors/oauth/:provider/start",options.sameOrigin,wrap(async(r,s)=>{const a=await admin(r,s);if(!a)return;s.json(await service.startOAuth(z.enum(["gmail","outlook"]).parse(r.params.provider),a,z.object({replace:z.boolean().default(false)}).parse(r.body).replace));}));
  app.get("/api/connectors/oauth/:provider/callback",wrap(async(r,s)=>{
    const provider=z.enum(["gmail","outlook"]).parse(r.params.provider);const state=z.string().min(20).max(200).parse(r.query.state);
    await service.finishOAuth(provider,state,z.string().max(4000).parse(r.query.code||""));
    s.type("html").send('<!doctype html><html><meta name="viewport" content="width=device-width"><title>Mailbox connected</title><body><h1>Mailbox connected</h1><p>You can close this tab and return to Settings → Connectors.</p></body></html>');
  }));
  app.put("/api/admin/connectors/:channel/enabled",options.sameOrigin,wrap(async(r,s)=>{if(!await admin(r,s))return;await service.pause(z.enum(["email","sms"]).parse(r.params.channel),z.object({enabled:z.boolean()}).parse(r.body).enabled);s.json(await service.status(true));}));
  app.delete("/api/admin/connectors/mailbox",options.sameOrigin,wrap(async(r,s)=>{if(!await admin(r,s))return;await service.disconnectMailbox();s.json(await service.status(true));}));
  app.put("/api/admin/connectors/twilio",options.sameOrigin,wrap(async(r,s)=>{if(!await admin(r,s))return;await service.twilio.save(twilioSettingsSchema.parse(r.body),await service.smsUrl());await service.pause("sms",false);s.json(await service.status(true));}));
  app.delete("/api/admin/connectors/twilio",options.sameOrigin,wrap(async(r,s)=>{if(!await admin(r,s))return;await service.pause("sms",false);await service.twilio.disconnect();s.json(await service.status(true));}));
  app.post("/api/admin/connectors/twilio/numbers",options.sameOrigin,wrap(async(r,s)=>{if(!await admin(r,s))return;s.json(await service.twilioNumbers(z.object({accountSid:z.string().regex(/^AC[a-f0-9]{32}$/i),authToken:z.string().min(8).max(256)}).strict().parse(r.body)));}));
  app.post("/api/admin/connectors/twilio/configure",options.sameOrigin,wrap(async(r,s)=>{if(!await admin(r,s))return;await service.configureTwilio();s.json(await service.status(true));}));
  app.post("/api/admin/connectors/test",options.sameOrigin,wrap(async(r,s)=>{const a=await admin(r,s);if(!a)return;const input=z.object({channel:z.enum(["email","sms"]),member:z.string().min(1).max(100),requestId:z.string().uuid()}).parse(r.body);s.json(await service.enqueue(a.user.id,{...input,subject:"Neural Labs connector test",message:"Your Neural Labs agent connection is ready. Reply to start a conversation."}));}));
  app.post("/internal/connectors/authorize",wrap(async(r,s)=>{if(trusted(r,s))s.json(await service.authorizeRun(z.object({grant:z.string().uuid()}).passthrough().parse(r.body).grant));}));
  app.post("/internal/connectors/tool",wrap(async(r,s)=>{if(!trusted(r,s))return;const input=z.object({actor:z.string().uuid(),action:z.enum(["status","history","send"]),input:z.unknown().optional()}).strict().parse(r.body);
    await service.memberAuthority(input.actor);
    if(input.action==="status")s.json({connectors:await service.status(),preferences:await service.preferences(input.actor)});
    else if(input.action==="history")s.json(await service.history(input.actor));
    else s.json(await service.enqueue(input.actor,connectorSend.parse(input.input)));
  }));
  for(const status of [false,true])app.post(`/webhooks/twilio/sms${status?"/status":""}`,wrap(async(r,s)=>{await service.twilioWebhook(r.body,r.get("x-twilio-signature")||"",status);s.type("text/xml").send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');}));
}
