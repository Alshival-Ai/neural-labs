import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { z } from "zod";
import type { AuthConfigurationService } from "./authConfig.js";
import { MicrosoftOidcClient } from "./entra.js";
import type { TwilioPluginService } from "./twilioPlugin.js";
import type { ControlPlaneConfig } from "./config.js";

export const channelSchema = z.enum(["neura", "sms", "email"]);
export const preferenceSchema = z.object({ neura: z.boolean(), email: z.boolean(), defaults: z.array(channelSchema).min(1).max(3) });
export const subscriptionSchema = z.object({ events: z.array(z.enum(["success", "failure"])).max(2), channels: z.array(channelSchema).max(3) });
export const notificationSchema = z.object({
  userId: z.string().uuid().optional(), handle: z.string().regex(/^@?[a-z0-9][a-z0-9._-]{1,31}$/).optional(),
  automationId: z.string().min(1).max(200).optional(), runId: z.string().min(1).max(200).optional(),
  outcome: z.enum(["success", "failure"]).default("success"),
  title: z.string().trim().min(1).max(200).default("Neura update"),
  message: z.string().trim().min(1).max(1600),
  idempotencyKey: z.string().min(1).max(200).optional(),
  links: z.array(z.object({ label: z.string().max(120), url: z.string().url().startsWith("https://").max(2048) })).max(5).default([]),
  mediaUrls: z.array(z.string().url().startsWith("https://")).max(10).default([]),
}).refine(v => Number(Boolean(v.userId)) + Number(Boolean(v.handle)) + Number(Boolean(v.automationId)) === 1, "Provide one recipient or automation")
  .refine(v => !v.automationId || Boolean(v.runId), "Automation notifications require a run ID");
export type NotificationInput = z.infer<typeof notificationSchema>;
export class NotificationError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }

export function effectiveChannels(channels: string[], preferences: { neura: boolean; email: boolean; sms: boolean }, emailAvailable: boolean) {
  return [...new Set(channels)].filter(channel => channel === "neura" ? preferences.neura : channel === "email" ? preferences.email && emailAvailable : channel === "sms" && preferences.sms);
}

export class Notifications {
  private busy = false;
  constructor(private pool: Pool, private auth: AuthConfigurationService, private twilio: TwilioPluginService, private config: ControlPlaneConfig, private fetchFn: typeof fetch = fetch) {}

