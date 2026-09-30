import { createHash, randomBytes } from "node:crypto";

export type MailProvider = "gmail" | "outlook";
export type OAuthApp = { clientId: string; clientSecret: string };
export type MailToken = { accessToken: string; refreshToken: string; expiresAt: number };
export type MailMessage = { id: string; thread: string; from: string; subject: string; text: string; reference: string; authenticated: boolean; receivedAt: number; automated: boolean };
export type MailCursor = { history?: string; delta?: string };
const endpoints = {
  gmail: { authorize: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token", scopes: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send" },
  outlook: { authorize: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize", token: "https://login.microsoftonline.com/common/oauth2/v2.0/token", scopes: "offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.Send" },
};
export class MailError extends Error { constructor(public code: string, public retryable = false) { super(code); } }
export function oauthStart(provider: MailProvider, app: OAuthApp, redirect: string, state: string, verifier = randomBytes(32).toString("base64url")) {
  const url = new URL(endpoints[provider].authorize);
  const params = { client_id: app.clientId, redirect_uri: redirect, response_type: "code", scope: endpoints[provider].scopes, state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" };
  for (const [k,v] of Object.entries(params)) url.searchParams.set(k,v);
  if (provider === "gmail") { url.searchParams.set("access_type","offline"); url.searchParams.set("prompt","consent select_account"); }
  else url.searchParams.set("prompt","select_account");
  return { url: url.href, verifier };
}
const clean = (s: string) => s.replace(/[\r\n]/g," ");
export function emailAddress(raw: string): string {
  const match = raw.trim().match(/^(?:[^<>]*<)?([^<>\s@]+@[^<>\s@]+)>?$/);
  return match?.[1]?.toLowerCase() || "";
}
// Only the topmost result added by the receiving provider can authenticate mail.
// Never scan lower, sender-supplied Authentication-Results for a convenient pass.
export function authenticatedSender(headers: Array<{name: string; value: string}>, from: string, provider: MailProvider): boolean {
  const result = headers.find(h => h.name.toLowerCase() === "authentication-results")?.value || "";
  const receiver = (result.split(";")[0] || "").trim().toLowerCase();
  if (provider === "gmail" ? receiver !== "mx.google.com" : !/(?:^|;)\s*compauth=pass\b/i.test(result)) return false;
  const domain = from.split("@")[1];
  const matches = [...result.matchAll(/\bdmarc=pass\b[^;]*?\bheader\.from=([^;\s]+)/gi)];
  return matches.length === 1 && (matches[0]?.[1] || "").replace(/\.$/,"").toLowerCase() === domain;
}
export class MailProviders {
  constructor(private fetchFn: typeof fetch = fetch) {}
  async token(provider: MailProvider, app: OAuthApp, fields: Record<string,string>, prior?: MailToken): Promise<MailToken> {
    const response = await this.fetchFn(endpoints[provider].token, { method:"POST",redirect:"error",signal:AbortSignal.timeout(15000),
      headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:app.clientId,client_secret:app.clientSecret,...fields}) });
    if (!response.ok) throw new MailError(response.status >= 500 ? "provider_unavailable" : "reconnect_required",response.status>=500);
    const data = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
    if (!data.access_token || !(data.refresh_token || prior?.refreshToken)) throw new MailError("offline_access_required");
    if (data.scope) {
      const scopes = new Set(data.scope.toLowerCase().split(" "));
      const required = provider === "gmail" ? ["https://www.googleapis.com/auth/gmail.readonly","https://www.googleapis.com/auth/gmail.send"] : ["mail.read","mail.send"];
      if (required.some(scope => !scopes.has(scope) && !scopes.has(`https://graph.microsoft.com/${scope}`))) throw new MailError("mail_permissions_required");
    }
    return {accessToken:data.access_token,refreshToken:data.refresh_token || prior!.refreshToken,expiresAt:Date.now()+Number(data.expires_in || 3600)*1000};
  }
  async json(provider: MailProvider, token: MailToken, path: string, init: RequestInit = {}): Promise<any> {
    const base = provider === "gmail" ? "https://gmail.googleapis.com/gmail/v1/users/me/" : "https://graph.microsoft.com/v1.0/";
    const url = new URL(path,base);
    if (url.origin !== new URL(base).origin || !url.href.startsWith(base)) throw new MailError("invalid_provider_cursor");
    const response = await this.fetchFn(url,{...init,redirect:"error",signal:AbortSignal.timeout(20000),headers:{Authorization:`Bearer ${token.accessToken}`,"Content-Type":"application/json",...init.headers}});
    if (!response.ok) throw new MailError(response.status===401 ? "reconnect_required" : response.status===429 ? "provider_throttled" : response.status===404 ? "cursor_expired" : "provider_rejected",response.status===429 || response.status>=500);
    if (response.status===204 || response.status===202) return {};
    return response.json();
  }
  async profile(provider: MailProvider, token: MailToken) {
    const data=await this.json(provider,token,provider==="gmail"?"profile":"me?$select=mail,userPrincipalName");
    const address=emailAddress(data.emailAddress || data.mail || data.userPrincipalName || "");
    if (!address) throw new MailError("mailbox_unavailable");
    return address;
  }
  async poll(provider: MailProvider, token: MailToken, cursor: MailCursor | null): Promise<{messages:MailMessage[];cursor:MailCursor}> {
    if(provider==="gmail") {
      if(!cursor?.history) {const p=await this.json(provider,token,"profile");return {messages:[],cursor:{history:p.historyId}};}
      const ids=new Set<string>();let page="",history=cursor.history;
      do {const data=await this.json(provider,token,`history?startHistoryId=${encodeURIComponent(cursor.history)}&historyTypes=messageAdded&maxResults=100${page?`&pageToken=${encodeURIComponent(page)}`:""}`);
        for(const row of data.history || []) for(const item of row.messagesAdded || []) if(item.message?.labelIds?.includes("INBOX")) ids.add(item.message.id);
        history=data.historyId || history;page=data.nextPageToken || "";
        if(ids.size>500) throw new MailError("mailbox_backlog_requires_review");
      }while(page);
      const messages:MailMessage[]=[];
      for(const id of ids) {const data=await this.json(provider,token,`messages/${encodeURIComponent(id)}?format=full`);
        const headers=data.payload?.headers || []; const header=(name:string)=>headers.find((h:any)=>h.name.toLowerCase()===name)?.value || "";
        const from=emailAddress(header("from"));const texts:string[]=[];
        const visit=(part:any)=>{if(part.mimeType==="text/plain"&&part.body?.data)texts.push(Buffer.from(part.body.data,"base64url").toString("utf8"));for(const child of part.parts||[])visit(child);};visit(data.payload || {});
        messages.push({id,thread:data.threadId,from,subject:header("subject").slice(0,300),text:texts.join("\n").slice(0,32000),reference:header("message-id"),authenticated:authenticatedSender(headers,from,provider),receivedAt:Number(data.internalDate),automated:!!header("auto-submitted")&&header("auto-submitted").toLowerCase()!=="no"});
      }
      return {messages,cursor:{history}};
    }
    let url=cursor?.delta || "me/mailFolders/inbox/messages/delta?$select=id,conversationId,from,subject,body,internetMessageId,internetMessageHeaders,receivedDateTime&$top=100";
    const messages:MailMessage[]=[];let pages=0;
    while(true) { const data=await this.json(provider,token,url,{headers:{Prefer:'outlook.body-content-type="text"'}});
      if(cursor) for(const item of data.value || []) {if(item["@removed"])continue;const from=emailAddress(item.from?.emailAddress?.address || "");const headers=item.internetMessageHeaders || [];
        messages.push({id:item.id,thread:item.conversationId,from,subject:(item.subject||"").slice(0,300),text:(item.body?.content || "").slice(0,32000),reference:item.internetMessageId,receivedAt:Date.parse(item.receivedDateTime),authenticated:authenticatedSender(headers,from,provider),automated:headers.some((h:any)=>h.name.toLowerCase()==="auto-submitted"&&h.value.toLowerCase()!=="no")});}
      if(data["@odata.deltaLink"])return {messages,cursor:{delta:data["@odata.deltaLink"]}};
      if(!data["@odata.nextLink"]||++pages>50)throw new MailError("mailbox_backlog_requires_review");url=data["@odata.nextLink"];
    }
  }
  async send(provider: MailProvider, token: MailToken, input: {to:string;subject:string;text:string;reference?:string;thread?:string;messageId:string}) {
    if(provider==="gmail") {
      const raw=[`To: ${clean(input.to)}`,`Subject: =?UTF-8?B?${Buffer.from(clean(input.subject)).toString("base64")}?=`,`Message-ID: <${clean(input.messageId)}@neural-labs.invalid>`,"Auto-Submitted: auto-replied","MIME-Version: 1.0","Content-Type: text/plain; charset=UTF-8","Content-Transfer-Encoding: base64",...(input.reference?[`In-Reply-To: ${clean(input.reference)}`,`References: ${clean(input.reference)}`]:[]),"",Buffer.from(input.text).toString("base64")].join("\r\n");
      return this.json(provider,token,"messages/send",{method:"POST",body:JSON.stringify({raw:Buffer.from(raw).toString("base64url"),...(input.thread?{threadId:input.thread}:{})})});
    }
    // Always address the verified member explicitly. Graph /reply follows the
    // original Reply-To header, which could redirect mail outside the workspace.
    return this.json(provider,token,"me/sendMail",{method:"POST",body:JSON.stringify({message:{subject:input.subject,body:{contentType:"Text",content:input.text},toRecipients:[{emailAddress:{address:input.to}}],internetMessageHeaders:[{name:"x-neural-labs-message",value:input.messageId}]},saveToSentItems:true})});
  }
}
