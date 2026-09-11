import type { Express, Request, Response, RequestHandler } from "express";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { SessionActor } from "./types.js";
import { Notifications, NotificationError, notificationSchema, preferenceSchema, subscriptionSchema } from "./notifications.js";

export function registerNotificationRoutes(app: Express, service: Notifications, options: {
  sameOrigin: RequestHandler; active: (req: Request,res: Response)=>Promise<SessionActor|undefined>;
  admin: (req: Request,res: Response)=>Promise<SessionActor|undefined>;
  csrf: (req: Request,res: Response,actor:SessionActor)=>boolean; token: string;
}) {
  const wrap=(callback:(req:Request,res:Response)=>Promise<void>):RequestHandler=>async(req,res)=>{
    res.set("Cache-Control","no-store");
    try {await callback(req,res);} catch(error) {
      res.status(error instanceof NotificationError?error.status:503).json({error:{code:error instanceof NotificationError?error.code:"notifications_unavailable",message:error instanceof NotificationError?error.message:"Notifications are temporarily unavailable"}});
    }
  };
  app.get("/api/account/notifications",wrap(async(req,res)=>{const actor=await options.active(req,res);if(actor)res.json(await service.settings(actor.user.id));}));
  app.put("/api/account/notifications",options.sameOrigin,wrap(async(req,res)=>{const actor=await options.active(req,res);if(!actor||!options.csrf(req,res,actor))return;const parsed=preferenceSchema.safeParse(req.body);if(!parsed.success){res.status(422).json({error:{message:"Choose notification channels"}});return;}res.json(await service.saveSettings(actor.user.id,parsed.data));}));
  app.get("/api/account/notifications/inbox",wrap(async(req,res)=>{const actor=await options.active(req,res);if(actor)res.json(await service.inbox(actor.user.id));}));
  app.put("/api/account/notifications/session",options.sameOrigin,wrap(async(req,res)=>{const actor=await options.active(req,res);if(!actor||!options.csrf(req,res,actor))return;const parsed=z.object({sessionKey:z.string().min(1).max(500)}).safeParse(req.body);if(!parsed.success){res.sendStatus(422);return;}res.json(await service.setInboxSession(actor.user.id,parsed.data.sessionKey));}));
  app.post("/api/account/notifications/read",options.sameOrigin,wrap(async(req,res)=>{const actor=await options.active(req,res);if(!actor||!options.csrf(req,res,actor))return;await service.markRead(actor.user.id);res.json({ok:true});}));
  app.get("/api/automations/:jobId/subscription",wrap(async(req,res)=>{const actor=await options.active(req,res);if(actor)res.json(await service.subscription(actor.user.id,String(req.params.jobId)));}));
  app.put("/api/automations/:jobId/subscription",options.sameOrigin,wrap(async(req,res)=>{const actor=await options.active(req,res);if(!actor||!options.csrf(req,res,actor))return;const parsed=subscriptionSchema.safeParse(req.body);if(!parsed.success){res.status(422).json({error:{message:"Choose events and delivery channels"}});return;}res.json(await service.subscribe(actor.user.id,String(req.params.jobId),parsed.data));}));
  app.get("/api/admin/notifications/email",wrap(async(req,res)=>{if(await options.admin(req,res))res.json(await service.emailConfig());}));
  app.put("/api/admin/notifications/email",options.sameOrigin,wrap(async(req,res)=>{const actor=await options.admin(req,res);if(!actor||!options.csrf(req,res,actor))return;const parsed=z.object({senderId:z.string().uuid(),senderAddress:z.string().email(),enabled:z.boolean()}).safeParse(req.body);if(!parsed.success){res.status(422).json({error:{message:"Provide the sender mailbox ID and email address"}});return;}res.json(await service.saveEmailConfig(parsed.data));}));
  app.post("/internal/notifications/:action",wrap(async(req,res)=>{
    const supplied=Buffer.from(req.get("authorization")?.replace(/^Bearer\s+/i,"")??"");const expected=Buffer.from(options.token);
    if(!expected.length||supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){res.status(401).json({error:{message:"Unauthorized"}});return;}
    if(req.params.action==="context") {const parsed=z.object({automationId:z.string().min(1).max(200)}).safeParse(req.body);if(!parsed.success){res.status(422).json({error:{message:"Automation ID required"}});return;}res.json(await service.context(parsed.data.automationId));return;}
    if(req.params.action!=="send"){res.sendStatus(404);return;}
    const parsed=notificationSchema.safeParse(req.body);if(!parsed.success){res.status(422).json({error:{message:"Provide one recipient or automation run and a notification"}});return;}
    res.json(await service.enqueue(parsed.data));
  }));
}
