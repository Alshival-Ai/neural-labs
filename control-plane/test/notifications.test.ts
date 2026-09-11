import { describe,it,expect,vi } from "vitest";
import { effectiveChannels, notificationSchema, Notifications } from "../src/notifications.js";
import { MicrosoftOidcClient } from "../src/entra.js";

describe("notification consent and input",()=>{
 it("resolves a manual execution to its parent's subscribers and staged summary",async()=>{
  const query=vi.fn().mockResolvedValue({rows:[]});
  const service=new Notifications({query} as never,{} as never,{} as never,{} as never);
  vi.spyOn(service,"workspace").mockResolvedValue({job:{id:"parent",name:"Example",currentRunId:"100"},run:{id:"100",jobId:"parent",running:true}});
  const context=await service.context("execution");
  expect(context.job.id).toBe("parent");
  expect(query.mock.calls[0]?.[1]).toEqual(["parent"]);
  await service.enqueue(notificationSchema.parse({automationId:"execution",runId:"100",message:"Done"}));
  const staged=query.mock.calls.find(call=>String(call[0]).includes("INSERT INTO notification_run_summaries"));
  expect(staged?.[1]?.slice(0,2)).toEqual(["parent","100"]);
  expect(JSON.parse(staged?.[1]?.[2] as string).automationId).toBe("parent");
 });
 it("resolves all selected channels against current consent and availability",()=>{
  expect(effectiveChannels(['neura','sms','email','sms'],{neura:true,sms:false,email:true},true)).toEqual(['neura','email']);
  expect(effectiveChannels(['neura','sms','email'],{neura:false,sms:false,email:true},false)).toEqual([]);
 });
 it("rejects arbitrary addresses, ambiguous recipients and missing run identity",()=>{
  expect(notificationSchema.safeParse({email:'someone@example.org',message:'Update'}).success).toBe(false);
  expect(notificationSchema.safeParse({handle:'@member',automationId:'job',runId:'run',message:'Update'}).success).toBe(false);
  expect(notificationSchema.safeParse({automationId:'job',message:'Update'}).success).toBe(false);
  expect(notificationSchema.safeParse({automationId:'job',runId:'run',message:'Update',links:[{label:'Site',url:'javascript:alert(1)'}]}).success).toBe(false);
 });
 it("obtains application Graph tokens without exposing provider error bodies",async()=>{
  const tenant='tenant';const fetchFn=vi.fn().mockResolvedValueOnce(Response.json({issuer:`https://login.microsoftonline.com/${tenant}/v2.0`,authorization_endpoint:'https://login.microsoftonline.com/auth',token_endpoint:'https://login.microsoftonline.com/token',jwks_uri:'https://login.microsoftonline.com/keys'})).mockResolvedValueOnce(Response.json({access_token:'test-token'}));
  expect(await new MicrosoftOidcClient(fetchFn).applicationToken({source:'onboarding',tenantId:tenant,clientId:'app',authorityHost:'https://login.microsoftonline.com',credential:{type:'secret',clientSecret:'test-only'}},'https://graph.microsoft.com/.default')).toBe('test-token');
  const params=fetchFn.mock.calls[1]![1]!.body as URLSearchParams;
  expect(params.get('grant_type')).toBe('client_credentials');expect(params.get('scope')).toBe('https://graph.microsoft.com/.default');
 });
});