  async workspace(action: string, input: unknown = {}) {
    const url = new URL(`/internal/notifications/${action}`, this.config.workspace.controlUrl);
    const response = await this.fetchFn(url, { method: "POST", headers: { Authorization: `Bearer ${this.config.workspace.controlToken}`, "Content-Type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new NotificationError(503, "scheduler_unavailable", "Automation information is temporarily unavailable");
    return response.json();
  }

  async settings(userId: string) {
    const row = (await this.pool.query(`SELECT COALESCE(p.neura,true) neura, COALESCE(p.email,false) email,
      COALESCE(p.defaults,CASE WHEN ph.notifications_enabled AND ph.verified_at IS NOT NULL THEN ARRAY['sms'] ELSE ARRAY['neura'] END) defaults, p.session_key, u.email account_email,
      COALESCE(ph.notifications_enabled AND ph.verified_at IS NOT NULL,false) sms
      FROM users u LEFT JOIN notification_preferences p ON p.user_id=u.id LEFT JOIN user_phones ph ON ph.user_id=u.id WHERE u.id=$1 AND u.status='active'`, [userId])).rows[0];
    if (!row) throw new NotificationError(404, "recipient_unavailable", "Workspace member is unavailable");
    const sender = (await this.pool.query("SELECT email_enabled,sender_id,sender_address FROM notification_config WHERE singleton=true")).rows[0];
    return { ...row, emailAvailable: Boolean(sender?.email_enabled && sender.sender_id && this.auth.effectiveEntra(await this.auth.getStored())) };
  }

  async saveSettings(userId: string, input: z.infer<typeof preferenceSchema>) {
    await this.pool.query(`INSERT INTO notification_preferences(user_id,neura,email,defaults) VALUES($1,$2,$3,$4)
      ON CONFLICT(user_id) DO UPDATE SET neura=excluded.neura,email=excluded.email,defaults=excluded.defaults`, [userId,input.neura,input.email,[...new Set(input.defaults)]]);
    return this.settings(userId);
  }

  async subscription(userId: string, jobId: string) {
    const job = await this.workspace("job", { jobId });
    if (!job.job) throw new NotificationError(404,"automation_missing","Automation no longer exists");
    const row = (await this.pool.query("SELECT events,channels FROM automation_subscriptions WHERE user_id=$1 AND job_id=$2", [userId,jobId])).rows[0];
    return { job: job.job, subscription: row ?? null, preferences: await this.settings(userId) };
  }

  async subscribe(userId: string, jobId: string, input: z.infer<typeof subscriptionSchema>) {
    await this.subscription(userId,jobId);
    if (!input.events.length || !input.channels.length) await this.pool.query("DELETE FROM automation_subscriptions WHERE user_id=$1 AND job_id=$2", [userId,jobId]);
    else await this.pool.query(`INSERT INTO automation_subscriptions(user_id,job_id,events,channels) VALUES($1,$2,$3,$4)
      ON CONFLICT(user_id,job_id) DO UPDATE SET events=excluded.events,channels=excluded.channels`, [userId,jobId,[...new Set(input.events)],[...new Set(input.channels)]]);
    return this.subscription(userId,jobId);
  }

  async context(jobId: string) {
    const { job } = await this.workspace("job", {jobId});
    if (!job) throw new NotificationError(404,"automation_missing","Automation no longer exists");
    jobId = job.id;
    const rows = (await this.pool.query("SELECT s.user_id,u.handle,s.events,s.channels FROM automation_subscriptions s JOIN users u ON u.id=s.user_id WHERE s.job_id=$1 AND u.status='active'",[jobId])).rows;
    const subscribers=[];
    for(const row of rows) { const p=await this.settings(row.user_id); subscribers.push({userId:row.user_id,handle:row.handle,events:row.events,channels:effectiveChannels(row.channels,p,p.emailAvailable)}); }
    return {job,subscribers,policy:"The server rechecks subscriptions and consent at delivery. Do not choose addresses or channels."};
  }

  async enqueue(input: NotificationInput, reconciled = false) {
    let key: string, jobName: string | undefined;
    if(input.automationId) {
      const verified=await this.workspace("run",{jobId:input.automationId,runId:input.runId});
      if(!verified.run) throw new NotificationError(409,"run_unavailable","A completed automation run is required");
      // The authenticated workspace bridge resolves personal execution jobs to
      // their parent subscription identity. Never accept that mapping from input.
      if (verified.job?.id) input = { ...input, automationId: verified.job.id };
      if(!verified.run.running && verified.run.outcome==="failure" && input.outcome!=="failure") throw new NotificationError(409,"outcome_mismatch","The notification outcome does not match the completed run");
      if (!reconciled) {
        await this.pool.query("INSERT INTO notification_run_summaries(job_id,run_id,content) VALUES($1,$2,$3) ON CONFLICT(job_id,run_id) DO UPDATE SET content=excluded.content",[input.automationId,verified.run.id,JSON.stringify(input)]);
        return {status:"staged",runId:verified.run.id};
      }
      jobName=verified.job?.name;
      key=`automation:${input.automationId}:${verified.run.id}`;
    } else key=`direct:${input.userId ?? input.handle}:${input.idempotencyKey ?? randomUUID()}`;
    const client=await this.pool.connect();
    try {
      await client.query("BEGIN");
      const event=await client.query(`INSERT INTO notification_events(id,event_key,job_id,run_id,outcome,title,message,links)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(event_key) DO NOTHING RETURNING id`,
        [randomUUID(),key,input.automationId ?? null,input.runId ?? null,input.outcome,jobName ?? input.title,input.message,JSON.stringify([...input.links,...input.mediaUrls.map(url=>({label:"Attachment",url}))])]);
      if(!event.rows[0]) {await client.query("COMMIT"); return {status:"already-recorded"};}
      const id=event.rows[0].id;
      const recipients=input.automationId
        ? (await client.query(`SELECT s.user_id,s.channels FROM automation_subscriptions s JOIN users u ON u.id=s.user_id
            WHERE s.job_id=$1 AND $2=ANY(s.events) AND u.status='active'`,[input.automationId,input.outcome])).rows
        : (await client.query(`SELECT u.id user_id,COALESCE(p.defaults,CASE WHEN ph.notifications_enabled AND ph.verified_at IS NOT NULL THEN ARRAY['sms'] ELSE ARRAY['neura'] END) channels
            FROM users u LEFT JOIN notification_preferences p ON p.user_id=u.id LEFT JOIN user_phones ph ON ph.user_id=u.id
            WHERE u.status='active' AND (u.id::text=$1 OR u.handle=$2)`,[input.userId ?? "",input.handle?.replace(/^@/,"") ?? ""])).rows;
      if(!recipients.length && !input.automationId) throw new NotificationError(404,"recipient_unavailable","Workspace member is unavailable");
      for(const recipient of recipients) for(const channel of [...new Set(recipient.channels as string[])])
        await client.query("INSERT INTO notification_deliveries(event_id,user_id,channel) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[id,recipient.user_id,channel]);
      await client.query("COMMIT");
      return {status:"queued",notificationId:id,recipients:recipients.length,reconciled};
    } catch(error) {await client.query("ROLLBACK");throw error;} finally {client.release();}
  }

  async inbox(userId: string) {
    const entries=(await this.pool.query(`SELECT e.id,e.job_id,e.run_id,e.outcome,e.title,e.message,e.links,e.created_at,
      e.created_at>COALESCE(p.read_at,'epoch') unread FROM notification_deliveries d JOIN notification_events e ON e.id=d.event_id
      LEFT JOIN notification_preferences p ON p.user_id=d.user_id
      WHERE d.user_id=$1 AND d.channel='neura' AND d.status='delivered' ORDER BY e.created_at DESC LIMIT 100`,[userId])).rows;
    return {entries};
  }
  async setInboxSession(userId: string, sessionKey: string) {
    const checked=await this.workspace("session",{userId,sessionKey});
    if(!checked.owned) throw new NotificationError(403,"invalid_session","Select your own private Neura conversation");
    const preferences=await this.settings(userId);
    await this.pool.query("INSERT INTO notification_preferences(user_id,session_key,defaults) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET session_key=excluded.session_key",[userId,sessionKey,preferences.defaults]);
    return {sessionKey};
  }
  async markRead(userId: string) { const preferences=await this.settings(userId); await this.pool.query("INSERT INTO notification_preferences(user_id,read_at,defaults) VALUES($1,now(),$2) ON CONFLICT(user_id) DO UPDATE SET read_at=now()",[userId,preferences.defaults]); }

  async emailConfig() {return (await this.pool.query("SELECT sender_id,sender_address,email_enabled FROM notification_config WHERE singleton=true")).rows[0];}
  async saveEmailConfig(input: {senderId:string;senderAddress:string;enabled:boolean}) {
    await this.pool.query("UPDATE notification_config SET sender_id=$1,sender_address=$2,email_enabled=$3 WHERE singleton=true",[input.senderId,input.senderAddress,input.enabled]);
    return this.emailConfig();
  }

  private async sendEmail(address: string,title:string,message:string) {
    const sender=await this.emailConfig();
    const entra=this.auth.effectiveEntra(await this.auth.getStored());
    if(!sender.email_enabled || !entra) throw new NotificationError(503,"email_unavailable","Email is unavailable");
    const token=await new MicrosoftOidcClient(this.fetchFn).applicationToken(entra,"https://graph.microsoft.com/.default");
    const response=await this.fetchFn(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender.sender_id)}/sendMail`,{
      method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},
      body:JSON.stringify({message:{subject:title,body:{contentType:"Text",content:message},toRecipients:[{emailAddress:{address}}]},saveToSentItems:true}),signal:AbortSignal.timeout(20_000)});
    if(response.status===429) throw new NotificationError(429,"throttled","Email was throttled");
    if(response.status>=500) throw new NotificationError(502,"send_unknown","Email acceptance is unknown");
    if(response.status!==202) throw new NotificationError(422,"email_rejected","Email was rejected by Microsoft 365");
  }

  async tick() {
    if(this.busy) return; this.busy=true;
    try {
      // Any prior process that died after claiming a send may have delivered it.
      await this.pool.query("UPDATE notification_deliveries SET status='unknown',error_code='interrupted_send' WHERE status='sending' AND updated_at<now()-interval '5 minutes'");
      await this.reconcile().catch(()=>undefined);
      const pending=(await this.pool.query(`SELECT d.*,e.job_id,e.run_id,e.outcome,e.title,e.message,e.links FROM notification_deliveries d
        JOIN notification_events e ON e.id=d.event_id WHERE d.status='pending' AND d.next_attempt_at<=now() ORDER BY d.next_attempt_at LIMIT 30`)).rows;
      for(const row of pending) {
        if(this.config.updates?.workerToken && (await this.pool.query("SELECT gate FROM update_runtime WHERE singleton")).rows[0]?.gate !== false) return;
        const claimed=await this.pool.query("WITH admission AS (SELECT gate FROM update_runtime WHERE singleton FOR SHARE) UPDATE notification_deliveries SET status='sending',attempts=attempts+1,updated_at=now() WHERE event_id=$1 AND user_id=$2 AND channel=$3 AND status='pending' AND NOT EXISTS (SELECT 1 FROM admission WHERE gate) RETURNING attempts",[row.event_id,row.user_id,row.channel]);
        if(!claimed.rows.length) continue;
        let status="delivered",code:string|null=null;
        try {
          const p=await this.settings(row.user_id);
          let channels=p.defaults;
          if(row.job_id) {
            const s=(await this.pool.query("SELECT channels,events FROM automation_subscriptions WHERE user_id=$1 AND job_id=$2",[row.user_id,row.job_id])).rows[0];
            channels=s?.events.includes(row.outcome)?s.channels:[];
            const {job}=await this.workspace("job",{jobId:row.job_id});
            if(!job) channels=[];
          }
          if(!effectiveChannels(channels,p,p.emailAvailable).includes(row.channel)) status="suppressed";
          else {
            const count=(await this.pool.query("SELECT count(*)::int n FROM notification_deliveries WHERE user_id=$1 AND channel=$2 AND status IN ('delivered','accepted') AND updated_at>now()-interval '1 hour'",[row.user_id,row.channel])).rows[0].n;
            if(count>=20) throw new NotificationError(429,"rate_limited","Notification rate limit reached");
            const message=`${row.message}${row.links.length ? '\n\n'+row.links.map((link:{label:string;url:string})=>`${link.label}: ${link.url}`).join('\n') : ''}`;
            if(row.channel==='email') {await this.sendEmail(p.account_email,row.title,message);status="accepted";}
            if(row.channel==='sms') {await this.twilio.sendNotification({userId:row.user_id,message:message.slice(0,1600),mediaUrls:row.links.filter((link:{label:string})=>link.label==="Attachment").map((link:{url:string})=>link.url).slice(0,10)});status="accepted";}
          }
        } catch(error) {
          code=error instanceof NotificationError ? error.code : "delivery_unknown";
          status=error instanceof NotificationError && error.status===429 && claimed.rows[0].attempts<4 ? "pending" : error instanceof NotificationError && [404,422].includes(error.status) ? "failed" : "unknown";
        }
        await this.pool.query("UPDATE notification_deliveries SET status=$4,error_code=$5,updated_at=now(),next_attempt_at=now()+interval '5 minutes' WHERE event_id=$1 AND user_id=$2 AND channel=$3",[row.event_id,row.user_id,row.channel,status,code]);
      }
    } finally {this.busy=false;}
  }

  async reconcile() {
    const config=(await this.pool.query("SELECT reconcile_after FROM notification_config WHERE singleton=true")).rows[0];
    const snapshot=await this.workspace("runs",{after:Number(config.reconcile_after)});
    for(const run of [...(snapshot.runs ?? [])].sort((a,b)=>a.finishedAt-b.finishedAt)) {
      // Allow the agent-authored result time to arrive before a minimal fallback.
      if(Date.now()-run.finishedAt<60_000) continue;
      if ((await this.pool.query("SELECT id FROM notification_events WHERE event_key=$1",[`automation:${run.jobId}:${run.id}`])).rows.length) continue;
      const staged=(await this.pool.query("SELECT content FROM notification_run_summaries WHERE job_id=$1 AND run_id=$2",[run.jobId,run.id])).rows[0]?.content;
      await this.enqueue(notificationSchema.parse((staged && (run.outcome==="success" || staged.outcome==="failure")) ? {...staged,runId:run.id} : {automationId:run.jobId,runId:run.id,outcome:run.outcome,title:run.name,
        message:run.outcome==='success'?`${run.name} completed. Open Automations for the run details.`:`${run.name} did not complete successfully. Open Automations to review the run.`}),true);
    }
  }
}
