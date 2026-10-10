import { readFile } from "node:fs/promises";
import { randomUUID, randomBytes } from "node:crypto";
import request from "supertest";
import { expect, it, vi } from "vitest";
import { createProviderApplication } from "../src/providerServer.js";
import { projectTools, parseProjectTool } from "../src/projectToolContract.js";

function message(response: request.Response) {
  return response.type === "application/json" ? response.body : JSON.parse(response.text.split('\n').find(line => line.startsWith('data:'))!.slice(5));
}
it("ships the same versioned catalog to both MCP transports", async () => {
  const canonical = await readFile(new URL('../../contracts/project-tools.v1.json', import.meta.url), 'utf8');
  expect(await readFile(new URL('../src/project-tools.v1.json', import.meta.url), 'utf8')).toBe(canonical);
  expect(await readFile(new URL('../../control-plane/src/project-tools.v1.json', import.meta.url), 'utf8')).toBe(canonical);
});
it("advertises and dispatches canonical tools through execution authorization", async () => {
  const call = vi.fn(async () => ({ items: [], next: null }));
  const authorize = vi.fn(async () => {});
  const application = createProviderApplication({ projectsRoot: '.', downloadSigningKey: randomBytes(32) }, fetch,
    undefined, authorize, undefined, undefined, undefined, undefined, call);
  const rpc = async (method: string, params = {}) => message(await request(application.app).post('/mcp')
    .set('Accept','application/json, text/event-stream').set('MCP-Protocol-Version','2025-11-25')
    .send({ jsonrpc:'2.0', id:1, method, params }).expect(200));
  try {
    const list = await rpc('tools/list');
    expect(list.result.tools.filter((tool: {name:string}) => tool.name.startsWith('project_')).map((tool:{name:string}) => tool.name).sort()).toEqual(projectTools.map(tool => tool.name).sort());
    const reply = await rpc('tools/call', { name:'project_list', arguments:{} });
    expect(reply.result.structuredContent).toEqual({ items:[], next:null });
    expect(authorize).toHaveBeenCalledWith('project_list',{});
    expect(call).toHaveBeenCalledWith('project_list',{});
    authorize.mockRejectedValueOnce(new Error('revoked'));
    expect((await rpc('tools/call', { name:'project_list', arguments:{} })).result.isError).toBe(true);
    expect(call).toHaveBeenCalledTimes(1);
  } finally { await application.close(); }
});
it("requires concurrency and request tokens for mutations", () => {
  expect(() => parseProjectTool('project_update',{ id:randomUUID(), data:{ title:'No revision' }, idempotency_key:randomUUID() })).toThrow();
  expect(() => parseProjectTool('project_link',{ source_id:randomUUID(), target_id:randomUUID(), kind:'depends_on', idempotency_key:randomUUID() })).toThrow();
  expect(() => parseProjectTool('project_status_write',{ operation:'create', revision:7, idempotency_key:randomUUID() })).toThrow();
});
