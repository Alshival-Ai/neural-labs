import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import type { Database } from "./database.js";
import type { ControlPlaneConfig } from "./config.js";
import { CredentialCipher } from "./crypto.js";
import { portalExchange } from "./managed.js";
import { MailProviders, MailError, oauthStart, type MailProvider, type MailToken, type OAuthApp } from "./mailProviders.js";
import type { TwilioPluginService } from "./twilioPlugin.js";
import type { SessionActor } from "./types.js";
import type { SessionService } from "./sessions.js";

// OAuth state is a uniformly random 256-bit token, not a password.
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export class ConnectorError extends Error { constructor(public status: number, message: string) { super(message); } }
export const connectorSelection = z.object({connection:z.string().uuid(),generation:z.number().int().positive(),model:z.string().trim().min(1).max(160)}).strict();
export const connectorSend = z.object({channel:z.enum(["email","sms"]),member:z.string().min(1).max(100),subject:z.string().max(300).default("Message from Alshival"),message:z.string().trim().min(1).max(16000),requestId:z.string().uuid()}).strict();
export function validTwilioSignature(token: string, url: string, fields: Record<string,unknown>, signature: string): boolean {
  if(Object.values(fields).some(v=>typeof v!=="string"))return false;
  const payload=url+Object.keys(fields).sort().map(k=>k+fields[k]).join("");
  const expected=Buffer.from(createHmac("sha1",token).update(payload).digest("base64"));const supplied=Buffer.from(signature);
  return expected.length===supplied.length&&timingSafeEqual(expected,supplied);
}
export class Connectors {
  readonly mail: MailProviders;
  private busy=false;
  notificationAllowed?: (event: string, user: string, channel: string) => Promise<boolean>;
  constructor(readonly db: Database, readonly config: ControlPlaneConfig, readonly cipher: CredentialCipher,
    readonly twilio: TwilioPluginService, readonly sessions: SessionService, readonly fetchFn: typeof fetch=fetch,
    readonly maintenance: ()=>Promise<boolean>=async()=>false, readonly activity:(delta:number)=>void=()=>{}) {this.mail=new MailProviders(fetchFn);}
  async settings() {return (await this.db.pool.query("SELECT * FROM connector_settings WHERE singleton")).rows[0];}
  async origin() {const c=await this.db.getInstanceConfig();return this.config.publicOrigin?.origin || c.publicOrigin;}
  async callback(provider: MailProvider) {return new URL(`/api/connectors/oauth/${provider}/callback`,await this.origin()).href;}
  async smsUrl(status=false) {return new URL(`/webhooks/twilio/sms${status?"/status":""}`,this.config.smsWebhookOrigin?.origin || await this.origin()).href;}
  async status(admin=false) {
    const row=await this.settings();const apps=(await this.db.pool.query("SELECT provider FROM connector_oauth_apps")).rows.map(r=>r.provider);
    const twilio=await this.twilio.status(await this.smsUrl(),admin);
    return {mailbox:{provider:row.mailbox_provider,address:row.mailbox_address,connected:!!row.mailbox_secret,paused:row.mailbox_paused,lastSync:row.last_sync_at,error:row.error},
      sms:{...twilio,enabled:row.sms_enabled,statusCallbackUrl:await this.smsUrl(true)},selection:row.connection_id?{connection:row.connection_id,generation:row.connection_generation,model:row.model}:null,
      providers:await Promise.all((["gmail","outlook"] as const).map(async provider=>({provider,available:apps.includes(provider),callbackUrl:await this.callback(provider)})))};
  }
  async saveApp(provider: MailProvider, app: OAuthApp) {
    await this.db.pool.query("INSERT INTO connector_oauth_apps VALUES($1,$2) ON CONFLICT(provider) DO UPDATE SET encrypted_config=excluded.encrypted_config",[provider,this.cipher.encrypt(app)]);
    await this.db.pool.query("DELETE FROM connector_oauth_states WHERE provider=$1",[provider]);
  }
  async app(provider:MailProvider):Promise<OAuthApp> {const row=(await this.db.pool.query("SELECT encrypted_config FROM connector_oauth_apps WHERE provider=$1",[provider])).rows[0];if(!row)throw new ConnectorError(409,"Set up the provider OAuth application first.");return this.cipher.decrypt<OAuthApp>(row.encrypted_config);}
  async startOAuth(provider:MailProvider,actor:SessionActor,replace:boolean) {
    const row=await this.settings();if(row.mailbox_secret&&!replace)throw new ConnectorError(409,"Confirm replacement of the workspace mailbox.");
    const state=randomBytes(32).toString("base64url"),redirect=await this.callback(provider);const result=oauthStart(provider,await this.app(provider),redirect,state);
    await this.db.pool.query("DELETE FROM connector_oauth_states WHERE actor_id=$1 OR expires_at<now()",[actor.user.id]);
    await this.db.pool.query("INSERT INTO connector_oauth_states VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '10 minutes')",[hash(state),provider,actor.user.id,actor.session.tokenHash,row.revision,this.cipher.encrypt({verifier:result.verifier}),redirect]);
    return {url:result.url};
  }
  async finishOAuth(provider:MailProvider,state:string,code:string) {
    const saved=(await this.db.pool.query("DELETE FROM connector_oauth_states WHERE state_hash=$1 AND provider=$2 AND expires_at>now() RETURNING *",[hash(state),provider])).rows[0];
    if(!saved)throw new ConnectorError(400,"This connection request expired. Start again in Settings → Plugins.");
    if(await this.maintenance())throw new ConnectorError(503,"Workspace maintenance is in progress. Connect again afterwards.");
    const actor=await this.sessions.actorByTokenHash(saved.session_hash);
    if(!actor||actor.user.id!==saved.actor_id||actor.user.role!=="admin")throw new ConnectorError(403,"Administrator access is no longer available.");
    const {verifier}=this.cipher.decrypt<{verifier:string}>(saved.verifier);
    if(!code)throw new ConnectorError(400,"Mailbox connection was cancelled. Start again in Settings → Plugins.");
    const token=await this.mail.token(provider,await this.app(provider),{grant_type:"authorization_code",code,redirect_uri:saved.redirect_uri,code_verifier:verifier});
    const address=await this.mail.profile(provider,token);const initial=await this.mail.poll(provider,token,null);
    const updated=await this.db.pool.query(`UPDATE connector_settings SET mailbox_provider=$1,mailbox_address=$2,mailbox_secret=$3,mailbox_cursor=$4,
      mailbox_started_at=now(),mailbox_paused=false,last_sync_at=now(),next_sync_at=now()+interval '1 minute',error=NULL,revision=revision+1 WHERE singleton AND revision=$5 RETURNING revision`,[provider,address,this.cipher.encrypt(token),initial.cursor,saved.revision]);
    if(!updated.rowCount)throw new ConnectorError(409,"Connector settings changed. Connect again.");
    await this.db.audit(actor.user.id,"connector.mailbox.connected",null,{provider,address});
  }
  async saveSelection(actor:string,input:z.infer<typeof connectorSelection>) {
    const found=await this.db.pool.query("SELECT id FROM native_connections WHERE id=$1 AND generation=$2 AND enabled AND scope IN ('team','background','shared')",[input.connection,input.generation]);
    if(!found.rowCount)throw new ConnectorError(422,"Select an enabled workspace AI connection.");
    await this.db.pool.query("UPDATE connector_settings SET connection_id=$1,connection_generation=$2,model=$3,configured_by=$4,revision=revision+1 WHERE singleton",[input.connection,input.generation,input.model,actor]);
  }
  async pause(channel:"email"|"sms",enabled:boolean) {
    if(channel==="sms"&&enabled){const check=await this.twilio.status(await this.smsUrl(),true,true);if(!check.webhookVerified)throw new ConnectorError(422,"Configure and verify the incoming Twilio webhook before enabling SMS.");}
    await this.db.pool.query(channel==="email"?"UPDATE connector_settings SET mailbox_paused=$1,revision=revision+1 WHERE singleton":"UPDATE connector_settings SET sms_enabled=$1,revision=revision+1 WHERE singleton",[channel==="email"?!enabled:enabled]);}
  async disconnectMailbox() {await this.db.pool.query("UPDATE connector_settings SET mailbox_provider=NULL,mailbox_address=NULL,mailbox_secret=NULL,mailbox_cursor=NULL,mailbox_paused=true,error=NULL,revision=revision+1 WHERE singleton");}
  async token(row:any):Promise<MailToken> {
    if(!row.mailbox_secret)throw new ConnectorError(409,"Connect a mailbox first.");
    let token=this.cipher.decrypt<MailToken>(row.mailbox_secret);
    if(token.expiresAt<Date.now()+60000) {
      token=await this.mail.token(row.mailbox_provider,await this.app(row.mailbox_provider),{grant_type:"refresh_token",refresh_token:token.refreshToken},token);
      const updated=await this.db.pool.query("UPDATE connector_settings SET mailbox_secret=$1 WHERE singleton AND revision=$2 AND mailbox_secret=$3",[this.cipher.encrypt(token),row.revision,row.mailbox_secret]);
      if(!updated.rowCount)throw new ConnectorError(409,"Mailbox configuration changed.");
    }
    return token;
  }
  async member(id:string) {
    const row=(await this.db.pool.query(`SELECT u.id,u.role,u.status,u.email,u.handle,m.*,p.phone_number,p.verified_at,p.notifications_enabled
      FROM users u LEFT JOIN connector_members m ON m.user_id=u.id LEFT JOIN user_phones p ON p.user_id=u.id WHERE u.id=$1`,[id])).rows[0];
    if(!row||row.status!=="active")throw new ConnectorError(403,"Workspace member is unavailable.");
    return row;
  }
  async preferences(id:string) {const m=await this.member(id);return {emailEnabled:!!m.email_enabled,emailVerified:m.verified_email===m.email.toLowerCase(),smsEnabled:!!m.sms_enabled,smsVerified:!!m.verified_at,smsOptedOut:!!m.sms_opted_out};}
  async savePreferences(id:string,input:{email:boolean;sms:boolean}) {
    const m=await this.member(id);
    if(input.email&&m.verified_email!==m.email.toLowerCase())throw new ConnectorError(422,"Verify your email address first.");
    if(input.sms&&(!m.verified_at||!m.notifications_enabled||m.sms_opted_out))throw new ConnectorError(422,"Verify your phone and enable Agent SMS updates. Reply START to the number if you opted out.");
    await this.db.pool.query("INSERT INTO connector_members(user_id,email_enabled,sms_enabled) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET email_enabled=$2,sms_enabled=$3",[id,input.email,input.sms]);
  }
  private emailCodeHash(id: string, email: string, code: string): string {
    // Low-entropy codes need a server-held key against offline DB guessing.
    return createHmac("sha256", this.config.masterKey)
      .update(JSON.stringify(["connector-email-v1", id, email.toLowerCase(), code])).digest("hex");
  }
  async verifyEmailStart(id:string) {
    if(!await this.db.consumeRateLimit(`connector-email:${id}`,3,3600))throw new ConnectorError(429,"Please wait before requesting another verification email.");
    const m=await this.member(id),row=await this.settings();if(row.mailbox_paused)throw new ConnectorError(409,"The workspace mailbox is paused.");
    const code=String(100000+Math.floor(Number.parseInt(randomBytes(4).toString("hex"),16)/0x100000000*900000));
    await this.db.pool.query(`INSERT INTO connector_members(user_id,verification_hash,verification_expires) VALUES($1,$2,now()+interval '10 minutes')
      ON CONFLICT(user_id) DO UPDATE SET verification_hash=$2,verification_expires=now()+interval '10 minutes'`,[id,this.emailCodeHash(id,m.email,code)]);
    await this.mail.send(row.mailbox_provider,await this.token(row),{to:m.email,subject:"Verify your Neural Labs agent email",text:`Your verification code is ${code}. It expires in 10 minutes.`,messageId:randomUUID()});
  }
  async verifyEmail(id:string,code:string) {
    if(!await this.db.consumeRateLimit(`connector-email-code:${id}`,8,600))throw new ConnectorError(429,"Too many attempts. Request a new code later.");
    const m=await this.member(id);const changed=await this.db.pool.query(`UPDATE connector_members SET verified_email=$2,verification_hash=NULL,verification_expires=NULL
      WHERE user_id=$1 AND verification_hash=$3 AND verification_expires>now() RETURNING user_id`,[id,m.email.toLowerCase(),this.emailCodeHash(id,m.email,code)]);
    if(!changed.rowCount)throw new ConnectorError(422,"The code is incorrect or expired.");
  }
  async history(id:string) {await this.member(id);return {messages:(await this.db.pool.query("SELECT id,channel,direction,thread_key,subject,body,status,error,created_at FROM connector_messages WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",[id])).rows.reverse()};}
  async memberAuthority(id:string) {
    const member=await this.member(id);let authorityGeneration=0;
    if(this.config.managed){const identity=(await this.db.pool.query("SELECT subject FROM managed_identities WHERE user_id=$1 AND issuer=$2 AND workspace=$3",[id,this.config.managed.portalOrigin,this.config.managed.workspace])).rows[0];
      if(!identity)throw new ConnectorError(403,"Member identity unavailable.");
      const grant=await portalExchange(this.config,"background-authorize",{subject:identity.subject}) as any;
      if(grant?.authorized!==true||grant.workspace!==this.config.managed.workspace||grant.instance!==this.config.managed.instance||!Number.isInteger(grant.generation))throw new ConnectorError(403,"Workspace execution is unavailable.");authorityGeneration=grant.generation;}
    return {member,authorityGeneration};
  }
  async eligible(id:string,channel:"email"|"sms",proactive=true) {
    const m=await this.member(id);
    if(channel==="email" ? !m.email_enabled||m.verified_email!==m.email.toLowerCase() : !m.sms_enabled||!m.verified_at||m.sms_opted_out||(proactive&&!m.notifications_enabled))throw new ConnectorError(403,"This member has not enabled this messaging channel.");
    return channel==="email"?m.email:m.phone_number;
  }
  async receive(channel:"email"|"sms",id:string,key:string,thread:string,body:string,subject="",reference="") {
    const row=await this.settings();
    if(channel==="email"?row.mailbox_paused:!row.sms_enabled)return;
    await this.eligible(id,channel,false);
    if(!await this.db.consumeRateLimit(`connector-in:${id}:${channel}`,60,3600))throw new ConnectorError(429,"Incoming message limit reached.");
    await this.db.pool.query(`INSERT INTO connector_messages(id,user_id,channel,direction,connector_revision,provider_key,thread_key,subject,body,reply_reference,status)
      VALUES($1,$2,$3,'in',$4,$5,$6,$7,$8,$9,'pending') ON CONFLICT(provider_key) DO NOTHING`,[randomUUID(),id,channel,row.revision,key,thread,subject,body.slice(0,32000),reference]);
  }
  async enqueue(actor:string,input:z.infer<typeof connectorSend>,reply?:any, notificationEvent?:string) {
    await this.memberAuthority(actor);const row=await this.settings();
    if(input.channel==="email"?row.mailbox_paused||!row.mailbox_secret:!row.sms_enabled)throw new ConnectorError(409,"The connector is not enabled.");
    const m=(await this.db.pool.query("SELECT id FROM users WHERE status='active' AND (id::text=$1 OR lower(handle)=$2)",[input.member,input.member.replace(/^@/,"").toLowerCase()])).rows[0];
    if(!m)throw new ConnectorError(404,"Workspace member not found.");
    if(reply&&reply.user_id!==m.id)throw new ConnectorError(403,"Reply recipient mismatch.");
    if(input.channel==="sms"&&input.message.length>1600)throw new ConnectorError(422,"SMS messages must be 1600 characters or fewer.");
    const recipient=await this.eligible(m.id,input.channel);const id=randomUUID();const requestKey=notificationEvent ? `notification:${notificationEvent}:${m.id}:${input.channel}` : `${actor}:${input.requestId}`;
    if((await this.db.pool.query("SELECT id FROM connector_messages WHERE request_key=$1",[requestKey])).rowCount)return {status:"queued",requestId:input.requestId};
    if(!await this.db.consumeRateLimit(`connector-out:${actor}:${input.channel}`,60,3600))throw new ConnectorError(429,"Outgoing message limit reached. Try later.");
    const client=await this.db.pool.connect();
    try{await client.query("BEGIN");const inserted=await client.query(`INSERT INTO connector_messages(id,user_id,channel,direction,connector_revision,thread_key,subject,body,reply_reference,status,request_key,initiator_id,notification_event)
      VALUES($1,$2,$3,'out',$4,$5,$6,$7,$8,'pending',$9,$10,$11) ON CONFLICT(request_key) DO NOTHING RETURNING id`,[id,m.id,input.channel,row.revision,reply?.thread_key || `${input.channel}:${m.id}:${id}`,input.subject,input.message,reply?.reply_reference || null,requestKey,actor,notificationEvent || null]);
      if(inserted.rowCount)await client.query("INSERT INTO connector_deliveries(id,message_id,recipient) VALUES($1,$2,$3)",[randomUUID(),id,recipient]);await client.query("COMMIT");
    }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
    return {status:"queued",requestId:input.requestId};
  }
  async authorizeRun(id:string) {
    const grant=(await this.db.pool.query("SELECT * FROM connector_runtime_grants WHERE id=$1 AND expires_at>now()",[id])).rows[0];
    if(!grant)throw new ConnectorError(403,"Message execution expired.");
    const message=(await this.db.pool.query("SELECT * FROM connector_messages WHERE id=$1 AND status IN ('dispatching','running')",[grant.message_id])).rows[0];const row=await this.settings();
    if(!message||row.revision!==grant.revision||(message.channel==="email"?row.mailbox_paused:!row.sms_enabled)||await this.maintenance())throw new ConnectorError(403,"Message execution was revoked.");
    await this.eligible(message.user_id,message.channel,false);
    const {member,authorityGeneration}=await this.memberAuthority(grant.actor_id);
    if(!row.configured_by)throw new ConnectorError(409,"Choose a workspace model.");
    const admin=await this.member(row.configured_by);if(admin.role!=="admin")throw new ConnectorError(403,"Connector administrator is unavailable.");
    const connection=(await this.db.pool.query("SELECT * FROM native_connections WHERE id=$1 AND generation=$2 AND enabled AND scope IN ('team','background','shared')",[row.connection_id,row.connection_generation])).rows[0];
    if(!connection||!row.model)throw new ConnectorError(409,"Workspace AI connection is unavailable.");
    return {actor:member.id,actorRole:member.role,connection:connection.id,binding:{owner:connection.id,provider:connection.provider,generation:connection.generation,method:connection.method},scope:connection.scope,model:row.model,background:true,authorityGeneration,
      policy:{sandbox:"workspace-write",approval:"never"},purpose:"connector-run",connector:{grant:id,message:message.id,channel:message.channel,thread:message.thread_key}};
  }
  async native(action:string,input:unknown) {
    const response=await this.fetchFn(new URL(`/internal/connectors/${action}`,this.config.workspace.controlUrl),{method:"POST",redirect:"error",signal:AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${this.config.workspace.controlToken}`,"Content-Type":"application/json"},body:JSON.stringify(input)});
    if(!response.ok)throw new ConnectorError(503,"The workspace runtime is unavailable.");return response.json() as Promise<any>;
  }
  async syncMailbox(row:any) {
    if(row.mailbox_paused||!row.mailbox_secret||new Date(row.next_sync_at).getTime()>Date.now())return;
    await this.db.pool.query("UPDATE connector_settings SET next_sync_at=now()+interval '1 minute' WHERE singleton");
    try{const result=await this.mail.poll(row.mailbox_provider,await this.token(row),row.mailbox_cursor);
      for(const item of result.messages){if(!item.authenticated||item.automated||!item.text||item.receivedAt<new Date(row.mailbox_started_at).getTime())continue;
        const m=(await this.db.pool.query(`SELECT u.id FROM users u JOIN connector_members m ON m.user_id=u.id WHERE u.status='active' AND lower(u.email)=$1 AND m.verified_email=$1 AND m.email_enabled`,[item.from])).rows;
        if(m.length!==1)continue;
        await this.receive("email",m[0].id,`${row.mailbox_provider}:${row.mailbox_address}:${item.id}`,`email:${row.mailbox_address}:${item.thread}`,item.text,item.subject,row.mailbox_provider==="outlook"?item.id:item.reference);
      }
      await this.db.pool.query("UPDATE connector_settings SET mailbox_cursor=$1,last_sync_at=now(),error=NULL WHERE singleton AND revision=$2",[result.cursor,row.revision]);
    }catch(e){const code=e instanceof MailError?e.code:"mailbox_sync_unavailable";await this.db.pool.query("UPDATE connector_settings SET error=$1,next_sync_at=now()+interval '5 minutes',mailbox_paused=mailbox_paused OR $2 WHERE singleton AND revision=$3",[code,code==="reconnect_required"||code==="cursor_expired",row.revision]);}
  }
  async dispatch() {
    const waiting=(await this.db.pool.query(`SELECT * FROM connector_messages m WHERE direction='in' AND status='pending'
      AND NOT EXISTS(SELECT 1 FROM connector_messages a WHERE a.user_id=m.user_id AND a.status IN ('dispatching','running')) ORDER BY created_at LIMIT 1`)).rows[0];
    if(waiting){const row=await this.settings();const id=randomUUID();let submitted=false;
      try{await this.eligible(waiting.user_id,waiting.channel,false);await this.memberAuthority(waiting.user_id);
        if(!row.connection_id||row.revision!==waiting.connector_revision)throw new ConnectorError(409,"Review connector settings before resuming this message.");
        await this.db.pool.query("INSERT INTO connector_runtime_grants VALUES($1,$2,$3,$4,now()+interval '1 hour')",[id,waiting.id,waiting.user_id,row.revision]);
        await this.db.pool.query("UPDATE connector_messages SET status='dispatching',updated_at=now() WHERE id=$1",[waiting.id]);
        await this.authorizeRun(id);
        const history=(await this.db.pool.query("SELECT direction,body FROM connector_messages WHERE user_id=$1 AND thread_key=$2 AND id<>$3 AND status NOT IN ('unknown','held') ORDER BY created_at DESC LIMIT 20",[waiting.user_id,waiting.thread_key,waiting.id])).rows.reverse();
        submitted=true;
        const result=await this.native("run",{history:JSON.stringify(history),grant:id,actor:waiting.user_id,message:waiting.id,thread:waiting.thread_key,text:waiting.body,subject:waiting.subject,channel:waiting.channel});
        await this.db.pool.query("UPDATE connector_messages SET status='running',native_turn=$2,updated_at=now() WHERE id=$1",[waiting.id,result.turn]);
      }catch{await this.db.pool.query("UPDATE connector_messages SET status=$2,error='Message execution requires review',updated_at=now() WHERE id=$1",[waiting.id,submitted?"unknown":"held"]);}
    }
    for(const message of (await this.db.pool.query("SELECT * FROM connector_messages WHERE status='running' ORDER BY created_at LIMIT 20")).rows){
      try{const result=await this.native("status",{actor:message.user_id,message:message.id,turn:message.native_turn});if(result.status==="running")continue;
        if((await this.settings()).revision!==message.connector_revision){await this.db.pool.query("UPDATE connector_messages SET status='held',error='Connector changed during execution' WHERE id=$1",[message.id]);continue;}
        if(result.status==="succeeded"&&result.text?.trim())await this.enqueue(message.user_id,{channel:message.channel,member:message.user_id,subject:message.subject.startsWith("Re:")?message.subject:`Re: ${message.subject}`,message:message.channel==="sms"&&result.text.length>1600?`${result.text.slice(0,1540)}… (Response shortened for SMS.)`:result.text.slice(0,16000),requestId:message.id},message);
        await this.db.pool.query("UPDATE connector_messages SET status=$2,error=$3,updated_at=now() WHERE id=$1",[message.id,result.status==="succeeded"?"replied":"held",result.status==="succeeded"?null:"Agent could not complete this message"]);
      }catch{ /* Runtime outages retain the accepted turn for reconciliation. */ }
    }
  }
  async deliver() {
    for(const d of (await this.db.pool.query(`SELECT d.id delivery_id,d.recipient,m.* FROM connector_deliveries d JOIN connector_messages m ON m.id=d.message_id WHERE d.status='pending' ORDER BY d.created_at LIMIT 10`)).rows){
      const row=await this.settings();let claimed=false;
      try{await this.memberAuthority(d.initiator_id || d.user_id);await this.memberAuthority(d.user_id);const recipient=await this.eligible(d.user_id,d.channel);
        if(recipient!==d.recipient||row.revision!==d.connector_revision||(d.channel==="email"?row.mailbox_paused:!row.sms_enabled))throw new ConnectorError(409,"Delivery paused after connector or recipient changed.");
        let token:MailToken|undefined;if(d.channel==="email")token=await this.token(row);
        if(await this.maintenance())return;
        if((await this.settings()).revision!==row.revision)throw new ConnectorError(409,"Connector changed before delivery.");
        if(await this.eligible(d.user_id,d.channel)!==recipient)throw new ConnectorError(409,"Recipient changed before delivery.");
        if(d.notification_event && !await this.notificationAllowed?.(d.notification_event,d.user_id,d.channel))throw new ConnectorError(403,"Notification subscription was revoked.");
        const result=await this.db.pool.query("UPDATE connector_deliveries SET status='sending',updated_at=now() WHERE id=$1 AND status='pending' RETURNING id",[d.delivery_id]);if(!result.rowCount)continue;claimed=true;
        let sid:string|null=null;
        if(d.channel==="email"){const thread=d.thread_key.split(":").slice(2).join(":");const sent=await this.mail.send(row.mailbox_provider,token!,{to:recipient,subject:d.subject,text:d.body,reference:d.reply_reference,thread:row.mailbox_provider==="gmail"&&d.reply_reference?thread:undefined,messageId:d.id});sid=sent.id||null;}
        else sid=await this.sendSms(recipient,d.body);
        await this.db.pool.query("UPDATE connector_deliveries SET status='accepted',provider_sid=$2,updated_at=now() WHERE id=$1",[d.delivery_id,sid]);
        await this.db.pool.query("UPDATE connector_messages SET status='accepted',provider_sid=$2,updated_at=now() WHERE id=$1",[d.id,sid]);
        if(d.channel==="sms"&&sid)await this.reconcileSmsStatus(sid);
      }catch(e){const status=claimed?"unknown":"held";await this.db.pool.query("UPDATE connector_deliveries SET status=$2,error=$3,updated_at=now() WHERE id=$1",[d.delivery_id,status,claimed?"Provider acceptance is uncertain; check before resending.":"Connector or recipient is unavailable."]);await this.db.pool.query("UPDATE connector_messages SET status=$2,error=$3,updated_at=now() WHERE id=$1",[d.id,status,claimed?"Delivery outcome unknown":"Delivery held"]);}
    }
  }
  async sendSms(to:string,text:string) {
    const effective=await this.twilio.effectiveConfig();if(!effective)throw new ConnectorError(409,"Connect Twilio first.");const c=effective.config;
    const response=await this.fetchFn(`https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}/Messages.json`,{method:"POST",redirect:"error",signal:AbortSignal.timeout(15000),headers:{Authorization:`Basic ${Buffer.from(`${c.accountSid}:${c.authToken}`).toString("base64")}`,"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({To:to,From:c.fromNumber,Body:text,StatusCallback:await this.smsUrl(true)})});
    const data=await response.json() as {sid?:string};if(!response.ok||!data.sid)throw new ConnectorError(503,"Twilio did not confirm acceptance.");return data.sid;
  }
  async twilioNumbers(input:{accountSid:string;authToken:string}) {
    const response=await this.fetchFn(`https://api.twilio.com/2010-04-01/Accounts/${input.accountSid}/IncomingPhoneNumbers.json?PageSize=1000`,{redirect:"error",signal:AbortSignal.timeout(15000),headers:{Authorization:`Basic ${Buffer.from(`${input.accountSid}:${input.authToken}`).toString("base64")}`}});
    if(!response.ok)throw new ConnectorError(422,"Twilio could not validate these credentials.");
    const data=await response.json() as any;return {numbers:(data.incoming_phone_numbers||[]).filter((n:any)=>n.capabilities?.sms).map((n:any)=>({number:n.phone_number,label:n.friendly_name}))};
  }
  async configureTwilio() {
    const effective=await this.twilio.effectiveConfig();if(!effective)throw new ConnectorError(409,"Save your Twilio connection first.");const c=effective.config;
    const headers={Authorization:`Basic ${Buffer.from(`${c.accountSid}:${c.authToken}`).toString("base64")}`,"Content-Type":"application/x-www-form-urlencoded"};
    const base=`https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}`;
    const response=await this.fetchFn(`${base}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(c.fromNumber)}`,{headers,redirect:"error",signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new ConnectorError(422,"Unable to inspect the Twilio number.");
    const data=await response.json() as any;const number=data.incoming_phone_numbers?.find((n:any)=>n.phone_number===c.fromNumber&&n.capabilities?.sms);
    if(!/^PN[a-f0-9]{32}$/i.test(number?.sid||""))throw new ConnectorError(422,"This number is not SMS capable.");
    const saved=await this.fetchFn(`${base}/IncomingPhoneNumbers/${number.sid}.json`,{method:"POST",headers,redirect:"error",signal:AbortSignal.timeout(15000),body:new URLSearchParams({SmsUrl:await this.smsUrl(),SmsMethod:"POST"})});
    if(!saved.ok)throw new ConnectorError(422,"Configure the displayed webhook URLs manually in Twilio, then check the connection.");
    const probe=await this.twilio.status(await this.smsUrl(),true,true);if(!probe.webhookVerified)throw new ConnectorError(422,"Twilio has not confirmed the incoming webhook.");
  }
  async reconcileSmsStatus(sid:string) {
    await this.db.pool.query(`UPDATE connector_deliveries d SET status=s.status,error=s.error,updated_at=now() FROM connector_sms_status s
      WHERE d.provider_sid=s.sid AND d.recipient=s.recipient AND s.sid=$1 AND d.status NOT IN ('delivered','failed','undelivered')`,[sid]);
    await this.db.pool.query("UPDATE connector_messages m SET status=d.status,error=d.error,updated_at=now() FROM connector_deliveries d WHERE m.id=d.message_id AND d.provider_sid=$1",[sid]);
  }
  async twilioWebhook(fields:Record<string,unknown>,signature:string,status:boolean) {
    const effective=await this.twilio.effectiveConfig();if(!effective)throw new ConnectorError(403,"SMS unavailable.");const c=effective.config;
    if(!validTwilioSignature(c.authToken,await this.smsUrl(status),fields,signature)||fields.AccountSid!==c.accountSid)throw new ConnectorError(403,"Invalid webhook signature.");
    if(status){if(fields.From!==c.fromNumber||!/^SM[a-f0-9]{32}$/i.test(String(fields.MessageSid)))return;
      const state=String(fields.MessageStatus||"");const rank=["queued","sending","sent","delivered","failed","undelivered"].indexOf(state);if(rank<0)return;
      await this.db.pool.query(`INSERT INTO connector_sms_status(sid,recipient,status,rank,error) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(sid) DO UPDATE SET status=excluded.status,rank=excluded.rank,error=excluded.error
        WHERE connector_sms_status.recipient=excluded.recipient AND connector_sms_status.rank<excluded.rank AND connector_sms_status.rank<3`,
        [fields.MessageSid,fields.To,state,rank,fields.ErrorCode?String(fields.ErrorCode).slice(0,20):null]);
      await this.reconcileSmsStatus(String(fields.MessageSid));return;}
    if(fields.To!==c.fromNumber||!/^SM[a-f0-9]{32}$/i.test(String(fields.MessageSid)))throw new ConnectorError(400,"Invalid message binding.");
    const members=(await this.db.pool.query("SELECT u.id FROM user_phones p JOIN users u ON u.id=p.user_id WHERE p.phone_number=$1 AND p.verified_at IS NOT NULL AND u.status='active'",[fields.From])).rows;
    if(members.length!==1)return;const member=members[0].id;const text=String(fields.Body||"").trim();
    const word=text.toUpperCase();if(["STOP","STOPALL","UNSUBSCRIBE","CANCEL","END","QUIT","START","UNSTOP"].includes(word)){
      const stopped=!['START','UNSTOP'].includes(word);await this.db.pool.query(`WITH receipt AS (
        INSERT INTO connector_webhook_receipts(provider_key) VALUES($1) ON CONFLICT DO NOTHING RETURNING provider_key)
        INSERT INTO connector_members(user_id,sms_opted_out) SELECT $2,$3 FROM receipt
        ON CONFLICT(user_id) DO UPDATE SET sms_opted_out=excluded.sms_opted_out`,[`${fields.AccountSid}:${fields.MessageSid}`,member,stopped]);return;}
    if(word==="HELP"||!text||Number(fields.NumMedia||0)>0)return;
    try{await this.receive("sms",member,`twilio:${fields.AccountSid}:${fields.MessageSid}`,`sms:${c.fromNumber}:${member}`,text);}catch(e){if(!(e instanceof ConnectorError&&e.status===403))throw e;}
  }
  async tick() {
    if(this.busy||await this.maintenance())return;this.busy=true;
    let client:PoolClient|undefined;let locked=false;
    try{client=await this.db.pool.connect();locked=(await client.query("SELECT pg_try_advisory_lock(78129341) locked")).rows[0].locked;if(!locked)return;
      this.activity(1);
      await this.db.pool.query("UPDATE connector_deliveries SET status='unknown',error='Interrupted send; check provider before resending.' WHERE status='sending' AND updated_at<now()-interval '2 minutes'");
      await this.db.pool.query("UPDATE connector_messages SET status='unknown',error='Interrupted admission; inspect runtime before retry.' WHERE status='dispatching' AND updated_at<now()-interval '2 minutes'");
      await this.syncMailbox(await this.settings());if(await this.maintenance())return;await this.dispatch();if(await this.maintenance())return;await this.deliver();
    }finally{try{if(locked){this.activity(-1);await client?.query("SELECT pg_advisory_unlock(78129341)");}}finally{client?.release();this.busy=false;}}
  }
}
