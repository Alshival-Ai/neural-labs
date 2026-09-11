import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ProviderConfig } from "./providerConfig.js";

export function registerSmsNotificationTool(server:McpServer,config:ProviderConfig,fetchFn:typeof fetch) {
  if(!config.notificationApi)return;
  const api=config.notificationApi;
  async function request(action:string,input:unknown) {
    const url=new URL(`/internal/notifications/${action}`,api.url);
    const response=await fetchFn(url,{method:"POST",headers:{Authorization:`Bearer ${api.token}`,"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify(input),signal:AbortSignal.timeout(30_000)});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(payload.error?.message??"Notification request failed");
    return {content:[{type:"text" as const,text:JSON.stringify(payload)}],structuredContent:payload};
  }
  server.registerTool("get_automation_notification_context",{
    title:"Read automation notification subscriptions",
    description:"Read the active run ID and subscribers' event/channel preferences. Returns no email addresses, phone numbers, or credentials. Use before reporting an automation result; delivery preferences are rechecked by the server.",
    inputSchema:z.object({automationId:z.string().min(1).max(200)}),
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},
  },input=>request("context",input));
  server.registerTool("notify_workspace_user",{
    title:"Notify a workspace user or automation subscribers",
    description:"Submit an explicitly requested update for one workspace user, or stage a completed result for an active automation run's subscribers. The server chooses Neura, SMS, and email from current user settings. For automations use currentRunId from get_automation_notification_context; delivery waits for the scheduler outcome. Never supply arbitrary recipient addresses. Queued/accepted is not confirmed delivery.",
    inputSchema:z.object({
      handle:z.string().regex(/^@?[a-z0-9][a-z0-9._-]{1,31}$/).optional(),userId:z.string().uuid().optional(),
      automationId:z.string().min(1).max(200).optional(),runId:z.string().min(1).max(200).optional(),
      outcome:z.enum(["success","failure"]).default("success"),title:z.string().min(1).max(200).default("Neura update"),
      message:z.string().trim().min(1).max(1600),idempotencyKey:z.string().min(1).max(200).optional(),
      links:z.array(z.object({label:z.string().max(120),url:z.string().url().startsWith("https://")})).max(5).default([]),
      mediaUrls:z.array(z.string().url().startsWith("https://")).max(10).default([]),
    }).refine(v=>Number(Boolean(v.handle))+Number(Boolean(v.userId))+Number(Boolean(v.automationId))===1,"Provide one user or automation target"),
    annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:true},
  },input=>request("send",input));
}
